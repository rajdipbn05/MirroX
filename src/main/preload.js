// Safe bridge between the interface (renderer) and the main process.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mirrox', {
  getDevices: () => ipcRenderer.invoke('get-devices'),
  startMirror: (device) => ipcRenderer.invoke('start-mirror', device),
  stopMirror: () => ipcRenderer.invoke('stop-mirror'),
  onDevices: (cb) => ipcRenderer.on('devices', (_e, payload) => cb(payload)),
  onMirrorState: (cb) => ipcRenderer.on('mirror-state', (_e, payload) => cb(payload)),
});
