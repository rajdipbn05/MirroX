// Connects to scrcpy-server (through the adb-forwarded local port) and reads its streams.
//
// Connection order, exactly as scrcpy 5.0.1 does it (app/src/server.c, sc_server_connect_to):
//   1. video socket  — retried until the phone sends one "dummy" byte (server is listening)
//   2. audio socket  (if audio)
//   3. control socket
//   4. only THEN does the phone send the 64-byte device name on the first socket.
//
// Emits: 'video' (header, data), 'audio' (data), 'session' ({width, height}), 'ended' (error|null)

const net = require('net');
const { EventEmitter } = require('events');
const P = require('../../shared/scrcpy-protocol');

class Reader {
  constructor(socket) {
    this.chunks = [];
    this.length = 0;
    this.waiter = null;
    this.ended = false;
    socket.on('data', (d) => {
      this.chunks.push(d);
      this.length += d.length;
      this.wake();
    });
    const end = () => {
      this.ended = true;
      this.wake();
    };
    socket.on('close', end);
    socket.on('error', end);
  }
  wake() {
    if (this.waiter && (this.length >= this.waiter.n || this.ended)) {
      const w = this.waiter;
      this.waiter = null;
      w.resolve();
    }
  }
  async read(n) {
    if (this.length < n) {
      if (this.ended) throw new Error('connection closed');
      await new Promise((resolve) => (this.waiter = { n, resolve }));
      if (this.length < n) throw new Error('connection closed');
    }
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
    const out = all.subarray(0, n);
    const rest = all.subarray(n);
    this.chunks = rest.length ? [rest] : [];
    this.length = rest.length;
    return out;
  }
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => resolve(s));
    s.once('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => (t = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000} s: ${what}`)), ms))),
  ]).finally(() => clearTimeout(t));
}

class StreamClient extends EventEmitter {
  constructor() {
    super();
    this.sockets = [];
    this.control = null;
    this.closed = false;
    this.step = 'not started';
  }

  // Resolves once all sockets are connected and the device name is received.
  async connect(port, { audio }) {
    this.step = 'waiting for the phone to start (video connection)';
    const first = await withTimeout(this.connectFirst(port), 20000, this.step);
    const videoReader = first.reader;

    let audioReader = null;
    if (audio) {
      this.step = 'opening the sound connection';
      const a = await withTimeout(connect(port), 5000, this.step);
      this.track(a);
      audioReader = new Reader(a);
    }

    this.step = 'opening the control connection';
    const c = await withTimeout(connect(port), 5000, this.step);
    this.track(c);
    c.setNoDelay(true);
    c.on('data', () => {}); // phone -> computer messages (clipboard etc.) not used yet
    this.control = c;

    this.step = 'waiting for the phone name';
    this.deviceName = P.parseDeviceName(await withTimeout(videoReader.read(P.DEVICE_NAME_LENGTH), 10000, this.step));

    this.step = 'streaming';
    this.readVideo(videoReader).catch((err) => this.end(err));
    if (audioReader) this.readAudio(audioReader).catch(() => {}); // sound failing never stops the picture
    return this.deviceName;
  }

  track(s) {
    s.on('error', () => {});
    this.sockets.push(s);
  }

  // Until the server listens on the phone, adb accepts and immediately closes the connection: retry.
  async connectFirst(port) {
    let lastErr;
    for (let i = 0; i < 200 && !this.closed; i++) {
      let s;
      try {
        s = await connect(port);
        s.setNoDelay(true);
        const r = new Reader(s);
        await r.read(1); // dummy byte
        this.track(s);
        return { socket: s, reader: r };
      } catch (err) {
        lastErr = err;
        if (s) s.destroy();
        await sleep(100);
      }
    }
    throw lastErr || new Error('cancelled');
  }

  async readVideo(reader) {
    const codec = (await reader.read(4)).readUInt32BE(0);
    if (codec === P.CODEC.ERROR) throw Object.assign(new Error('encoder configuration error'), { encoder: true });
    if (codec !== P.CODEC.H264) throw new Error(`unexpected video codec 0x${codec.toString(16)}`);
    for (;;) {
      const h = P.parseHeader(await reader.read(P.HEADER_SIZE));
      if (h.session) {
        this.session = { width: h.width, height: h.height };
        this.emit('session', this.session);
        continue;
      }
      const data = await reader.read(h.size);
      if (h.config) this.lastConfig = Buffer.from(data);
      this.emit('video', h, data);
    }
  }

  async readAudio(reader) {
    const codec = (await reader.read(4)).readUInt32BE(0);
    if (codec !== P.CODEC.RAW) return; // disabled by the phone (Android < 11): picture only
    this.emit('audio-start');
    for (;;) {
      const h = P.parseHeader(await reader.read(P.HEADER_SIZE));
      const data = await reader.read(h.size);
      if (!h.config) this.emit('audio', data);
    }
  }

  sendControl(buf) {
    if (this.control && !this.control.destroyed) this.control.write(buf);
  }

  end(err) {
    if (this.closed) return;
    this.close();
    this.emit('ended', err || null);
  }

  close() {
    this.closed = true;
    for (const s of this.sockets) s.destroy();
    this.sockets = [];
  }
}

module.exports = { StreamClient };
