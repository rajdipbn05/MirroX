// "Game sound for OBS": a tiny web server on this computer only (127.0.0.1).
//
// When the game sound plays on the phone (in the player's earphones, no delay), MirroX still
// receives a copy and offers it to OBS here instead of playing it out loud:
//
//   http://127.0.0.1:47123/          page for an OBS "Browser Source" (tick "Control audio via OBS")
//   http://127.0.0.1:47123/pcm       the raw sound stream (16-bit stereo PCM, 48 kHz) the page plays
//
// With "Control audio via OBS", OBS puts the page's sound only into the stream/recording — it is
// not played on the computer's speakers.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');

const PORT = 47123;

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>MirroX game sound</title>
<style>
  html,body{margin:0;background:transparent;color:#e8eaee;font:14px "Segoe UI",system-ui,sans-serif}
  #s{display:inline-block;margin:8px;padding:6px 10px;border-radius:8px;background:rgba(20,22,27,.85)}
</style></head>
<body><div id="s">MirroX game sound: waiting…</div>
<script>
// Plays the phone's game sound inside OBS. Shows a small status label (crop or hide it in OBS).
const label = document.getElementById('s');
let ctx, node;
async function setup() {
  ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('/pcm-worklet.js');
  node = new AudioWorkletNode(ctx, 'pcm-player', { outputChannelCount: [2] });
  node.connect(ctx.destination);
}
async function run() {
  if (!ctx) await setup();
  try {
    const res = await fetch('/pcm', { cache: 'no-store' });
    const reader = res.body.getReader();
    let carry = null;
    label.textContent = 'MirroX game sound: connected';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      let bytes = value;
      if (carry) { const b = new Uint8Array(carry.length + value.length); b.set(carry); b.set(value, carry.length); bytes = b; carry = null; }
      const even = bytes.length - (bytes.length % 4); // whole stereo frames only
      if (even < bytes.length) carry = bytes.slice(even);
      if (!even) continue;
      const pcm = new Int16Array(even / 2);
      new Uint8Array(pcm.buffer).set(bytes.subarray(0, even));
      node.port.postMessage(pcm, [pcm.buffer]);
      if (ctx.state === 'suspended') ctx.resume();
    }
  } catch (e) {}
  label.textContent = 'MirroX game sound: waiting for mirroring…';
  setTimeout(run, 1000);
}
run();
</script></body></html>`;

class ObsAudioServer extends EventEmitter {
  constructor(port = PORT) {
    super();
    this.clients = new Set();
    this.server = null;
    this.port = port;
  }

  url() {
    return `http://127.0.0.1:${this.port}/`;
  }

  start() {
    if (this.server) return;
    const worklet = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'mirror', 'pcm-worklet.js'), 'utf8');
    this.server = http.createServer((req, res) => {
      const url = (req.url || '/').split('?')[0];
      if (url === '/' || url === '/audio') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(PAGE);
      }
      if (url === '/pcm-worklet.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
        return res.end(worklet);
      }
      if (url === '/pcm') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.socket.setNoDelay(true);
        this.clients.add(res);
        req.on('close', () => this.clients.delete(res));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    this.server.on('error', (err) => {
      console.error('[obs-audio]', err.message);
      this.emit('error', err);
    });
    this.server.listen(this.port, '127.0.0.1');
  }

  // Raw 16-bit stereo 48 kHz PCM from the phone.
  push(pcm) {
    for (const res of this.clients) {
      // A slow listener is dropped rather than building up delay.
      if (res.writableLength > 48000 * 4 * 0.5) {
        res.destroy();
        this.clients.delete(res);
        continue;
      }
      res.write(pcm);
    }
  }

  get listening() {
    return this.clients.size > 0;
  }

  stop() {
    for (const res of this.clients) res.destroy();
    this.clients.clear();
    if (this.server) this.server.close();
    this.server = null;
  }
}

module.exports = { ObsAudioServer, OBS_AUDIO_PORT: PORT };
