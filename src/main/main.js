// MirroX main process: owns the window, watches for phones, and runs the mirroring engine.

const path = require('path');
const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const { DeviceWatcher } = require('./android/devices');
const { Mirror } = require('./android/mirror');
const { adb } = require('./android/adb');

let win;
const watcher = new DeviceWatcher();
const mirror = new Mirror();

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 420,
    minHeight: 520,
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
  watcher.on('change', (payload) => send('devices', payload));
  mirror.on('state', (s) => send('mirror-state', s));
  watcher.start();

  ipcMain.handle('get-devices', () => (watcher.lastJson ? JSON.parse(watcher.lastJson) : null));
  ipcMain.handle('start-mirror', (_e, device) => mirror.start(device));
  ipcMain.handle('stop-mirror', () => mirror.stop());
  ipcMain.handle('copy-text', (_e, text) => clipboard.writeText(String(text)));
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  watcher.stop();
  mirror.stop();
  // Stop the background ADB helper so it doesn't keep running after MirroX closes.
  adb(['kill-server'], { timeout: 3000 }).catch(() => {});
});
