// CUT et CLOUD dans l'application : leurs fenêtres « OK / Annuler » (alert, confirm, prompt) passent par l'application,
// qui les dessine à sa DA au lieu de la boîte de Windows. L'appel attend la réponse, comme celui du navigateur.
const { contextBridge, ipcRenderer } = require('electron');

// Spotify dans l'application : savoir si le compte est connecté sur cet appareil, et s'en déconnecter.
contextBridge.exposeInMainWorld('oniriqueApp', {
  spotify: () => ipcRenderer.invoke('tool:spotify'),
  spotifyLogout: () => ipcRenderer.invoke('tool:spotify-logout'),
  // La connexion à Spotify dans le navigateur de l'ordinateur (seulement sa page d'autorisation).
  openExternal: (url) => ipcRenderer.invoke('tool:open-external', String(url)),
  // Le partage d'écran de la WATCHPARTY : les écrans et fenêtres à choisir, puis le choix (avec ou sans le son de l'ordinateur).
  screens: () => ipcRenderer.invoke('tool:screens'),
  pickScreen: (id, audio) => ipcRenderer.invoke('tool:screen-pick', String(id), !!audio),
  // Twitch et YouTube connectés dans l'application (pour regarder sans pub dans la WATCHPARTY), et la déconnexion.
  accounts: () => ipcRenderer.invoke('tool:accounts'),
  nativeInvites: true, // les invitations (HM, WATCHPARTY) sont montrées par l'application elle-même, sur tous ses écrans
  // Le son d'une seule appli, ou de tout sauf une (Discord…) : la liste des applis, puis le son en direct (PCM).
  apps: () => ipcRenderer.invoke('tool:apps'),
  loopStart: (mode, pid) => ipcRenderer.invoke('tool:loop-start', String(mode), Number(pid)),
  loopStop: () => ipcRenderer.invoke('tool:loop-stop'),
  onLoopPcm: (listener) => { ipcRenderer.on('tool:loop-pcm', (_event, chunk) => listener(chunk)); },
  onLoopEnd: (listener) => { ipcRenderer.on('tool:loop-end', (_event, codeOut, error) => listener(codeOut, error)); },
  accountLogout: (name) => ipcRenderer.invoke('tool:account-logout', String(name)),
});
contextBridge.exposeInMainWorld('oniriqueDialog', (kind, message, value) =>
  ipcRenderer.sendSync('tool:dialog', String(kind), String(message ?? ''), value == null ? '' : String(value)));
