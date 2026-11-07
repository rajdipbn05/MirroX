// MirroX main process: owns the window, watches for phones, and runs the mirroring engine.

const path = require('path');
const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const { DeviceWatcher } = require('./android/devices');
const { Mirror } = require('./android/mirror');
const { adb } = require('./android/adb');
const platform = require('./platform');

let win;
const watcher = new DeviceWatcher();
const mirror = new Mirror();

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 700,
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
  createWindow();
  watcher.on('change', (state) => send('phone-state', state));
  mirror.on('state', (s) => send('mirror-state', s));
  watcher.start();

  ipcMain.handle('get-state', () => ({ phone: watcher.current, version: app.getVersion() }));

  ipcMain.handle('start-mirror', () => {
    const s = watcher.current;
    if (s && s.ready) mirror.start({ serial: s.serial, name: s.name });
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
