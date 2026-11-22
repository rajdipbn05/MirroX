// A sound-only connection to the phone, used when the player hears the game on the phone:
// the phone keeps playing the sound (audio_dup), and MirroX receives a copy for OBS.
// Includes teammates' voice chat ("playback" capture, Android 13+).

const { EventEmitter } = require('events');
const { ServerSession } = require('./session');
const { StreamClient } = require('./stream');
const { adb } = require('./adb');

class SoundTap extends EventEmitter {
  constructor() {
    super();
    this.session = null;
    this.client = null;
    this.state = 'off';
  }

  get running() {
    return !!(this.session || this.client);
  }

  setState(state, extra = {}) {
    this.state = state;
    this.emit('state', { state, ...extra });
  }

  // device: { serial } or { testPort } (automated tests)
  async start(device) {
    await this.stop();
    this.stopped = false;
    this.setState('starting');
    try {
      let port = device.testPort;
      if (!port) {
        const sdk = parseInt(await adb(['-s', device.serial, 'shell', 'getprop', 'ro.build.version.sdk']).catch(() => '0'), 10);
        if (sdk && sdk < 33) throw Object.assign(new Error('Android 13 or newer is needed'), { tooOld: true });
        this.session = new ServerSession(device.serial);
        const r = await this.session.start({ settings: { soundOnly: true, audioSource: 'playback', audioDup: true }, audio: true, sdk });
        port = r.port;
      }
      if (this.stopped) return;
      this.client = new StreamClient();
      this.client.on('audio', (pcm) => this.emit('pcm', pcm));
      this.client.on('audio-disabled', () => this.fail(new Error('the phone did not allow capturing its sound')));
      this.client.on('ended', (err) => !this.stopped && this.fail(err || new Error('connection closed')));
      await this.client.connect(port, { soundOnly: true });
      if (!this.stopped) this.setState('on');
    } catch (err) {
      if (!this.stopped) this.fail(err);
    }
  }

  async fail(err) {
    const log = this.session ? this.session.log : '';
    await this.stop();
    this.setState('error', {
      message: err.tooOld
        ? 'Hearing the game on the phone while streaming needs Android 13 or newer.'
        : 'MirroX could not get the game sound for your stream. Try "Hear game sound on: This computer", or restart mirroring.',
      details: [`${err.stack || err}`, log && `Phone-side log:\n${log.slice(-2000)}`].filter(Boolean).join('\n\n'),
    });
  }

  async stop() {
    this.stopped = true;
    const c = this.client;
    const s = this.session;
    this.client = null;
    this.session = null;
    if (c) c.close();
    if (s) await s.stop();
    if (this.state !== 'error') this.setState('off');
  }
}

module.exports = { SoundTap };
