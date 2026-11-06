// Le pop-up d'invitation (HM, WATCHPARTY) : il reçoit l'invitation et renvoie « Refuser » ou « Rejoindre » à l'application.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oniriqueInvite', {
  onShow: (fn) => ipcRenderer.on('invite:show', (_event, invite) => fn(invite)),
  answer: (join) => ipcRenderer.send('invite:answer', !!join),
});
