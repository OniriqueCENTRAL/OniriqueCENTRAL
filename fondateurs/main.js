// ONIRIQUE FONDATEURS : les gestes courants (récupérer, enregistrer, mettre en ligne, publier, surveiller) en un bouton.
// Tout passe par les scripts du dépôt (deploy/*.sh), la clé SSH de ce PC et la connexion du panel admin (double
// authentification comprise) ; aucun secret n'est demandé ni écrit sur le disque ici.
const { app, BrowserWindow, Notification, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const HOST = 'root@212.227.165.177';
const SITE = 'https://onirique.store';
const DB = '/var/lib/onirique-central/central.db';
const BASH = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']
  .find((p) => fs.existsSync(p)) || 'bash';

if (!app.requestSingleInstanceLock()) app.exit(0);
app.setAppUserModelId('com.onirique.fondateurs');   // sans lui, Windows n'affiche pas les notifications
let win = null;
let adminWin = null;
let busy = false;
let liveLog = null;
const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };

// Lance une commande ; sa sortie part ligne à ligne dans la console de la fenêtre (sauf quiet).
function run(file, args, { cwd = REPO, quiet = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    let out = '';
    const push = (chunk) => { const t = chunk.toString(); out += t; if (!quiet) send('log', t); };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (e) => { push(`${e.message}\n`); resolve({ code: -1, out }); });
    child.on('close', (code) => resolve({ code, out }));
  });
}
const git = (args, opts) => run('git', args, opts);
const sh = (script, cwd) => run(BASH, ['-lc', script], { cwd });
const ssh = (cmd, opts) => run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, cmd], opts);

// Un travail sur une copie propre du dépôt (CLAUDE.md : les fichiers en cours des autres ne partent jamais).
async function inCleanCopy(ref, fn) {
  const tmp = path.join(os.tmpdir(), `onirique-fondateurs-${Date.now()}`);
  const add = await git(['worktree', 'add', '--detach', tmp, ref]);
  if (add.code) return add;
  try { return await fn(tmp); } finally { await git(['worktree', 'remove', '--force', tmp]); }
}

async function deploy() {
  const dirty = (await git(['status', '--porcelain', '--untracked-files=no'], { quiet: true })).out.trim();
  if (!dirty) return sh('bash deploy/deploy.sh');
  send('log', 'Des fichiers non enregistrés restent ici : mise en ligne depuis une copie propre du dernier commit.\n');
  return inCleanCopy('HEAD', (dir) => sh('bash deploy/deploy.sh', dir));
}

// Revenir en arrière = annuler un commit par un nouveau commit (git revert), puis remettre en ligne : l'historique
// partagé n'est jamais réécrit, et la sauvegarde de la base n'est pas touchée.
async function revert(sha) {
  if (!/^[0-9a-f]{7,40}$/.test(String(sha))) return { code: -1, out: 'Commit invalide.' };
  await git(['fetch', '-q', 'origin']);
  const r = await inCleanCopy('origin/main', async (dir) => {
    const rv = await run('git', ['revert', '--no-edit', sha], { cwd: dir });
    if (rv.code) { await run('git', ['revert', '--abort'], { cwd: dir, quiet: true }); return rv; }
    return sh('bash deploy/deploy.sh', dir);
  });
  if (r.code === 0) await git(['pull', '--ff-only']);
  return r;
}

// Chiffres lus en lecture seule dans la base (heure de Paris pour « aujourd'hui » et « ce mois-ci »).
const PAID = `amount_cents > 0 AND provider NOT IN ('free','promo','demo')`;
const STATS_SQL = [
  'SELECT COUNT(*) FROM users WHERE created_at >= $D', 'SELECT COUNT(*) FROM users WHERE created_at >= $M', 'SELECT COUNT(*) FROM users',
  `SELECT COUNT(*) FROM orders WHERE created_at >= $D AND ${PAID}`, `SELECT COALESCE(SUM(amount_cents),0) FROM orders WHERE created_at >= $D AND ${PAID}`,
  `SELECT COUNT(*) FROM orders WHERE created_at >= $M AND ${PAID}`, `SELECT COALESCE(SUM(amount_cents),0) FROM orders WHERE created_at >= $M AND ${PAID}`,
  `SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND current_period_end > $N`, 'SELECT COUNT(*) FROM support_messages',
].map((q) => `(${q})`).join(', ');
const STATS_KEYS = ['usersToday', 'usersMonth', 'users', 'salesToday', 'centsToday', 'salesMonth', 'centsMonth', 'subscribers', 'support'];
async function stats() {
  const cmd = `D=$(TZ=Europe/Paris date -d 'today 00:00' +%s)000; M=$(TZ=Europe/Paris date -d "$(TZ=Europe/Paris date +%Y-%m-01)" +%s)000; N=$(date +%s)000; `
    + `sqlite3 -readonly -separator ' ' ${DB} "SELECT ${STATS_SQL}"`;
  const r = await ssh(cmd, { quiet: true });
  const v = r.out.trim().split(/\s+/).map(Number);
  if (r.code || v.length !== STATS_KEYS.length || v.some(Number.isNaN)) return { error: r.out.trim() || 'Pas de réponse du serveur.' };
  return Object.fromEntries(STATS_KEYS.map((k, i) => [k, v[i]]));
}

// Les versions en ligne, et les téléchargements de la semaine (journaux nginx gardés : environ 7 jours).
async function versions() {
  const dl = (name) => `zcat -f /var/log/nginx/access.log* | grep -cE 'GET /telechargement/${name}[^ ]*\\.exe HTTP[^"]*" 200 ' || true`;
  const r = await ssh(`cd /var/www/site/telechargement && sed -n 's/^version: //p' latest.yml && sed -n 's/.*"version":"\\([^"]*\\)".*/\\1/p' navigateur.json && ${dl('ONIRIQUE-CENTRAL-Setup')} && ${dl('ONIRIQUE-Navigateur')}`, { quiet: true });
  const [appV, navV, appDl, navDl] = r.out.trim().split('\n');
  let plugins = [];
  try {
    const c = await (await fetch(`${SITE}/api/catalog`, { signal: AbortSignal.timeout(10000) })).json();
    plugins = c.products.map((p) => ({ name: p.name, version: p.latest?.version || p.versions?.[0]?.version || '?' }));
  } catch {}
  return { app: appV, navigateur: navV, appDownloads: Number(appDl) || 0, navDownloads: Number(navDl) || 0, plugins };
}

// Les réglages en direct (maintenance, annonce) passent par l'API, avec la session ouverte dans le panel admin.
const READ_TOKEN = 'sessionStorage.getItem("onirique.token") || localStorage.getItem("onirique.token")';
async function token() {
  if (adminWin && !adminWin.isDestroyed()) {
    const t = await adminWin.webContents.executeJavaScript(READ_TOKEN).catch(() => null);
    if (t) return t;
  }
  const w = new BrowserWindow({ show: false });
  try { await w.loadURL(`${SITE}/robots.txt`); return await w.webContents.executeJavaScript(READ_TOKEN); } catch { return null; } finally { w.destroy(); }
}
async function adminApi(method, route, body) {
  const t = await token();
  if (!t) return { error: 'Ouvrez le panel admin et connectez-vous (« Se souvenir de moi » coché), puis recommencez.' };
  try {
    const res = await fetch(`${SITE}/api/admin${route}`, {
      method, signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return { error: 'Connexion expirée : ouvrez le panel admin et reconnectez-vous (« Se souvenir de moi » coché).' };
    return res.ok ? data : { error: data.error || `Le serveur a répondu ${res.status}.` };
  } catch (e) { return { error: e.message }; }
}

// La note du jour sur Discord, par l'outil du dépôt (le webhook reste sur le serveur). Fichier hors du dépôt.
async function patchnote(text) {
  if (!/^# .+/m.test(String(text || '')) || !/^- .+/m.test(text)) return { code: -1, out: 'La note commence par « # Titre » et contient des lignes « - … ».' };
  const file = path.join(os.tmpdir(), `onirique-patchnote-${Date.now()}.md`);
  fs.writeFileSync(file, text);
  try { return await run('node', ['deploy/patchnote.mjs', file]); } finally { fs.rmSync(file, { force: true }); }
}

const actions = {
  pull: () => git(['pull', '--ff-only']),
  deploy,
  releaseApp: () => sh('bash deploy/release-app.sh'),
  releaseNav: () => sh('bash deploy/release-navigateur.sh'),
  journal: () => ssh('tail -n 25 /var/lib/onirique-deploy/journal'),
  status: () => ssh('systemctl is-active onirique-central nginx onirique-discord-bot; uptime; df -h / | tail -1; free -h | sed -n 2p'),
  errors: () => ssh('journalctl -u onirique-central -p err -n 40 --no-pager'),
  restart: () => ssh('systemctl restart onirique-central && sleep 2 && systemctl is-active onirique-central'),
  backup: () => ssh('/usr/local/bin/onirique-backup && ls -1 /var/backups/onirique-central | tail -n 3 && du -sh /var/backups/onirique-central/$(date +%F)'),
};
async function exclusive(fn) {
  if (busy) return { code: -1, out: 'Une action est déjà en cours.' };
  busy = true;
  try { return await fn(); } finally { busy = false; }
}

ipcMain.handle('action', (_e, name) => (actions[name] ? exclusive(actions[name]) : { code: -1, out: 'Action inconnue.' }));
ipcMain.handle('revert', (_e, sha) => exclusive(() => revert(sha)));
ipcMain.handle('patchnote', (_e, text) => exclusive(() => patchnote(text)));
ipcMain.handle('stats', stats);
ipcMain.handle('versions', versions);
ipcMain.handle('lastBackup', async () => (await ssh('ls -1 /var/backups/onirique-central | tail -n 1', { quiet: true })).out.trim());
ipcMain.handle('commits', async () => {
  await git(['fetch', '-q', 'origin'], { quiet: true });
  const { out } = await git(['log', 'origin/main', '-n', '15', '--date=format:%d/%m %H:%M', '--format=%h%x09%an%x09%ad%x09%s'], { quiet: true });
  return out.split('\n').filter(Boolean).map((l) => { const [sha, who, when, subject] = l.split('\t'); return { sha, who, when, subject }; });
});
ipcMain.handle('live', (_e, method, route, body) => {
  if (!['/live', '/live/maintenance', '/live/announcement'].includes(route) || !['GET', 'PUT'].includes(method)) return { error: 'Refusé.' };
  return adminApi(method, route, body);
});

// Le journal du serveur en direct, jusqu'à ce qu'on l'arrête.
ipcMain.handle('liveLog', (_e, on) => {
  if (liveLog) { liveLog.kill(); liveLog = null; }
  if (!on) return false;
  liveLog = spawn('ssh', ['-o', 'BatchMode=yes', HOST, 'journalctl -u onirique-central -f -n 20 --no-pager'], { windowsHide: true });
  const push = (chunk) => send('log', chunk.toString());
  liveLog.stdout.on('data', push);
  liveLog.stderr.on('data', push);
  liveLog.on('close', () => { liveLog = null; send('liveLogEnded'); });
  return true;
});

// Les fichiers modifiés, pour n'enregistrer que les siens (jamais « git add . »).
ipcMain.handle('changes', async () => {
  const { out } = await git(['status', '--porcelain'], { quiet: true });
  return out.split('\n').filter(Boolean).map((l) => ({ state: l.slice(0, 2).trim(), file: l.slice(3).replace(/^"|"$/g, '') }));
});
ipcMain.handle('commit', (_e, files, message) => exclusive(async () => {
  if (!Array.isArray(files) || !files.length || !String(message || '').trim()) return { code: -1, out: 'Cochez des fichiers et écrivez un message.' };
  const add = await git(['add', '--', ...files]);
  if (add.code) return add;
  return git(['commit', '-m', String(message).trim(), '--', ...files]);
}));

// Le site et l'API vérifiés chaque minute par l'app elle-même : une panne prévient par une notification Windows,
// même fenêtre réduite.
let lastHealth = null;
async function health() {
  const check = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(8000) })).ok; } catch { return false; } };
  const [site, api] = await Promise.all([check(`${SITE}/`), check('https://central.onirique.store/api/health')]);
  const h = { site, api };
  if (lastHealth) {
    for (const [k, name] of [['site', 'Le site'], ['api', "L'API"]]) {
      if (lastHealth[k] !== h[k] && Notification.isSupported()) {
        new Notification({ title: 'ONIRIQUE FONDATEURS', body: h[k] ? `${name} répond de nouveau.` : `${name} ne répond plus.` }).show();
      }
    }
  }
  lastHealth = h;
  send('health', h);
  return h;
}
ipcMain.handle('health', health);

ipcMain.handle('open', (_e, what) => {
  const urls = { site: `${SITE}/`, boutique: `${SITE}/boutique`, admin: `${SITE}/admin`, support: `${SITE}/admin#mail` };
  if (what !== 'admin' && what !== 'support') return urls[what] && shell.openExternal(urls[what]);
  if (adminWin && !adminWin.isDestroyed()) { adminWin.loadURL(urls[what]); return adminWin.focus(); }
  adminWin = new BrowserWindow({ width: 1280, height: 860, backgroundColor: '#09080A', autoHideMenuBar: true, title: 'Panel admin' });
  adminWin.on('closed', () => { adminWin = null; });
  adminWin.loadURL(urls[what]);
});

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1240, height: 860, minWidth: 900, minHeight: 640, backgroundColor: '#09080A', autoHideMenuBar: true,
    title: 'ONIRIQUE FONDATEURS', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  setInterval(health, 60_000);
});
app.on('window-all-closed', () => { if (liveLog) liveLog.kill(); app.quit(); });
