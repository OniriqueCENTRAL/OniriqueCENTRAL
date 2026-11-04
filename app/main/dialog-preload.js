// La fenêtre de confirmation de l'application : sa réponse repart vers la page qui attend.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oniriqueAnswer', (value) => ipcRenderer.send('dialog:answer', value));
