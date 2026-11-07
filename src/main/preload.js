// Safe bridge between the interface (renderer) and the main process.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mirrox', {
  getState: () => ipcRenderer.invoke('get-state'),
  startMirror: () => ipcRenderer.invoke('start-mirror'),
  stopMirror: () => ipcRenderer.invoke('stop-mirror'),
  restartMirror: () => ipcRenderer.invoke('restart-mirror'),
  setSettings: (s) => ipcRenderer.invoke('set-settings', s),
  setWindow: (w) => ipcRenderer.invoke('set-window', w),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  openLink: (url) => ipcRenderer.invoke('open-link', url),
  closeApps: () => ipcRenderer.invoke('close-apps'),
  onPhoneState: (cb) => ipcRenderer.on('phone-state', (_e, s) => cb(s)),
  onMirrorState: (cb) => ipcRenderer.on('mirror-state', (_e, s) => cb(s)),
  onMirrorStats: (cb) => ipcRenderer.on('mirror-stats', (_e, s) => cb(s)),
  onWindowState: (cb) => ipcRenderer.on('window-state', (_e, s) => cb(s)),
  onDisplays: (cb) => ipcRenderer.on('displays', (_e, s) => cb(s)),
});
