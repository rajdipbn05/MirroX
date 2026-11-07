// The binary protocol spoken by scrcpy-server 5.0.1 (the part of scrcpy that runs on the phone).
// Pure functions, no I/O: used by the mirror window and by tests.
// Reference: scrcpy v5.0.1 app/src/demuxer.c, app/src/control_msg.c, server Streamer.java.

const SCRCPY_VERSION = '5.0.1';

const CODEC = {
  H264: 0x68323634, // "h264"
  RAW: 0x00726177, // "raw" (16-bit PCM, 48 kHz, stereo)
  DISABLED: 0, // stream explicitly disabled by the phone (e.g. audio on Android < 11)
  ERROR: 1, // configuration error on the phone
};

const DEVICE_NAME_LENGTH = 64;
const HEADER_SIZE = 12;

// ---------- Reading the video/audio stream ----------

// 12-byte header: either a "session" header (video size; MSB set) or a media packet header.
function parseHeader(buf) {
  if (buf[0] & 0x80) {
    return { session: true, width: buf.readUInt32BE(4), height: buf.readUInt32BE(8), clientResized: !!(buf[3] & 1) };
  }
  const hi = buf.readUInt32BE(0);
  return {
    session: false,
    config: !!(hi & 0x40000000), // bit 62
    keyFrame: !!(hi & 0x20000000), // bit 61
    pts: (hi & 0x1fffffff) * 2 ** 32 + buf.readUInt32BE(4), // microseconds
    size: buf.readUInt32BE(8),
  };
}

// Device name: 64 bytes, NUL-terminated UTF-8.
function parseDeviceName(buf) {
  const end = buf.indexOf(0);
  return buf.subarray(0, end < 0 ? buf.length : end).toString('utf8');
}

// ---------- H.264 helpers ----------

// Splits an Annex B buffer into NAL units (without start codes).
function splitNals(buf) {
  const nals = [];
  let start = -1;
  for (let i = 0; i + 2 < buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && (buf[i + 2] === 1 || (buf[i + 2] === 0 && buf[i + 3] === 1))) {
      const scLen = buf[i + 2] === 1 ? 3 : 4;
      if (start >= 0) nals.push(buf.subarray(start, i));
      start = i + scLen;
      i += scLen - 1;
    }
  }
  if (start >= 0 && start < buf.length) nals.push(buf.subarray(start));
  return nals;
}

// WebCodecs codec string ("avc1.PPCCLL") from the SPS in a config packet.
function h264CodecString(configPacket) {
  const sps = splitNals(configPacket).find((n) => (n[0] & 0x1f) === 7);
  if (!sps || sps.length < 4) return 'avc1.42E01F'; // baseline 3.1 as a safe default
  const hex = (b) => b.toString(16).padStart(2, '0').toUpperCase();
  return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`;
}

// ---------- Control messages (computer -> phone) ----------

const MSG = {
  INJECT_KEYCODE: 0,
  INJECT_TEXT: 1,
  INJECT_TOUCH_EVENT: 2,
  INJECT_SCROLL_EVENT: 3,
  BACK_OR_SCREEN_ON: 4,
  EXPAND_NOTIFICATION_PANEL: 5,
  EXPAND_SETTINGS_PANEL: 6,
  COLLAPSE_PANELS: 7,
  GET_CLIPBOARD: 8,
  SET_CLIPBOARD: 9,
  SET_DISPLAY_POWER: 10,
  ROTATE_DEVICE: 11,
  RESET_VIDEO: 17,
};

const ACTION = { DOWN: 0, UP: 1, MOVE: 2 };
const BUTTON = { PRIMARY: 1, SECONDARY: 2, TERTIARY: 4 };
const POINTER_ID_MOUSE = -1n;
const POINTER_ID_GENERIC_FINGER = -2n;

function writePosition(buf, offset, { x, y, width, height }) {
  buf.writeInt32BE(Math.round(x), offset);
  buf.writeInt32BE(Math.round(y), offset + 4);
  buf.writeUInt16BE(width, offset + 8);
  buf.writeUInt16BE(height, offset + 10);
}

function injectKeycode(action, keycode, repeat = 0, metaState = 0) {
  const b = Buffer.alloc(14);
  b[0] = MSG.INJECT_KEYCODE;
  b[1] = action;
  b.writeUInt32BE(keycode >>> 0, 2);
  b.writeUInt32BE(repeat >>> 0, 6);
  b.writeUInt32BE(metaState >>> 0, 10);
  return b;
}

function injectText(text) {
  const t = Buffer.from(text, 'utf8').subarray(0, 300);
  const b = Buffer.alloc(5 + t.length);
  b[0] = MSG.INJECT_TEXT;
  b.writeUInt32BE(t.length, 1);
  t.copy(b, 5);
  return b;
}

// position = { x, y, width, height } in video-frame pixels; width/height = current video size.
function injectTouch(action, pointerId, position, pressure, actionButton, buttons) {
  const b = Buffer.alloc(32);
  b[0] = MSG.INJECT_TOUCH_EVENT;
  b[1] = action;
  b.writeBigInt64BE(BigInt(pointerId), 2);
  writePosition(b, 10, position);
  b.writeUInt16BE(pressure >= 1 ? 0xffff : Math.round(pressure * 0x10000), 22);
  b.writeUInt32BE(actionButton >>> 0, 24);
  b.writeUInt32BE(buttons >>> 0, 28);
  return b;
}

// hscroll / vscroll in "wheel notches", range [-16, 16].
function injectScroll(position, hscroll, vscroll, buttons = 0) {
  const fp = (v) => {
    const n = Math.max(-1, Math.min(1, v / 16));
    return n >= 1 ? 0x7fff : Math.round(n * 0x8000);
  };
  const b = Buffer.alloc(21);
  b[0] = MSG.INJECT_SCROLL_EVENT;
  writePosition(b, 1, position);
  b.writeInt16BE(Math.max(-0x8000, Math.min(0x7fff, fp(hscroll))), 13);
  b.writeInt16BE(Math.max(-0x8000, Math.min(0x7fff, fp(vscroll))), 15);
  b.writeUInt32BE(buttons >>> 0, 17);
  return b;
}

function backOrScreenOn(action) {
  return Buffer.from([MSG.BACK_OR_SCREEN_ON, action]);
}

function setDisplayPower(on) {
  return Buffer.from([MSG.SET_DISPLAY_POWER, on ? 1 : 0]);
}

function simple(type) {
  return Buffer.from([type]);
}

// Options passed to the server on its command line.
function serverArgs({ scid, settings, audio }) {
  const s = settings;
  const args = [
    `scid=${scid}`,
    'log_level=info',
    'tunnel_forward=true',
    'video_codec=h264',
    `video_bit_rate=${s.bitrate * 1000000}`,
    `max_fps=${s.maxFps}`,
    'stay_awake=true',
    'clipboard_autosync=false',
  ];
  if (s.maxSize) args.push(`max_size=${s.maxSize}`);
  if (s.lowLatency) args.push('video_codec_options=priority:int=0');
  if (audio) args.push('audio_codec=raw');
  else args.push('audio=false');
  return args;
}

module.exports = {
  SCRCPY_VERSION,
  CODEC,
  DEVICE_NAME_LENGTH,
  HEADER_SIZE,
  parseHeader,
  parseDeviceName,
  splitNals,
  h264CodecString,
  MSG,
  ACTION,
  BUTTON,
  POINTER_ID_MOUSE,
  POINTER_ID_GENERIC_FINGER,
  injectKeycode,
  injectText,
  injectTouch,
  injectScroll,
  backOrScreenOn,
  setDisplayPower,
  simple,
  serverArgs,
};
