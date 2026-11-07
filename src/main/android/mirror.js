// Starts and stops the scrcpy mirroring window for one phone, and reports live stats.

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const engines = require('../engines');
const { adb, adbEnv } = require('./adb');
const { buildArgs, sanitize } = require('./presets');

// Turns scrcpy's technical messages into plain language.
function friendlyError(log) {
  const text = log.toLowerCase();
  if (text.includes('unauthorized'))
    return 'Your phone has not allowed this computer yet. Tap "Allow" on the message on your phone, then try again.';
  if (text.includes('could not find any adb device'))
    return 'The phone was disconnected. Check the cable is plugged in firmly, then try again.';
  if (text.includes('device disconnected') || text.includes('connection reset'))
    return 'The connection to your phone was lost. Check the cable, then try again.';
  if (text.includes('inject_events') || text.includes('injecting input'))
    return 'Your phone is blocking control from the laptop. Xiaomi: turn on "USB debugging (Security settings)" in Developer options. OPPO/Realme: turn on "Disable permission monitoring". Then try again.';
  if (text.includes('encoder') || text.includes('mediacodec'))
    return 'Your phone could not start sending its screen at these settings. Try a lower resolution or quality in Advanced settings, or restart your phone.';
  return 'Mirroring stopped unexpectedly. Unplug the phone, plug it back in, and try again.';
}

// Reads scrcpy's console lines: "INFO: 118 fps (+3 frames skipped)", "INFO: Texture: 1920x864".
function parseStats(line) {
  const fps = /\b(\d+) fps(?: \(\+(\d+) frames? skipped\))?/.exec(line);
  if (fps) return { fps: +fps[1], skipped: fps[2] ? +fps[2] : 0 };
  const tex = /Texture: (\d+)x(\d+)/.exec(line);
  if (tex) return { width: +tex[1], height: +tex[2] };
  return null;
}

const ROTATION = { landscape: '1', portrait: '0' };

class Mirror extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.restoreRotation = null;
  }

  get running() {
    return this.proc !== null || !!this.launching;
  }

  async start(device, settings) {
    if (this.running) return;
    this.launching = true;
    this.userStopped = false;
    this.stats = {};
    const s = sanitize(settings);
    this.emit('state', { state: 'starting' });
    try {
      await this.applyOrientation(device.serial, s.orientation);
    } catch (err) {
      console.error('[mirror] orientation', err.message);
    }
    this.launching = false;
    if (this.userStopped) return this.finish({ state: 'stopped' });
    this.launch(device, s, true);
  }

  launch(device, s, codecOptions) {
    const args = buildArgs(device, s, { codecOptions });
    const command = `scrcpy ${args.join(' ')}\n`;
    let log = ''; // scrcpy's own output (the command line is kept separate so it isn't searched)
    let running = false;
    let buffered = '';

    const proc = spawn(engines.scrcpyPath(), args, {
      cwd: engines.scrcpyDir(),
      windowsHide: true,
      env: { ...adbEnv(), ADB: engines.adbPath() },
    });
    this.proc = proc;
    this.deviceName = device.name;

    const onOutput = (chunk) => {
      const text = chunk.toString();
      log = (log + text).slice(-12000);
      buffered += text;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop();
      for (const line of lines) {
        if (!running && /texture:|renderer:/i.test(line)) {
          running = true;
          this.emit('state', { state: 'running' });
        }
        const stat = parseStats(line);
        if (stat && stat.fps != null && !running) {
          running = true;
          this.emit('state', { state: 'running' });
        }
        if (stat) {
          Object.assign(this.stats, stat);
          this.emit('stats', { ...this.stats });
        }
      }
    };
    proc.stdout.on('data', onOutput);
    proc.stderr.on('data', onOutput);

    proc.on('error', (err) => {
      this.proc = null;
      this.finish({
        state: 'error',
        message: 'MirroX could not start its mirroring engine. Download MirroX again; if this keeps happening, see "Show details".',
        details: `Error: ${err.message}\n${command}scrcpy path: ${engines.scrcpyPath()}\nEngine folder: ${engines.scrcpyDir()}`,
      });
    });

    proc.on('exit', (code) => {
      if (this.proc !== proc) return; // already handled by 'error'
      this.proc = null;
      // Some phones reject the "real-time priority" request: retry once without it.
      if (!running && !this.userStopped && codecOptions && s.lowLatency && /codec|encoder|configure/i.test(log)) {
        console.error('[mirror] retrying without codec options');
        return this.launch(device, s, false);
      }
      // Code 0 = window closed normally.
      if (this.userStopped || code === 0) this.finish({ state: 'stopped' });
      else this.finish({ state: 'error', message: friendlyError(log), details: command + log.slice(-4000) });
    });
  }

  // Landscape / portrait: turn off auto-rotate on the phone and set the rotation; undone when mirroring stops.
  async applyOrientation(serial, orientation) {
    if (!ROTATION[orientation]) return;
    const get = async (key) => (await adb(['-s', serial, 'shell', 'settings', 'get', 'system', key])).trim();
    const put = (key, val) => adb(['-s', serial, 'shell', 'settings', 'put', 'system', key, val]);
    const before = { accelerometer_rotation: await get('accelerometer_rotation'), user_rotation: await get('user_rotation') };
    this.restoreRotation = async () => {
      for (const [k, v] of Object.entries(before)) if (/^\d+$/.test(v)) await put(k, v);
    };
    await put('accelerometer_rotation', '0');
    await put('user_rotation', ROTATION[orientation]);
  }

  async finish(state) {
    this.emit('state', state);
    const restore = this.restoreRotation;
    this.restoreRotation = null;
    if (restore) await restore().catch((err) => console.error('[mirror] restore rotation', err.message));
  }

  stop() {
    this.userStopped = true;
    if (this.proc) this.proc.kill();
  }
}

module.exports = { Mirror, friendlyError, parseStats };
