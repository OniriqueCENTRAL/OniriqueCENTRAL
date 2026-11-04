// CUT et CLOUD dans l'application : leurs fenêtres « OK / Annuler » (alert, confirm, prompt) passent par l'application,
// qui les dessine à sa DA au lieu de la boîte de Windows. L'appel attend la réponse, comme celui du navigateur.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oniriqueDialog', (kind, message, value) =>
  ipcRenderer.sendSync('tool:dialog', String(kind), String(message ?? ''), value == null ? '' : String(value)));
