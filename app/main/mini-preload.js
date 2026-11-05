// Le mini lecteur flottant de CLOUD : il reçoit l'état du son en cours et renvoie les commandes à l'application.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oniriqueMini', {
  onState: (fn) => ipcRenderer.on('mini:state', (_event, state) => fn(state)),
  control: (action, value) => ipcRenderer.send('mini:control', String(action), Number(value) || 0),
});
