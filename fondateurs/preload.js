const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('oni', {
  action: call('action'),
  changes: call('changes'),
  commit: call('commit'),
  commits: call('commits'),
  revert: call('revert'),
  health: call('health'),
  stats: call('stats'),
  versions: call('versions'),
  lastBackup: call('lastBackup'),
  live: call('live'),
  liveLog: call('liveLog'),
  patchnote: call('patchnote'),
  open: call('open'),
  on: (channel, fn) => ipcRenderer.on(channel, (_e, data) => fn(data)),
});
