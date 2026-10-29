// Puente de la ventana flotante del asistente por voz (renderer/overlay.*)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('assist', {
  on: (cb) => ipcRenderer.on('assist', (_e, type, data) => cb(type, data)),
  transcribe: (audio) => ipcRenderer.invoke('voice:transcribe', audio),
  prepare: () => ipcRenderer.invoke('voice:prepare'),
  send: (payload) => ipcRenderer.invoke('assist:send', payload),
  phase: (p) => ipcRenderer.send('assist:phase', p),
  size: (h) => ipcRenderer.send('assist:size', h),
  focus: () => ipcRenderer.send('assist:focus'),
  open: () => ipcRenderer.send('assist:open'),
  close: () => ipcRenderer.send('assist:close'),
});
