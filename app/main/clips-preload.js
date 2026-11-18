const { contextBridge, ipcRenderer } = require('electron');

// La fenêtre cachée qui enregistre les clips (voir clips.js et renderer/clips-recorder.js).
contextBridge.exposeInMainWorld('clipsRec', {
  onSave: (listener) => ipcRenderer.on('clips-rec:save', () => listener()),
  saved: (bytes, meta) => ipcRenderer.send('clips-rec:saved', bytes, meta),
  error: (message) => ipcRenderer.send('clips-rec:error', String(message)),
  warn: (message) => ipcRenderer.send('clips-rec:warn', String(message)),
  onPcm: (listener) => ipcRenderer.on('clips-rec:pcm', (_event, chunk) => listener(chunk)),
});
