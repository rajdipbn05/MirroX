// MirroX main process: owns the windows, watches for phones, and runs mirroring.

const path = require('path');
const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const { DeviceWatcher } = require('./android/devices');
const { Mirror } = require('./android/mirror'); // default engine: scrcpy's own window
const { adb } = require('./android/adb');
const platform = require('./platform');
const settingsStore = require('./settings');
const presets = require('./android/presets');
const { MirrorController } = require('./mirror-window');

let win;
let settings; // loaded once the app is ready
const watcher = new DeviceWatcher();
const classic = new Mirror();
let escExit = null; // Windows: Esc leaves fullscreen in scrcpy's window

// scrcpy's window has no "Esc exits fullscreen" of its own: add it while mirroring (Windows).
function startEscExit(pid) {
  stopEscExit();
  if (process.platform !== 'win32' || !pid) return;
  const { EscExit } = require('./platform/win-keys');
  escExit = new EscExit(pid);
}
function stopEscExit() {
  if (escExit) escExit.stop();
  escExit = null;
}
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
  return settings.newWindow ? controller : classic;
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
    classic.start({ serial: s.serial, name: s.name }, { ...perf, fullscreen: w.mode === 'fullscreen', borderless: w.mode === 'borderless', alwaysOnTop: w.alwaysOnTop, control: settings.control });
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
  controller.control = settings.control;
  createWindow();

  watcher.on('change', (state) => send('phone-state', state));
  for (const engine of [controller, classic]) {
    engine.on('state', (s) => send('mirror-state', s));
    engine.on('stats', (s) => send('mirror-stats', s));
  }
  controller.on('window', (w) => send('window-state', w));

  classic.on('state', (s) => {
    if (s.state === 'running' && classic.proc && !escExit) startEscExit(classic.proc.pid);
    if (s.state === 'stopped' || s.state === 'error') stopEscExit();
  });
  watcher.start();

  ipcMain.handle('get-state', () => ({
    phone: watcher.current,
    version: app.getVersion(),
    settings: { preset: settings.preset, custom: settings.custom, newWindow: settings.newWindow },
    window: controller.modeInfo(),
    control: settings.control,
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
    if (typeof next.newWindow === 'boolean') settings.newWindow = next.newWindow;
    saveSettings();
    return { preset: settings.preset, custom: settings.custom, newWindow: settings.newWindow };
  });

  // Window options: applied right away to an open mirror window, otherwise remembered for next time.
  ipcMain.handle('set-window', (_e, w) => {
    const before = controller.modeInfo();
    if (typeof w.alwaysOnTop === 'boolean') controller.setAlwaysOnTop(w.alwaysOnTop);
    if (typeof w.mode === 'string') controller.setMode(w.mode);
    const after = controller.modeInfo();
    // scrcpy's window: fullscreen can be switched live (Alt+F); borderless / always-on-top
    // only take effect when mirroring is restarted.
    if (classic.running) {
      const fsChanged = (before.mode === 'fullscreen') !== (after.mode === 'fullscreen');
      const otherChanged = (before.mode === 'borderless') !== (after.mode === 'borderless') || before.alwaysOnTop !== after.alwaysOnTop;
      if (fsChanged && process.platform === 'win32' && classic.proc) require('./platform/win-keys').pressKeys(classic.proc.pid, 'alt+f');
      if (otherChanged) return { ...after, restart: true };
    }
    return after;
  });

  // Keyboard & mouse control on/off: live in the MirroX window; scrcpy's window needs a restart.
  ipcMain.handle('set-control', (_e, on) => {
    settings.control = !!on;
    saveSettings();
    controller.setControl(settings.control);
    return { control: settings.control, restart: classic.running };
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

  // Automated tests: Esc-exits-fullscreen on a stand-in window (scripts/smoke-test.js --esc).
  if (process.env.MIRROX_TEST_ESC_PID) startEscExit(Number(process.env.MIRROX_TEST_ESC_PID));

  // Automated tests: open the mirror window against a fake phone server.
  if (process.env.MIRROX_TEST_MIRROR_PORT) win.webContents.once('did-finish-load', () => setTimeout(startMirror, 500));
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  watcher.stop();
  stopEscExit();
  stopMirror();
  // Stop the background ADB helper so it doesn't keep running after MirroX closes.
  adb(['kill-server'], { timeout: 3000 }).catch(() => {});
});
