// "My voice (phone mic)": while mirroring, also pick up the phone's microphone and play it on
// this computer, so a stream gets game sound + friends + the player's own voice — with no
// extra microphone. The game keeps using the phone's mic for in-game voice chat as usual.
//
// It runs a second, sound-only scrcpy connection (no picture, no control, no window).
// Whether Android lets two apps use the mic at once differs between phones, so the capture
// method can be changed in Advanced settings.

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const engines = require('../engines');
const { adbEnv } = require('./adb');

// Capture methods offered in Advanced settings (scrcpy --audio-source values).
const VOICE_METHODS = {
  'mic-voice-communication': 'Voice chat mode — with echo cancellation (recommended)',
  mic: 'Standard microphone',
  'mic-unprocessed': 'Raw microphone (no processing)',
  'mic-voice-recognition': 'Speech mode',
};
const DEFAULT_METHOD = 'mic-voice-communication';

function voiceArgs(serial, method) {
  return [
    `--serial=${serial}`,
    '--no-video',
    '--no-control',
    '--no-window',
    '--require-audio', // fail visibly instead of silently mirroring nothing
    `--audio-source=${VOICE_METHODS[method] ? method : DEFAULT_METHOD}`,
    '--audio-buffer=40', // keep the voice close to the picture
  ];
}

function friendlyVoiceError(log) {
  const t = log.toLowerCase();
  if (t.includes('android 11') || t.includes('not supported') || t.includes('audio capture'))
    return 'Your phone did not allow MirroX to use its microphone. Try another "Voice capture method" in Advanced settings.';
  if (t.includes('unauthorized')) return 'Your phone has not allowed this computer yet. Tap "Allow" on the phone.';
  return 'MirroX could not pick up the phone microphone. Try another "Voice capture method" in Advanced settings.';
}

class VoiceCapture extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.state = 'off';
  }

  get running() {
    return !!this.proc;
  }

  setState(state, extra = {}) {
    this.state = state;
    this.emit('state', { state, ...extra });
  }

  start(serial, method) {
    this.stop();
    const args = voiceArgs(serial, method);
    const command = `scrcpy ${args.join(' ')}\n`;
    let log = '';
    this.userStopped = false;
    const proc = spawn(engines.scrcpyPath(), args, {
      cwd: engines.scrcpyDir(),
      windowsHide: true,
      env: { ...adbEnv(), ADB: engines.adbPath() },
    });
    this.proc = proc;
    this.setState('starting');
    const onOut = (d) => {
      log = (log + d.toString()).slice(-8000);
    };
    proc.stdout.on('data', onOut);
    proc.stderr.on('data', onOut);
    // If scrcpy is still running after a few seconds, the microphone is being captured.
    this.okTimer = setTimeout(() => this.proc === proc && this.state === 'starting' && this.setState('on'), 4000);
    proc.on('error', (err) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.setState('error', { message: 'MirroX could not start the voice capture.', details: `${command}${err.message}` });
    });
    proc.on('exit', (code) => {
      clearTimeout(this.okTimer);
      if (this.proc !== proc) return;
      this.proc = null;
      if (this.userStopped || code === 0) this.setState('off');
      else this.setState('error', { message: friendlyVoiceError(log), details: command + log.slice(-3000) });
    });
  }

  stop() {
    clearTimeout(this.okTimer);
    if (!this.proc) return;
    this.userStopped = true;
    const p = this.proc;
    this.proc = null;
    p.kill();
    this.setState('off');
  }
}

module.exports = { VoiceCapture, VOICE_METHODS, DEFAULT_METHOD, voiceArgs };
