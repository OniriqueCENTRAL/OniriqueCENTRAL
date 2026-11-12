// ONIRIQUE FONDATEURS : les gestes courants (récupérer, enregistrer, mettre en ligne, publier, surveiller) en un bouton.
// Tout passe par les scripts du dépôt (deploy/*.sh) et la clé SSH de ce PC ; aucun secret n'est demandé ni gardé ici.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const HOST = 'root@212.227.165.177';
const BASH = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']
  .find((p) => fs.existsSync(p)) || 'bash';

if (!app.requestSingleInstanceLock()) app.exit(0);
let win = null;
let busy = false;

// Lance une commande et renvoie sa sortie ligne à ligne dans la console de la fenêtre.
function run(file, args, cwd = REPO) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    let out = '';
    const push = (chunk) => { const t = chunk.toString(); out += t; win?.webContents.send('log', t); };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (e) => { push(`${e.message}\n`); resolve({ code: -1, out }); });
    child.on('close', (code) => resolve({ code, out }));
  });
}
const git = (...args) => run('git', args);
const sh = (script, cwd) => run(BASH, ['-lc', script], cwd);
const ssh = (cmd) => run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, cmd]);

// La mise en ligne part du dépôt : si d'autres fichiers sont en cours ici, elle se fait depuis une copie propre (CLAUDE.md).
async function deploy() {
  const dirty = (await run('git', ['status', '--porcelain', '--untracked-files=no'])).out.trim();
  if (!dirty) return sh('bash deploy/deploy.sh');
  const tmp = path.join(os.tmpdir(), `onirique-deploy-${Date.now()}`);
  win?.webContents.send('log', 'Des fichiers non enregistrés restent ici : mise en ligne depuis une copie propre du dernier commit.\n');
  const add = await git('worktree', 'add', '--detach', tmp, 'HEAD');
  if (add.code) return add;
  try { return await sh('bash deploy/deploy.sh', tmp); } finally { await git('worktree', 'remove', '--force', tmp); }
}

const actions = {
  pull: () => git('pull', '--ff-only'),
  deploy,
  releaseApp: () => sh('bash deploy/release-app.sh'),
  releaseNav: () => sh('bash deploy/release-navigateur.sh'),
  journal: () => ssh('tail -n 25 /var/lib/onirique-deploy/journal'),
  status: () => ssh('systemctl is-active onirique-central nginx; uptime; df -h / | tail -1; free -h | sed -n 2p'),
  errors: () => ssh('journalctl -u onirique-central -p err -n 40 --no-pager'),
  restart: () => ssh('systemctl restart onirique-central && sleep 2 && systemctl is-active onirique-central'),
};

ipcMain.handle('action', async (_e, name) => {
  if (busy) return { code: -1, out: 'Une action est déjà en cours.' };
  if (!actions[name]) return { code: -1, out: 'Action inconnue.' };
  busy = true;
  try { return await actions[name](); } finally { busy = false; }
});

// Les fichiers modifiés, pour n'enregistrer que les siens (jamais « git add . »).
ipcMain.handle('changes', async () => {
  const { out } = await run('git', ['status', '--porcelain']);
  return out.split('\n').filter(Boolean).map((l) => ({ state: l.slice(0, 2).trim(), file: l.slice(3).replace(/^"|"$/g, '') }));
});
ipcMain.handle('commit', async (_e, files, message) => {
  if (busy) return { code: -1, out: 'Une action est déjà en cours.' };
  if (!Array.isArray(files) || !files.length || !String(message || '').trim()) return { code: -1, out: 'Cochez des fichiers et écrivez un message.' };
  busy = true;
  try {
    const add = await git('add', '--', ...files);
    if (add.code) return add;
    return await git('commit', '-m', String(message).trim(), '--', ...files);
  } finally { busy = false; }
});

ipcMain.handle('health', async () => {
  const check = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(8000) })).ok; } catch { return false; } };
  const [site, api] = await Promise.all([check('https://onirique.store/'), check('https://central.onirique.store/api/health')]);
  return { site, api };
});

ipcMain.handle('open', (_e, what) => {
  const urls = { site: 'https://onirique.store/', admin: 'https://onirique.store/admin', boutique: 'https://onirique.store/boutique' };
  if (what === 'admin') {
    const w = new BrowserWindow({ width: 1280, height: 860, backgroundColor: '#09080A', autoHideMenuBar: true, title: 'Panel admin' });
    return w.loadURL(urls.admin);
  }
  if (urls[what]) shell.openExternal(urls[what]);
});

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 820, minHeight: 600, backgroundColor: '#09080A', autoHideMenuBar: true,
    title: 'ONIRIQUE FONDATEURS', icon: path.join(REPO, 'app', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
