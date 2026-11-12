// Le .exe ne fait que retrouver le dossier du dépôt et y lancer fondateurs/main.js : l'app suit donc le dépôt
// (un « Récupérer » suffit à la mettre à jour, rien à reconstruire).
const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const isRepo = (dir) => !!dir && fs.existsSync(path.join(dir, 'fondateurs', 'main.js')) && fs.existsSync(path.join(dir, 'deploy', 'deploy.sh'));
const saved = () => path.join(app.getPath('userData'), 'depot.txt');

function findRepo() {
  try { const d = fs.readFileSync(saved(), 'utf8').trim(); if (isRepo(d)) return d; } catch {}
  for (const d of [path.join(app.getPath('downloads'), 'ONIRIQUE CENTRAL'), path.join(app.getPath('documents'), 'ONIRIQUE CENTRAL')]) {
    if (isRepo(d)) return d;
  }
  for (;;) {
    const pick = dialog.showOpenDialogSync({ title: 'Où est le dossier ONIRIQUE CENTRAL ?', properties: ['openDirectory'] });
    if (!pick) return null;
    if (isRepo(pick[0])) return pick[0];
    dialog.showMessageBoxSync({ type: 'warning', message: 'Ce dossier n\'est pas le dépôt ONIRIQUE CENTRAL (il doit contenir fondateurs et deploy).' });
  }
}

app.whenReady().then(() => {
  const repo = findRepo();
  if (!repo) return app.quit();
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(saved(), repo);
  require(path.join(repo, 'fondateurs', 'main.js'));
});
