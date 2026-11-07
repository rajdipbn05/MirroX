// MirroX main process: owns the windows, watches for phones, and runs mirroring.

const path = require('path');
const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const { DeviceWatcher } = require('./android/devices');
const { Mirror } = require('./android/mirror'); // classic engine (scrcpy's own window), kept as a fallback
const { adb } = require('./android/adb');
const platform = require('./platform');
const settingsStore = require('./settings');
const presets = require('./android/presets');
const { MirrorController } = require('./mirror-window');

let win;
let settings; // loaded once the app is ready
const watcher = new DeviceWatcher();
const classic = new Mirror();
let controller; // created once the app is ready (needs the screen module)
let active = null; // the engine currently mirroring: controller or classic

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function saveSettings() {
  settingsStore.save(settings);
}

// Settings store for the mirror window (position/size, mode, always-on-top, hints).
const windowStore = {
  get: () => settings.window,
  set: (partial) => {
    settings.window = { ...settings.window, ...partial };
    saveSettings();
  },
};

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 820,
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
  // Closing the main window closes MirroX (including any mirror window).
  win.on('closed', () => app.quit());
}

function engineFor() {
  return settings.classic ? classic : controller;
}

function startMirror() {
  const s = watcher.current;
  const testPort = Number(process.env.MIRROX_TEST_MIRROR_PORT) || 0; // automated tests only
  if (!testPort && !(s && s.ready)) return;
  if ((active && active.running) || controller.running || classic.running) return;
  const perf = presets.effectiveSettings(settings);
  active = testPort ? controller : engineFor();
  if (active === classic) {
    const w = controller.modeInfo();
    classic.start({ serial: s.serial, name: s.name }, { ...perf, fullscreen: w.mode === 'fullscreen', borderless: w.mode === 'borderless', alwaysOnTop: w.alwaysOnTop });
  } else {
    controller.start(testPort ? { testPort, name: 'Test phone' } : { serial: s.serial, name: s.name }, perf);
  }
}

function stopMirror() {
  controller.stop();
  classic.stop();
}

app.whenReady().then(() => {
  settings = settingsStore.load();
  controller = new MirrorController(windowStore, () => (win && !win.isDestroyed() ? win.getBounds() : null));
  createWindow();

  watcher.on('change', (state) => send('phone-state', state));
  for (const engine of [controller, classic]) {
    engine.on('state', (s) => send('mirror-state', s));
    engine.on('stats', (s) => send('mirror-stats', s));
  }
  controller.on('window', (w) => send('window-state', w));
  watcher.start();

  ipcMain.handle('get-state', () => ({
    phone: watcher.current,
    version: app.getVersion(),
    settings: { preset: settings.preset, custom: settings.custom, classic: settings.classic },
    window: controller.modeInfo(),
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
    settings.preset = preset;
    settings.custom = presets.sanitize({ ...settings.custom, ...(next.custom || {}) });
    if (typeof next.classic === 'boolean') settings.classic = next.classic;
    saveSettings();
    return { preset: settings.preset, custom: settings.custom, classic: settings.classic };
  });

  // Window options: applied right away to an open mirror window, otherwise remembered for next time.
  ipcMain.handle('set-window', (_e, w) => {
    if (typeof w.alwaysOnTop === 'boolean') controller.setAlwaysOnTop(w.alwaysOnTop);
    if (typeof w.mode === 'string') controller.setMode(w.mode);
    return controller.modeInfo();
  });

  ipcMain.handle('start-mirror', startMirror);
  ipcMain.handle('restart-mirror', () => {
    const engine = active;
    if (!engine || !engine.running) return startMirror();
    engine.once('state', (st) => st.state !== 'starting' && setTimeout(startMirror, 500));
    engine.stop();
  });
  ipcMain.handle('stop-mirror', stopMirror);

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

  // Automated tests: open the mirror window against a fake phone server.
  if (process.env.MIRROX_TEST_MIRROR_PORT) win.webContents.once('did-finish-load', () => setTimeout(startMirror, 500));
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  watcher.stop();
  stopMirror();
  // Stop the background ADB helper so it doesn't keep running after MirroX closes.
  adb(['kill-server'], { timeout: 3000 }).catch(() => {});
});
