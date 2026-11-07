// Starts and stops the scrcpy mirroring window for one phone.

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const engines = require('../engines');

// Turns scrcpy's technical messages into plain language.
function friendlyError(log) {
  const text = log.toLowerCase();
  if (text.includes('unauthorized'))
    return 'Your phone has not allowed this computer yet. Tap "Allow" on the message on your phone, then try again.';
  if (text.includes('could not find any adb device'))
    return 'The phone was disconnected. Check the cable is plugged in firmly, then try again.';
  if (text.includes('device disconnected') || text.includes('connection reset'))
    return 'The connection to your phone was lost. Check the cable, then try again.';
  if (text.includes('encoder') || text.includes('mediacodec'))
    return 'Your phone could not start sending its screen. Try again, or restart your phone if it keeps happening.';
  return 'Mirroring stopped unexpectedly. Unplug the phone, plug it back in, and try again.';
}

class Mirror extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
  }

  get running() {
    return this.proc !== null;
  }

  start({ serial, name }) {
    if (this.proc) return;
    const args = [
      `--serial=${serial}`,
      `--window-title=MirroX — ${name}`,
      '--stay-awake',
    ];
    let log = '';
    let userStopped = false;
    this.stopRequested = () => (userStopped = true);

    const proc = spawn(engines.scrcpyPath(), args, {
      cwd: engines.scrcpyDir(),
      windowsHide: true,
      env: { ...process.env, ADB: engines.adbPath(), ADB_MDNS: '0' },
    });
    this.proc = proc;
    this.emit('state', { state: 'starting' });

    const onOutput = (chunk) => {
      const s = chunk.toString();
      log = (log + s).slice(-8000);
      if (/texture:|renderer:|INFO: Device:/i.test(s)) this.emit('state', { state: 'running' });
    };
    proc.stdout.on('data', onOutput);
    proc.stderr.on('data', onOutput);

    proc.on('error', (err) => {
      this.proc = null;
      this.emit('state', {
        state: 'error',
        message: 'MirroX could not start its mirroring engine. Download MirroX again; if this keeps happening, see "Show details".',
        details: `Error: ${err.message}\nscrcpy path: ${engines.scrcpyPath()}\nEngine folder: ${engines.scrcpyDir()}`,
      });
    });
    proc.on('exit', (code) => {
      this.proc = null;
      // Code 0 = window closed normally; code 2 = phone unplugged while mirroring.
      if (userStopped || code === 0) this.emit('state', { state: 'stopped' });
      else this.emit('state', { state: 'error', message: friendlyError(log), details: log.slice(-2000) });
    });
  }

  stop() {
    if (!this.proc) return;
    this.stopRequested();
    this.proc.kill();
  }
}

module.exports = { Mirror, friendlyError };
