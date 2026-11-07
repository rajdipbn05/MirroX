// Safe bridge for the bar on top of the mirror window.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mirroxBar', {
  action: (a) => ipcRenderer.send('bar:action', a),
  ready: () => ipcRenderer.send('bar:ready'),
  onInfo: (cb) => ipcRenderer.on('bar:info', (_e, info) => cb(info)),
});
