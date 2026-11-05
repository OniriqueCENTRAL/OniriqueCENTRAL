// CUT et CLOUD dans l'application : leurs fenêtres « OK / Annuler » (alert, confirm, prompt) passent par l'application,
// qui les dessine à sa DA au lieu de la boîte de Windows. L'appel attend la réponse, comme celui du navigateur.
const { contextBridge, ipcRenderer } = require('electron');

// Spotify dans l'application : savoir si le compte est connecté sur cet appareil, et s'en déconnecter.
contextBridge.exposeInMainWorld('oniriqueApp', {
  spotify: () => ipcRenderer.invoke('tool:spotify'),
  spotifyLogout: () => ipcRenderer.invoke('tool:spotify-logout'),
  // La connexion à Spotify dans le navigateur de l'ordinateur (seulement sa page d'autorisation).
  openExternal: (url) => ipcRenderer.invoke('tool:open-external', String(url)),
});
contextBridge.exposeInMainWorld('oniriqueDialog', (kind, message, value) =>
  ipcRenderer.sendSync('tool:dialog', String(kind), String(message ?? ''), value == null ? '' : String(value)));
