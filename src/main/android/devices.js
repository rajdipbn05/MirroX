// Watches for Android phones plugged in over USB and reports their status.

const { EventEmitter } = require('events');
const { adb, friendlyAdbError } = require('./adb');
const { classify, needsUsbScan, needsProcessScan } = require('./status');
const platform = require('../platform');
const engines = require('../engines');

// Turns the text printed by `adb devices -l` into a list of {serial, state, model}.
function parseDevices(output) {
  const devices = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue;
    const [serial, state, ...rest] = line.split(/\s+/);
    if (!serial || !state) continue;
    const info = {};
    for (const part of rest) {
      const i = part.indexOf(':');
      if (i > 0) info[part.slice(0, i)] = part.slice(i + 1);
    }
    devices.push({ serial, state, model: (info.model || '').replace(/_/g, ' ') });
  }
  return devices;
}

class DeviceWatcher extends EventEmitter {
  constructor(intervalMs = 1500) {
    super();
    this.intervalMs = intervalMs;
    this.details = new Map(); // serial -> {name, brand, androidVersion}
    this.serverStarted = false;
    this.usb = null;
    this.procs = null;
    this.lastUsbScan = 0;
    this.lastProcScan = 0;
    this.lastJson = '';
    this.current = null;
  }

  start() {
    const tick = async () => {
      try {
        await this.poll();
      } catch (err) {
        console.error('[watcher]', err);
      }
      this.timer = setTimeout(tick, this.intervalMs);
    };
    tick();
  }

  stop() {
    clearTimeout(this.timer);
  }

  // Ask for a fresh look right away (e.g. after closing a conflicting app).
  refreshSoon() {
    this.lastUsbScan = 0;
    this.lastProcScan = 0;
  }

  async poll() {
    let devices = [];
    let adbError = null;
    let adbErrorDetails = null;
    try {
      // Starting the helper the first time can be slow (antivirus scans), so allow it more time.
      if (!this.serverStarted) {
        await adb(['start-server'], { timeout: 30000 });
        this.serverStarted = true;
      }
      devices = parseDevices(await adb(['devices', '-l']));
    } catch (err) {
      this.serverStarted = false;
      adbError = friendlyAdbError(err);
      adbErrorDetails = err.details || String((err && err.stack) || err);
      console.error('[adb]', adbErrorDetails);
    }

    for (const d of devices) {
      d.name = d.model || '';
      if (d.state === 'device') Object.assign(d, await this.getDetails(d.serial, d.model));
    }

    // Look at USB and running programs only when ADB alone can't explain things.
    const now = Date.now();
    const scanUsb = needsUsbScan({ devices });
    if (!scanUsb) {
      this.usb = null;
      this.procs = null;
    } else if (now - this.lastUsbScan > 3000) {
      this.lastUsbScan = now;
      this.usb = await platform.scanUsb().catch((e) => (console.error('[usb]', e.message), null));
    }
    if (needsProcessScan({ devices, adbError, usb: this.usb })) {
      if (now - this.lastProcScan > 5000) {
        this.lastProcScan = now;
        this.procs = await platform.listProcesses().catch((e) => (console.error('[procs]', e.message), null));
      }
    } else {
      this.procs = null;
    }

    const state = classify({
      devices,
      adbError,
      adbErrorDetails,
      usb: this.usb,
      procs: this.procs,
      engineDir: engines.scrcpyDir(),
    });
    const json = JSON.stringify(state);
    if (json !== this.lastJson) {
      this.lastJson = json;
      this.current = state;
      this.emit('change', state);
    }
  }

  async getDetails(serial, fallbackModel) {
    if (this.details.has(serial)) return this.details.get(serial);
    const prop = async (args) => {
      try {
        const v = (await adb(['-s', serial, 'shell', ...args])).trim();
        return v && v !== 'null' ? v : '';
      } catch {
        return '';
      }
    };
    const [deviceName, brand, model, version] = await Promise.all([
      prop(['settings', 'get', 'global', 'device_name']),
      prop(['getprop', 'ro.product.manufacturer']),
      prop(['getprop', 'ro.product.model']),
      prop(['getprop', 'ro.build.version.release']),
    ]);
    const details = {
      name: deviceName || [capitalize(brand), model || fallbackModel].filter(Boolean).join(' ') || 'Android phone',
      brand: capitalize(brand),
      androidVersion: version,
    };
    this.details.set(serial, details);
    return details;
  }
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

module.exports = { DeviceWatcher, parseDevices };
