// A pretend phone for automated tests: speaks the scrcpy-server 5.0.1 protocol on a local port.
//   connection 1 = video (dummy byte; then — only once ALL connections are open, exactly like the
//                  real server — device name, codec id, session header, H.264 packets)
//   connection 2 = audio (raw PCM: a quiet 440 Hz tone)
//   connection 3 = control (every message received is logged as JSON lines to stdout)
// The video plays the portrait test clip, then "rotates" to the landscape clip, in a loop.
//
// Usage: node scripts/fake-phone-server.js <port>

const fs = require('fs');
const net = require('net');
const path = require('path');
const P = require('../src/shared/scrcpy-protocol');

const port = Number(process.argv[2]) || 27999;
const FIX = path.join(__dirname, '..', 'test', 'fixtures');
const CLIPS = [
  { file: 'portrait-540x1200.h264', width: 540, height: 1200 },
  { file: 'landscape-1200x540.h264', width: 1200, height: 540 },
];

// Split an Annex B file into a config packet (SPS+PPS) and one packet per frame.
function loadClip(clip) {
  const buf = fs.readFileSync(path.join(FIX, clip.file));
  const sc = Buffer.from([0, 0, 0, 1]);
  const config = [];
  const frames = [];
  let pending = [];
  for (const nal of P.splitNals(buf)) {
    const type = nal[0] & 0x1f;
    if (type === 7 || type === 8) {
      config.push(sc, nal);
    } else if (type === 1 || type === 5) {
      pending.push(sc, nal);
      frames.push({ data: Buffer.concat(pending), key: type === 5 });
      pending = [];
    } else {
      pending.push(sc, nal); // SEI etc.: attach to the next frame
    }
  }
  return { ...clip, config: Buffer.concat(config), frames };
}
const clips = CLIPS.map(loadClip);

function header({ config = false, key = false, pts = 0, size }) {
  const b = Buffer.alloc(12);
  let hi = Math.floor(pts / 2 ** 32) & 0x1fffffff;
  if (config) hi = 0x40000000;
  if (key) hi |= 0x20000000;
  b.writeUInt32BE(hi >>> 0, 0);
  b.writeUInt32BE(config ? 0 : pts % 2 ** 32, 4);
  b.writeUInt32BE(size, 8);
  return b;
}

function session(w, h) {
  const b = Buffer.alloc(12);
  b.writeUInt32BE(0x80000000, 0);
  b.writeUInt32BE(w, 4);
  b.writeUInt32BE(h, 8);
  return b;
}

let videoSock = null;
let restartClip = null; // set while streaming; called on RESET_VIDEO

function serveVideo(sock) {
  sock.write(Buffer.from([0])); // dummy byte, right away
  videoSock = sock;
}

// Called when the control connection (the last one) is open: start everything.
function startVideo(sock) {
  const name = Buffer.alloc(64);
  name.write('Fake Test Phone');
  sock.write(name);
  const id = Buffer.alloc(4);
  id.writeUInt32BE(P.CODEC.H264);
  sock.write(id);
  let clipIndex = 0;
  let frame = 0;
  let pts = 0;
  let timer;
  const startClip = () => {
    const c = clips[clipIndex];
    sock.write(session(c.width, c.height));
    sock.write(header({ config: true, size: c.config.length }));
    sock.write(c.config);
    frame = 0;
  };
  startClip();
  restartClip = startClip; // RESET_VIDEO: send config + key frame again
  timer = setInterval(() => {
    if (sock.destroyed) return clearInterval(timer);
    const c = clips[clipIndex];
    if (frame >= c.frames.length) {
      clipIndex = (clipIndex + 1) % clips.length; // "rotate the phone"
      startClip();
      return;
    }
    const f = c.frames[frame++];
    pts += 16667;
    sock.write(header({ key: f.key, pts, size: f.data.length }));
    sock.write(f.data);
  }, 1000 / 60);
  sock.on('close', () => clearInterval(timer));
}

function serveAudio(sock) {
  const id = Buffer.alloc(4);
  id.writeUInt32BE(P.CODEC.RAW);
  sock.write(id);
  let t = 0;
  let pts = 0;
  const timer = setInterval(() => {
    if (sock.destroyed) return clearInterval(timer);
    const frames = 480; // 10 ms
    const pcm = Buffer.alloc(frames * 4);
    for (let i = 0; i < frames; i++, t++) {
      const v = Math.round(Math.sin((2 * Math.PI * 440 * t) / 48000) * 3000);
      pcm.writeInt16LE(v, i * 4);
      pcm.writeInt16LE(v, i * 4 + 2);
    }
    pts += 10000;
    sock.write(header({ pts, size: pcm.length }));
    sock.write(pcm);
  }, 10);
  sock.on('close', () => clearInterval(timer));
}

// Decodes control messages enough for tests to check them.
function serveControl(sock) {
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (!buf.length) break;
      const type = buf[0];
      const sizes = { 0: 14, 2: 32, 3: 21, 4: 2, 10: 2, 17: 1 };
      let size = sizes[type];
      if (type === 1) size = buf.length >= 5 ? 5 + buf.readUInt32BE(1) : Infinity;
      if (size === undefined) size = buf.length; // unknown: consume all
      if (buf.length < size) break;
      const m = buf.subarray(0, size);
      buf = buf.subarray(size);
      const out = { type };
      if (type === 17) {
        out.msg = 'reset-video';
        if (restartClip) restartClip();
      }
      if (type === 0) Object.assign(out, { msg: 'key', action: m[1], keycode: m.readUInt32BE(2), meta: m.readUInt32BE(10) });
      if (type === 2) Object.assign(out, { msg: 'touch', action: m[1], x: m.readInt32BE(10), y: m.readInt32BE(14), w: m.readUInt16BE(18), h: m.readUInt16BE(20) });
      if (type === 3) Object.assign(out, { msg: 'scroll', v: m.readInt16BE(15) });
      if (type === 4) Object.assign(out, { msg: 'back', action: m[1] });
      console.log(JSON.stringify(out));
    }
  });
}

let count = 0;
let audioSock = null;
const server = net.createServer((sock) => {
  sock.on('error', () => {});
  const n = count++ % 3;
  if (n === 0) serveVideo(sock);
  else if (n === 1) audioSock = sock;
  else {
    serveControl(sock);
    // Like the real server: device name + streams only after video, audio and control are all connected.
    startVideo(videoSock);
    serveAudio(audioSock);
  }
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ listening: port })));
