// Puente de la ventana de recorte de pantalla (renderer/snip.*)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snip', {
  on: (cb) => ipcRenderer.on('snip', (_e, data) => cb(data)),
  ready: () => ipcRenderer.send('snip:ready'),
  done: (rect) => ipcRenderer.send('snip:done', rect),
});
