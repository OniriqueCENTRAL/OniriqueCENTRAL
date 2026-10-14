const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = [
  'load', 'api', 'checkout', 'media', 'demo', 'clipboard',
  'auth:login', 'auth:register', 'auth:logout', 'auth:password', 'me:avatar',
  'plugin:install', 'plugin:uninstall', 'plugin:reveal', 'plugin:open',
  'license:activate', 'license:deactivate',
  'admin:previewMail', 'admin:pick', 'admin:uploadVersion', 'admin:uploadImage', 'admin:refreshDemo', 'open:webmail', 'open:mail',
  'settings:server', 'settings:vst3Dir',
];

contextBridge.exposeInMainWorld('central', {
  platform: process.platform,
  /** Renvoie les données, ou lève une erreur portant le message du serveur. */
  async call(channel, ...args) {
    if (!CHANNELS.includes(channel)) throw new Error(`Canal inconnu : ${channel}`);
    const result = await ipcRenderer.invoke(channel, ...args);
    if (!result.ok) throw Object.assign(new Error(result.error), { status: result.status });
    return result.data;
  },
  window: (action) => ipcRenderer.send('window', action),
  onProgress: (listener) => ipcRenderer.on('progress', (_event, data) => listener(data)),
  onMaximized: (listener) => ipcRenderer.on('window:maximized', (_event, value) => listener(value)),
  // Mise à jour : version téléchargée et prête (ou null), et redémarrage immédiat pour l'installer.
  updateReady: () => ipcRenderer.invoke('update:state'),
  onUpdateReady: (listener) => ipcRenderer.on('update:ready', (_event, version) => listener(version)),
  installUpdate: () => ipcRenderer.send('update:install'),
});
