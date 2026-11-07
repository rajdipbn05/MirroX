// Watches for Android phones plugged in over USB and reports their status.

const { EventEmitter } = require('events');
const { adb } = require('./adb');

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

// What each ADB state means for the user.
const STATUS = {
  device: { status: 'ready', label: 'Connected' },
  unauthorized: {
    status: 'needs-permission',
    label: 'Waiting for permission on phone',
    hint: 'Look at your phone: tap "Allow" on the "Allow USB debugging?" message. Tick "Always allow from this computer" so it won\'t ask again.',
  },
  offline: {
    status: 'connecting',
    label: 'Connecting…',
    hint: 'Hold on a moment. If this stays for long, unplug the cable and plug it back in.',
  },
  authorizing: { status: 'connecting', label: 'Connecting…' },
};

class DeviceWatcher extends EventEmitter {
  constructor(intervalMs = 1500) {
    super();
    this.intervalMs = intervalMs;
    this.details = new Map(); // serial -> {name, androidVersion}
    this.lastJson = '';
    this.adbError = null;
  }

  start() {
    const tick = async () => {
      await this.poll();
      this.timer = setTimeout(tick, this.intervalMs);
    };
    tick();
  }

  stop() {
    clearTimeout(this.timer);
  }

  async poll() {
    let devices;
    try {
      devices = parseDevices(await adb(['devices', '-l']));
      this.adbError = null;
    } catch (err) {
      this.adbError = 'The phone connection helper could not start. Try closing and reopening MirroX.';
      devices = [];
    }

    const result = [];
    for (const d of devices) {
      const meta = STATUS[d.state] || { status: 'connecting', label: 'Connecting…' };
      const entry = { serial: d.serial, ...meta, name: d.model || 'Android phone' };
      if (d.state === 'device') Object.assign(entry, await this.getDetails(d.serial, d.model));
      result.push(entry);
    }

    const payload = { devices: result, error: this.adbError };
    const json = JSON.stringify(payload);
    if (json !== this.lastJson) {
      this.lastJson = json;
      this.emit('change', payload);
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
