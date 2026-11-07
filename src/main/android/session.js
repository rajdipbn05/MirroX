// Starts scrcpy-server on the phone and opens a local port the mirror window connects to.
//
//   1. copy scrcpy-server to the phone (adb push)
//   2. forward a local TCP port to the server's socket on the phone (adb forward)
//   3. start the server (adb shell app_process ...)
// The mirror window then connects to 127.0.0.1:<port> for video, audio and control.

const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const engines = require('../engines');
const { adb, adbEnv } = require('./adb');
const { SCRCPY_VERSION, serverArgs } = require('../../shared/scrcpy-protocol');

const DEVICE_SERVER_PATH = '/data/local/tmp/mirrox-server.jar';

function freePort(start = 27183) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (p > start + 100) return reject(new Error('No free local port'));
      const srv = net.createServer();
      srv.once('error', () => tryPort(p + 1));
      srv.listen(p, '127.0.0.1', () => srv.close(() => resolve(p)));
    };
    tryPort(start);
  });
}

class ServerSession extends EventEmitter {
  constructor(serial) {
    super();
    this.serial = serial;
    this.log = '';
    this.proc = null;
    this.port = null;
    this.stopped = false;
  }

  // Returns { port } once the server has been launched (the window still has to connect).
  async start({ settings, audio, sdk }) {
    const serial = this.serial;
    await adb(['-s', serial, 'push', path.join(engines.scrcpyDir(), 'scrcpy-server'), DEVICE_SERVER_PATH], { timeout: 30000 });

    this.scid = crypto.randomBytes(4).readUInt32BE(0) & 0x7fffffff; // 31-bit, like scrcpy
    const scidHex = this.scid.toString(16).padStart(8, '0');
    this.socketName = `scrcpy_${scidHex}`;
    this.port = await freePort();
    await adb(['-s', serial, 'forward', `tcp:${this.port}`, `localabstract:${this.socketName}`]);

    // Audio capture needs Android 11 (SDK 30) or newer.
    const withAudio = audio && (!sdk || sdk >= 30);
    const args = [
      '-s', serial, 'shell',
      `CLASSPATH=${DEVICE_SERVER_PATH}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', SCRCPY_VERSION,
      ...serverArgs({ scid: scidHex, settings, audio: withAudio }),
    ];
    this.proc = spawn(engines.adbPath(), args, { windowsHide: true, env: adbEnv() });
    const onOut = (chunk) => {
      this.log = (this.log + chunk.toString()).slice(-12000);
    };
    this.proc.stdout.on('data', onOut);
    this.proc.stderr.on('data', onOut);
    this.proc.on('exit', (code) => {
      this.proc = null;
      if (!this.stopped) this.emit('exit', { code, log: this.log });
    });
    this.proc.on('error', (err) => {
      this.log += `\n${err.message}`;
    });
    return { port: this.port, audio: withAudio, command: `adb ${args.join(' ')}` };
  }

  async stop() {
    this.stopped = true;
    if (this.proc) this.proc.kill();
    this.proc = null;
    if (this.port) {
      await adb(['-s', this.serial, 'forward', '--remove', `tcp:${this.port}`], { timeout: 4000 }).catch(() => {});
      this.port = null;
    }
  }
}

module.exports = { ServerSession, DEVICE_SERVER_PATH };
