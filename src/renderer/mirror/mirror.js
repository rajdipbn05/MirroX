// The mirror window: shows the phone's picture, plays its sound, and sends mouse/keyboard input.
// The connection to the phone lives in MirroX's main process (so this window can be swapped
// between normal and borderless without dropping it); packets arrive here over IPC.

const { ipcRenderer } = require('electron');
const P = require('../../shared/scrcpy-protocol');
const { KEYCODES, ANDROID_HOME, metaState } = require('../../shared/keycodes');

const $ = (id) => document.getElementById(id);
const canvas = $('screen');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

let mode = 'normal';
let videoSize = { width: 0, height: 0 }; // current video size, as the phone sees it

const sendControl = (buf) => ipcRenderer.send('mirror:control', buf);

// ---------- Video ----------

let decoder = null;
let decoderCodec = null;
let decoderConfig = null; // the SPS/PPS the decoder was set up with
let pendingConfig = null;
let waitingKeyFrame = true;
let decoderErrors = 0;
const recvTimes = new Map(); // timestamp -> time received (for the "decoding … ms" number)
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
      decoderConfig = null; // re-create on the next config
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
  window.__frames = (window.__frames || 0) + 1; // read by automated tests
  if (firstFrame) {
    firstFrame = false;
    $('status').hidden = true;
    ipcRenderer.send('mirror:first-frame');
  }
}

ipcRenderer.on('video', (_e, p) => {
  const data = Buffer.from(p.data.buffer, p.data.byteOffset, p.data.byteLength);
  if (p.config) {
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
  } else if (decoderConfig && waitingKeyFrame && p.key) {
    payload = Buffer.concat([decoderConfig, data]); // key frame without new config: repeat SPS/PPS
  }
  if (!decoder || decoder.state !== 'configured') return;
  if (waitingKeyFrame && !p.key) return;
  waitingKeyFrame = false;
  recvTimes.set(p.pts, performance.now());
  if (recvTimes.size > 240) recvTimes.delete(recvTimes.keys().next().value);
  decoder.decode(new EncodedVideoChunk({ type: p.key ? 'key' : 'delta', timestamp: p.pts, data: payload }));
});

ipcRenderer.on('session', (_e, s) => {
  videoSize = { width: s.width, height: s.height };
});

// ---------- Audio ----------

let audioNode = null;
let audioCtx = null;
ipcRenderer.on('audio-start', async () => {
  if (audioCtx) return;
  audioCtx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  await audioCtx.audioWorklet.addModule('pcm-worklet.js');
  audioNode = new AudioWorkletNode(audioCtx, 'pcm-player', { outputChannelCount: [2] });
  audioNode.connect(audioCtx.destination);
});
ipcRenderer.on('audio', (_e, data) => {
  if (!audioNode) return;
  // Copy into an aligned buffer (Int16Array needs an even byte offset).
  const pcm = new Int16Array(data.byteLength >> 1);
  new Uint8Array(pcm.buffer).set(data.subarray(0, pcm.length * 2));
  audioNode.port.postMessage(pcm, [pcm.buffer]);
  if (audioCtx.state === 'suspended') audioCtx.resume();
});

// ---------- Control: mouse + keyboard -> phone ----------

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
  touching = false;
});

// ---------- Window modes, toolbar, overlay ----------

function applyMode(m) {
  mode = m.mode;
  document.body.className = `mode-${mode}`;
  for (const el of document.querySelectorAll('.pin')) el.classList.toggle('on', !!m.alwaysOnTop);
  $('ov-exit-label').textContent = mode === 'fullscreen' ? 'Exit fullscreen' : 'Normal window';
  $('ov-swap-label').textContent = mode === 'fullscreen' ? 'Borderless' : 'Fullscreen';
  $('ov-swap').dataset.action = mode === 'fullscreen' ? 'borderless' : 'fullscreen';
  if (m.hint) showHint(m.hint);
}

let hintTimer;
function showHint(text) {
  $('hint').textContent = text;
  $('hint').hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => ($('hint').hidden = true), 6000);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (btn) ipcRenderer.send('mirror:action', btn.dataset.action);
});

// Double-click the top toolbar in fullscreen to leave fullscreen.
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
  $('tb-fps').textContent = firstFrame ? 'Connecting…' : `${stats.fps} FPS`;
  if (!firstFrame) ipcRenderer.send('mirror:stats', stats);
}, 1000);

// ---------- Start ----------

ipcRenderer.on('mode', (_e, m) => applyMode(m));
ipcRenderer.once('init', (_e, o) => applyMode(o));
ipcRenderer.send('mirror:ready');
