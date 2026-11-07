// MirroX main process: owns the window, watches for phones, and runs the mirroring engine.

const path = require('path');
const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const { DeviceWatcher } = require('./android/devices');
const { Mirror } = require('./android/mirror');
const { adb } = require('./android/adb');
const platform = require('./platform');
const settingsStore = require('./settings');
const presets = require('./android/presets');

let win;
const watcher = new DeviceWatcher();
const mirror = new Mirror();
let settings; // loaded once the app is ready

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 800,
    minWidth: 460,
    minHeight: 600,
    title: 'MirroX',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  settings = settingsStore.load();
  createWindow();
  watcher.on('change', (state) => send('phone-state', state));
  mirror.on('state', (s) => send('mirror-state', s));
  mirror.on('stats', (s) => send('mirror-stats', s));
  watcher.start();

  ipcMain.handle('get-state', () => ({
    phone: watcher.current,
    version: app.getVersion(),
    settings,
    presets: presets.PRESETS,
    choices: {
      resolutions: presets.RESOLUTIONS,
      fps: presets.FPS_CHOICES,
      bitrateMin: presets.BITRATE_MIN,
      bitrateMax: presets.BITRATE_MAX,
    },
  }));

  // Saves the preset choice / custom values; returns what is now saved.
  ipcMain.handle('set-settings', (_e, next) => {
    const preset = next.preset === 'custom' || presets.PRESETS[next.preset] ? next.preset : settings.preset;
    settings = { preset, custom: presets.sanitize({ ...settings.custom, ...(next.custom || {}) }) };
    settingsStore.save(settings);
    return settings;
  });

  const startMirror = () => {
    const s = watcher.current;
    if (s && s.ready) mirror.start({ serial: s.serial, name: s.name }, presets.effectiveSettings(settings));
  };
  ipcMain.handle('start-mirror', startMirror);
  ipcMain.handle('restart-mirror', () => {
    if (!mirror.running) return startMirror();
    mirror.once('state', (st) => st.state !== 'starting' && setTimeout(startMirror, 500));
    mirror.stop();
  });
  ipcMain.handle('stop-mirror', () => mirror.stop());

  ipcMain.handle('copy-text', (_e, text) => clipboard.writeText(String(text)));

  ipcMain.handle('open-link', (_e, url) => {
    if (/^https:\/\//.test(String(url))) shell.openExternal(String(url));
  });

  // Only closes programs that MirroX itself identified as blocking the phone.
  ipcMain.handle('close-apps', async () => {
    const action = ((watcher.current && watcher.current.actions) || []).find((a) => a.type === 'close-apps');
    if (!action) return { ok: false, output: 'Nothing to close.' };
    const result = await platform.killProcesses(action.pids);
    watcher.refreshSoon();
    return result;
  });
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  watcher.stop();
  mirror.stop();
  // Stop the background ADB helper so it doesn't keep running after MirroX closes.
  adb(['kill-server'], { timeout: 3000 }).catch(() => {});
});
