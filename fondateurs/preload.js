const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oni', {
  action: (name) => ipcRenderer.invoke('action', name),
  changes: () => ipcRenderer.invoke('changes'),
  commit: (files, message) => ipcRenderer.invoke('commit', files, message),
  health: () => ipcRenderer.invoke('health'),
  open: (what) => ipcRenderer.invoke('open', what),
  onLog: (fn) => ipcRenderer.on('log', (_e, text) => fn(text)),
});
