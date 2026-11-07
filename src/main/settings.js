// Saves and loads the user's choices between launches:
//   preset + custom performance settings, mirror-window settings (position/size, mode,
//   always-on-top), one-time hints, and whether to use the new (experimental) MirroX window.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { DEFAULT_SETTINGS, PRESETS, sanitize } = require('./android/presets');

const DEFAULT_WINDOW = {
  bounds: null, // last position/size of the mirror window's content area
  mode: 'normal', // normal | borderless | fullscreen
  alwaysOnTop: false,
  lastSpecialMode: 'fullscreen', // where Alt+F goes from a normal window
  hints: {},
};

// Only keep known window settings (older versions stored a monitor choice, now removed).
function pickWindow(w) {
  const out = JSON.parse(JSON.stringify(DEFAULT_WINDOW));
  if (!w || typeof w !== 'object') return out;
  const b = w.bounds;
  if (b && [b.x, b.y, b.width, b.height].every(Number.isFinite)) out.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  if (['normal', 'borderless', 'fullscreen'].includes(w.mode)) out.mode = w.mode;
  out.alwaysOnTop = !!w.alwaysOnTop;
  if (['borderless', 'fullscreen'].includes(w.lastSpecialMode)) out.lastSpecialMode = w.lastSpecialMode;
  if (w.hints && typeof w.hints === 'object') out.hints = { fullscreen: !!w.hints.fullscreen, borderless: !!w.hints.borderless };
  return out;
}

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function defaults() {
  return { ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), window: JSON.parse(JSON.stringify(DEFAULT_WINDOW)), newWindow: false, control: true };
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return {
      preset: raw.preset === 'custom' || PRESETS[raw.preset] ? raw.preset : DEFAULT_SETTINGS.preset,
      custom: sanitize({ ...DEFAULT_SETTINGS.custom, ...(raw.custom || {}) }),
      window: pickWindow(raw.window),
      newWindow: !!raw.newWindow, // default off: scrcpy's own window is the default
      control: raw.control !== false, // keyboard & mouse control of the phone (default on)
    };
  } catch {
    return defaults();
  }
}

function save(settings) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[settings] could not save', err.message);
  }
}

module.exports = { load, save, DEFAULT_WINDOW };
