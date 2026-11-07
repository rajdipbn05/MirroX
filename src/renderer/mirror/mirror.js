// The mirror window: connects to scrcpy-server on the phone, shows the video, plays the sound,
// and sends mouse/keyboard input to the phone.
//
// This window runs with Node access (it only ever loads this local file) so it can read the
// video socket directly, which avoids an extra copy and keeps delay as low as possible.

const net = require('net');
const path = require('path');
const { ipcRenderer } = require('electron');
const P = require('../../shared/scrcpy-protocol');
const { KEYCODES, ANDROID_HOME, metaState } = require('../../shared/keycodes');

const $ = (id) => document.getElementById(id);
const canvas = $('screen');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

let opts = null; // from main: { port, audio, screenOff, mode, alwaysOnTop, title }
let mode = 'normal';
let control = null; // control socket
let videoSize = { width: 0, height: 0 }; // current video size, as the phone sees it
let closing = false;

// ---------- Socket reading ----------

class Reader {
  constructor(socket) {
    this.socket = socket;
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
      await new Promise((resolve) => {
        this.waiter = { n, resolve };
      });
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

// The first socket must receive one "dummy" byte: until the server is listening on the phone,
// adb accepts the connection and immediately closes it, so retry (like scrcpy: 100 × 100 ms).
async function connectFirst(port) {
  let lastErr;
  for (let i = 0; i < 100 && !closing; i++) {
    try {
      const s = await connect(port);
      s.setNoDelay(true);
      const r = new Reader(s);
      await r.read(1);
      return { socket: s, reader: r };
    } catch (err) {
      lastErr = err;
      await sleep(100);
    }
  }
  throw lastErr || new Error('cancelled');
}

// ---------- Video ----------

let decoder = null;
let decoderCodec = null;
let decoderConfig = null; // the SPS/PPS the decoder was set up with
let decoderErrors = 0;
let pendingConfig = null;
let waitingKeyFrame = true;
const recvTimes = new Map(); // timestamp -> time received (for the delay statistic)
let framesThisSecond = 0;
let decodeMsSum = 0;
let decodeMsCount = 0;
let firstFrame = true;

// A new decoder is made whenever the phone changes its video format (e.g. on rotation):
// some Windows decoders can't switch picture size in the middle of a stream.
function makeDecoder(codec, config) {
  if (decoder && decoder.state !== 'closed') decoder.close();
  decoder = new VideoDecoder({
    output: onFrame,
    error: (e) => {
      console.error('decoder error', e);
      decoderErrors++;
      window.__decoderErrors = decoderErrors; // read by automated tests
      waitingKeyFrame = true;
      decoderCodec = null; // re-create on next config
      sendControl(P.simple(P.MSG.RESET_VIDEO)); // ask the phone for a fresh key frame
    },
  });
  const conf = { codec, optimizeForLatency: true, hardwareAcceleration: 'no-preference' };
  if (videoSize.width) Object.assign(conf, { codedWidth: videoSize.width, codedHeight: videoSize.height });
  decoder.configure(conf);
  decoderCodec = codec;
  decoderConfig = config;
}

function onFrame(frame) {
  const w = frame.displayWidth;
  const h = frame.displayHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    ipcRenderer.send('mirror:size', { width: w, height: h });
  }
  ctx.drawImage(frame, 0, 0, w, h);
  const t = recvTimes.get(frame.timestamp);
  if (t !== undefined) {
    decodeMsSum += performance.now() - t;
    decodeMsCount++;
    recvTimes.delete(frame.timestamp);
  }
  frame.close();
  framesThisSecond++;
  if (firstFrame) {
    firstFrame = false;
    $('status').hidden = true;
  }
}

function onVideoPacket(h, data) {
  if (h.config) {
    pendingConfig = Buffer.from(data);
    return;
  }
  let payload = data;
  if (pendingConfig) {
    const codec = P.h264CodecString(pendingConfig);
    const changed = !decoderConfig || !pendingConfig.equals(decoderConfig);
    if (!decoder || decoder.state === 'closed' || codec !== decoderCodec || changed) {
      makeDecoder(codec, pendingConfig);
      waitingKeyFrame = true;
    }
    payload = Buffer.concat([pendingConfig, data]);
    pendingConfig = null;
  }
  if (!decoder || decoder.state !== 'configured') return;
  if (waitingKeyFrame && !h.keyFrame) return;
  waitingKeyFrame = false;
  recvTimes.set(h.pts, performance.now());
  if (recvTimes.size > 240) recvTimes.delete(recvTimes.keys().next().value);
  decoder.decode(new EncodedVideoChunk({ type: h.keyFrame ? 'key' : 'delta', timestamp: h.pts, data: payload }));
}

async function readVideo(reader) {
  const codec = (await reader.read(4)).readUInt32BE(0);
  if (codec === P.CODEC.ERROR) throw userError('Your phone could not start sending its screen at these settings. Try a lower resolution or quality in Advanced settings.');
  if (codec !== P.CODEC.H264) throw userError(`Unexpected video format from the phone (${codec.toString(16)}).`);
  for (;;) {
    const h = P.parseHeader(await reader.read(P.HEADER_SIZE));
    if (h.session) {
      videoSize = { width: h.width, height: h.height };
      continue;
    }
    onVideoPacket(h, await reader.read(h.size));
  }
}

// ---------- Audio ----------

async function readAudio(reader) {
  const codec = (await reader.read(4)).readUInt32BE(0);
  if (codec !== P.CODEC.RAW) return; // disabled by the phone (Android < 11) or error: video only
  const ac = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  await ac.audioWorklet.addModule('pcm-worklet.js');
  const node = new AudioWorkletNode(ac, 'pcm-player', { outputChannelCount: [2] });
  node.connect(ac.destination);
  for (;;) {
    const h = P.parseHeader(await reader.read(P.HEADER_SIZE));
    const data = await reader.read(h.size);
    if (h.config) continue;
    // Copy into an aligned buffer (Int16Array needs an even byte offset).
    const pcm = new Int16Array(data.length >> 1);
    Buffer.from(pcm.buffer).set(data.subarray(0, pcm.length * 2));
    node.port.postMessage(pcm, [pcm.buffer]);
    if (ac.state === 'suspended') ac.resume();
  }
}

// ---------- Control: mouse + keyboard -> phone ----------

function sendControl(buf) {
  if (control && !control.destroyed) control.write(buf);
}

// Window coordinates -> phone video coordinates (the picture is letterboxed inside the canvas).
function toPhone(e, clamp) {
  const r = canvas.getBoundingClientRect();
  const W = canvas.width;
  const H = canvas.height;
  if (!W || !H || !videoSize.width) return null;
  const scale = Math.min(r.width / W, r.height / H);
  const left = r.left + (r.width - W * scale) / 2;
  const top = r.top + (r.height - H * scale) / 2;
  let x = ((e.clientX - left) / scale) * (videoSize.width / W);
  let y = ((e.clientY - top) / scale) * (videoSize.height / H);
  const inside = x >= 0 && y >= 0 && x < videoSize.width && y < videoSize.height;
  if (!inside && !clamp) return null;
  x = Math.max(0, Math.min(videoSize.width - 1, x));
  y = Math.max(0, Math.min(videoSize.height - 1, y));
  return { x, y, width: videoSize.width, height: videoSize.height };
}

let touching = false;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 0) {
    const pos = toPhone(e, false);
    if (!pos) return;
    touching = true;
    canvas.setPointerCapture(e.pointerId);
    sendControl(P.injectTouch(P.ACTION.DOWN, P.POINTER_ID_MOUSE, pos, 1, P.BUTTON.PRIMARY, P.BUTTON.PRIMARY));
  } else if (e.button === 2) {
    sendControl(P.backOrScreenOn(P.ACTION.DOWN)); // right click = Back
  } else if (e.button === 1) {
    sendControl(P.injectKeycode(P.ACTION.DOWN, ANDROID_HOME)); // middle click = Home
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!touching) return;
  const pos = toPhone(e, true);
  if (pos) sendControl(P.injectTouch(P.ACTION.MOVE, P.POINTER_ID_MOUSE, pos, 1, 0, P.BUTTON.PRIMARY));
});
canvas.addEventListener('pointerup', (e) => {
  if (e.button === 0 && touching) {
    touching = false;
    const pos = toPhone(e, true);
    if (pos) sendControl(P.injectTouch(P.ACTION.UP, P.POINTER_ID_MOUSE, pos, 0, P.BUTTON.PRIMARY, 0));
  } else if (e.button === 2) {
    sendControl(P.backOrScreenOn(P.ACTION.UP));
  } else if (e.button === 1) {
    sendControl(P.injectKeycode(P.ACTION.UP, ANDROID_HOME));
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('auxclick', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const pos = toPhone(e, true);
    if (!pos) return;
    const unit = e.deltaMode === 1 ? 1 : 100; // lines or pixels
    sendControl(P.injectScroll(pos, -e.deltaX / unit, -e.deltaY / unit));
  },
  { passive: false }
);

const keysDown = new Set();
window.addEventListener('keydown', (e) => {
  // MirroX's own shortcuts first.
  if (e.altKey && e.code === 'KeyF') {
    e.preventDefault();
    if (!e.repeat) ipcRenderer.send('mirror:action', 'toggle');
    return;
  }
  if (e.code === 'F11') {
    e.preventDefault();
    if (!e.repeat) ipcRenderer.send('mirror:action', mode === 'fullscreen' ? 'normal' : 'fullscreen');
    return;
  }
  if (e.code === 'Escape' && mode === 'fullscreen') {
    e.preventDefault();
    ipcRenderer.send('mirror:action', 'normal');
    return;
  }
  const code = KEYCODES[e.code];
  if (code === undefined) return;
  e.preventDefault();
  keysDown.add(e.code);
  sendControl(P.injectKeycode(P.ACTION.DOWN, code, e.repeat ? 1 : 0, metaState(e)));
});
window.addEventListener('keyup', (e) => {
  const code = KEYCODES[e.code];
  if (code === undefined || !keysDown.has(e.code)) return;
  e.preventDefault();
  keysDown.delete(e.code);
  sendControl(P.injectKeycode(P.ACTION.UP, code, 0, metaState(e)));
});
// Never leave a key "stuck down" on the phone when the window loses focus.
window.addEventListener('blur', () => {
  for (const c of keysDown) sendControl(P.injectKeycode(P.ACTION.UP, KEYCODES[c]));
  keysDown.clear();
  if (touching) touching = false;
});

// ---------- Window modes, toolbar, overlay ----------

function applyMode(m, { alwaysOnTop, hint }) {
  mode = m;
  document.body.className = `mode-${m}`;
  for (const el of document.querySelectorAll('.pin')) el.classList.toggle('on', !!alwaysOnTop);
  $('ov-exit-label').textContent = m === 'fullscreen' ? 'Exit fullscreen' : 'Normal window';
  $('ov-swap-label').textContent = m === 'fullscreen' ? 'Borderless' : 'Fullscreen';
  $('ov-swap').dataset.action = m === 'fullscreen' ? 'borderless' : 'fullscreen';
  if (hint) showHint(hint);
}

let hintTimer;
function showHint(text) {
  $('hint').textContent = text;
  $('hint').hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => ($('hint').hidden = true), 5000);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (btn) ipcRenderer.send('mirror:action', btn.dataset.action);
});

// Double-click the toolbar (fullscreen) to leave fullscreen.
$('overlay').addEventListener('dblclick', (e) => {
  if (!e.target.closest('button') && mode === 'fullscreen') ipcRenderer.send('mirror:action', 'normal');
});

// Show the toolbar when the mouse reaches the top edge; hide it shortly after the mouse leaves.
let overlayTimer;
const openOverlay = () => {
  clearTimeout(overlayTimer);
  document.body.classList.add('overlay-open');
};
const closeOverlaySoon = () => {
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => document.body.classList.remove('overlay-open'), 1200);
};
$('edge').addEventListener('mouseenter', openOverlay);
$('edge').addEventListener('mouseleave', closeOverlaySoon);
$('overlay').addEventListener('mouseenter', openOverlay);
$('overlay').addEventListener('mouseleave', closeOverlaySoon);
document.addEventListener('mousemove', (e) => {
  if (mode !== 'normal' && e.clientY <= 4) openOverlay();
});

// ---------- Stats ----------

setInterval(() => {
  const stats = {
    fps: framesThisSecond,
    width: canvas.width,
    height: canvas.height,
    decodeMs: decodeMsCount ? Math.round(decodeMsSum / decodeMsCount) : null,
    decoderErrors,
  };
  framesThisSecond = 0;
  decodeMsSum = 0;
  decodeMsCount = 0;
  $('tb-fps').textContent = firstFrame ? '' : `· ${stats.fps} FPS`;
  if (!firstFrame) ipcRenderer.send('mirror:stats', stats);
}, 1000);

// ---------- Start ----------

function userError(message) {
  const e = new Error(message);
  e.userMessage = message;
  return e;
}

async function start() {
  const { socket: video, reader: videoReader } = await connectFirst(opts.port);
  const deviceName = P.parseDeviceName(await videoReader.read(P.DEVICE_NAME_LENGTH));
  let audioReader = null;
  if (opts.audio) {
    const a = await connect(opts.port);
    audioReader = new Reader(a);
  }
  control = await connect(opts.port);
  control.setNoDelay(true);
  control.on('data', () => {}); // messages from the phone (clipboard etc.) are not used yet
  control.on('error', () => {});
  if (opts.screenOff) sendControl(P.setDisplayPower(false));

  ipcRenderer.send('mirror:connected', { deviceName });
  $('status').textContent = 'Waiting for the first picture…';

  if (audioReader)
    readAudio(audioReader).catch((err) => {
      if (!closing) console.warn('audio stopped:', err.message);
    });
  await readVideo(videoReader);
}

ipcRenderer.on('mode', (_e, m) => applyMode(m.mode, m));
ipcRenderer.on('closing', () => {
  closing = true;
});
ipcRenderer.once('init', (_e, o) => {
  opts = o;
  $('tb-title').textContent = o.title;
  applyMode(o.mode, o);
  start().catch((err) => {
    if (closing) return;
    ipcRenderer.send('mirror:ended', {
      error: true,
      message: err.userMessage || (firstFrame ? 'MirroX could not connect to your phone.' : 'The connection to your phone was lost.'),
      details: `${err.stack || err}`,
      lost: !firstFrame,
    });
  });
});
ipcRenderer.send('mirror:ready');
