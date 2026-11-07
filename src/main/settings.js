// Saves and loads the user's choices between launches:
//   preset + custom performance settings, mirror-window settings (monitor, always-on-top,
//   position/size/mode per monitor), one-time hints, and the classic-engine fallback switch.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { DEFAULT_SETTINGS, PRESETS, sanitize } = require('./android/presets');

const DEFAULT_WINDOW = {
  monitor: 'primary',
  alwaysOnTop: false,
  byDisplay: {}, // displayId -> { bounds, mode }
  lastSpecialMode: 'fullscreen', // where Alt+F goes from a normal window
  hints: {},
};

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function defaults() {
  return { ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), window: JSON.parse(JSON.stringify(DEFAULT_WINDOW)), classic: false };
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return {
      preset: raw.preset === 'custom' || PRESETS[raw.preset] ? raw.preset : DEFAULT_SETTINGS.preset,
      custom: sanitize({ ...DEFAULT_SETTINGS.custom, ...(raw.custom || {}) }),
      window: { ...DEFAULT_WINDOW, ...(raw.window && typeof raw.window === 'object' ? raw.window : {}) },
      classic: !!raw.classic,
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
