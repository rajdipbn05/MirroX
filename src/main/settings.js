// Saves and loads the user's choices (preset, custom settings) between launches.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { DEFAULT_SETTINGS, PRESETS, sanitize } = require('./android/presets');

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return {
      preset: raw.preset === 'custom' || PRESETS[raw.preset] ? raw.preset : DEFAULT_SETTINGS.preset,
      custom: sanitize({ ...DEFAULT_SETTINGS.custom, ...(raw.custom || {}) }),
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
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

module.exports = { load, save };
