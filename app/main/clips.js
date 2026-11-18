// Les clips, comme Medal : une touche (F8 par défaut) garde les dernières secondes de l'écran et du son de l'ordinateur.
// Réservés, comme la WATCHPARTY, aux membres ONIRIQUE, beta-testeurs, équipe et fondateurs ; coupés tant qu'on ne les
// active pas. L'enregistrement tourne dans une fenêtre cachée, jamais affichée ni mise au premier plan, à priorité
// réduite pour que le jeu garde la main. Les clips vont dans « Vidéos\ONIRIQUE Clips » (ou le dossier choisi), avec leur
// image et leurs repères ; un clip partagé a son lien onirique.store/clip (server/src/clips.js).
const { BrowserWindow, app, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, screen, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const api = require('./api');
const store = require('./store');

const ROLES = ['vip', 'beta', 'betaf', 'admin', 'founder']; // comme server/src/watchparty.js
const DEFAULTS = { on: false, seconds: 30, fps: 30, height: 1080, key: 'F8', screen: '', dir: '' };
// La touche choisie, au format d'Electron (« Ctrl+Shift+K »). Seules les touches qui ne servent pas à écrire se
// prennent seules (F1 à F24, Pause…) ; une lettre, un chiffre ou un signe demande Ctrl, Alt ou Windows, sinon la
// touche disparaîtrait de tout ce qu'on tape.
const ALONE = /^(F([1-9]|1\d|2[0-4])|Pause|PrintScreen|Scrolllock|Insert)$/;
const OTHER = /^([A-Z0-9]|num[0-9]|numadd|numsub|nummult|numdiv|numdec|Space|Tab|Delete|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|[-=[\];',./`\\])$/;
function isKey(v) {
  if (typeof v !== 'string' || v.length > 40) return false;
  const parts = v.split('+'), last = parts.pop();
  if (new Set(parts).size !== parts.length || parts.some((m) => !['Ctrl', 'Alt', 'Shift', 'Super'].includes(m))) return false;
  return ALONE.test(last) || (OTHER.test(last) && parts.some((m) => m !== 'Shift'));
}
const CHECKS = {
  on: (v) => typeof v === 'boolean', seconds: (v) => [15, 30, 60, 120].includes(v), fps: (v) => [30, 60].includes(v),
  height: (v) => [720, 1080].includes(v), key: isKey, screen: (v) => typeof v === 'string' && v.length < 100,
};
const NAME = /^clip-[\w-]{1,80}\.(mp4|webm)$/;
const dir = () => settings().dir || path.join(app.getPath('videos'), 'ONIRIQUE Clips');
const fileOf = (name) => {
  if (typeof name !== 'string' || !NAME.test(name)) throw new Error('Clip inconnu.');
  return path.join(dir(), name);
};
const sideOf = (name, ext) => fileOf(name).replace(/\.\w+$/, ext);
const settings = () => ({ ...DEFAULTS, ...store.prefs.clips });
// 2026-11-17_21-04-33 : l'heure de ce PC, lisible dans l'explorateur.
const stamp = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');

let rec = null, key = null, problem = '', ctx = null;
const notify = () => ctx.getWin()?.webContents.send('clips:changed');

async function allowed() {
  const me = await api.request('GET', '/api/me').catch(() => null);
  return !!me && ROLES.includes(me.user.role);
}

function stop() {
  if (key) globalShortcut.unregister(key);
  key = null;
  if (rec && !rec.isDestroyed()) rec.destroy();
  rec = null;
}

async function start() {
  stop();
  problem = '';
  const s = settings();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).catch(() => []);
  const primary = String(screen.getPrimaryDisplay().id);
  const source = sources.find((x) => x.id === s.screen) || sources.find((x) => x.display_id === primary) || sources[0];
  if (!source) { problem = 'Aucun écran à capter.'; return; }
  stop(); // un autre démarrage, ou un arrêt, a pu passer pendant la recherche des écrans
  if (!settings().on) return;
  rec = new BrowserWindow({ show: false, skipTaskbar: true, focusable: false, webPreferences: { partition: 'onirique-clips', sandbox: true,
    contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, preload: path.join(__dirname, 'clips-preload.js') } });
  const web = rec.webContents;
  web.on('did-finish-load', () => { try { os.setPriority(web.getOSProcessId(), os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* priorité normale */ } });
  web.on('render-process-gone', () => { problem = "L'enregistreur s'est arrêté : désactive puis réactive les clips."; stop(); notify(); });
  rec.loadFile(path.join(__dirname, '..', 'renderer', 'clips-recorder.html'), { query: { seconds: String(s.seconds), fps: String(s.fps), height: String(s.height), source: source.id, audio: process.platform === 'win32' ? '1' : '0' } });
  if (globalShortcut.register(s.key, save)) key = s.key;
  else problem = `La touche ${s.key} est déjà prise par un autre logiciel : choisis-en une autre.`;
}

function save() {
  if (rec && !rec.isDestroyed()) rec.webContents.send('clips-rec:save');
}

/** Démarre ou arrête l'enregistrement selon le réglage et le compte connecté (à l'ouverture, à chaque changement de compte). */
async function sync() {
  if (settings().on && await allowed()) { if (!rec) await start(); } else stop();
  notify();
}

async function setSettings(patch) {
  const next = { ...settings() };
  for (const [k, v] of Object.entries(patch || {})) if (CHECKS[k]?.(v)) next[k] = v;
  if (patch?.key !== undefined && !isKey(patch.key)) throw new Error('Cette touche ne peut pas servir : prends une touche F, ou ajoute Ctrl, Alt ou Windows.');
  if (next.on && !(await allowed())) throw new Error('Les clips sont réservés aux membres ONIRIQUE, aux beta-testeurs et aux fondateurs.');
  // Une nouvelle touche est essayée avant d'être gardée : prise par un autre logiciel, l'ancienne reste.
  if (next.key !== settings().key && next.key !== key) {
    if (!globalShortcut.register(next.key, () => {})) throw new Error(`La touche ${next.key} est déjà prise par un autre logiciel : choisis-en une autre.`);
    globalShortcut.unregister(next.key);
  }
  store.setPref('clips', next);
  if (next.on) await start(); else stop();
  notify();
  return status();
}

async function status() {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).catch(() => []);
  return { settings: settings(), running: !!rec, problem, dir: dir(),
    screens: sources.map((s, i) => ({ id: s.id, name: s.name || `Écran ${i + 1}` })) };
}

async function list() {
  const names = (await fsp.readdir(dir()).catch(() => [])).filter((n) => NAME.test(n));
  const clips = await Promise.all(names.map(async (name) => {
    const meta = await fsp.readFile(sideOf(name, '.json'), 'utf8').then(JSON.parse).catch(() => ({}));
    const thumb = await fsp.readFile(sideOf(name, '.jpg')).then((b) => `data:image/jpeg;base64,${b.toString('base64')}`, () => null);
    const { size, mtimeMs } = await fsp.stat(fileOf(name));
    return { name, size, thumb, at: meta.at || mtimeMs, start: meta.start || 0, duration: meta.duration || 0, shared: meta.shared || null };
  }));
  return clips.sort((a, b) => b.at - a.at);
}

async function write(name, bytes, meta, thumb) {
  await fsp.mkdir(dir(), { recursive: true });
  await fsp.writeFile(fileOf(name), bytes);
  await fsp.writeFile(sideOf(name, '.json'), JSON.stringify(meta));
  if (thumb) await fsp.writeFile(sideOf(name, '.jpg'), thumb);
}

const readMeta = (name) => fsp.readFile(sideOf(name, '.json'), 'utf8').then(JSON.parse).catch(() => ({}));
const writeMeta = async (name, patch) => fsp.writeFile(sideOf(name, '.json'), JSON.stringify({ ...(await readMeta(name)), ...patch }));

/** Met le clip en ligne (onirique.store/clip?c=…, lu dans Discord comme un clip Medal), attend la fin de sa
    préparation sur le serveur, copie le lien et le garde avec le clip. */
async function share(name, title) {
  const progress = (phase, ratio) => ctx.getWin()?.webContents.send('progress', { id: `clip:${name}`, phase, ratio });
  const clip = await api.upload('POST', `/api/clips?title=${encodeURIComponent(String(title || '').slice(0, 100))}`, fileOf(name), 'video/webm', (r) => progress('upload', r));
  for (let i = 0; clip.status === 'wait'; i++) {
    if (i > 600) throw new Error('La préparation du clip prend trop de temps : réessaie plus tard.');
    progress('clip-prepare', 0);
    await new Promise((ok) => setTimeout(ok, 1000));
    Object.assign(clip, await api.request('GET', `/api/clips/${clip.id}`));
  }
  if (clip.status !== 'ready') throw new Error("Le serveur n'a pas pu lire ce clip.");
  const shared = { id: clip.id, url: clip.url, title: clip.title };
  await writeMeta(name, { shared });
  clipboard.writeText(clip.url);
  return shared;
}

async function unshare(name) {
  const { shared } = await readMeta(name);
  if (shared?.id) await api.request('DELETE', `/api/clips/${encodeURIComponent(shared.id)}`).catch((error) => { if (error.status !== 404) throw error; });
  await writeMeta(name, { shared: null });
}

/** handle : celui de main.js (erreurs rendues à l'interface) ; getWin : la fenêtre de l'application ; site : onirique.store. */
function init({ handle, getWin, site }) {
  ctx = { getWin, site };
  ipcMain.on('clips-rec:saved', async (event, bytes, meta) => {
    if (event.sender !== rec?.webContents || !(bytes instanceof Uint8Array) || !meta) return;
    const at = Number(meta.at) || Date.now(), duration = Math.max(0, Number(meta.duration) || 0);
    const name = `clip-${stamp(at)}.${meta.mime === 'video/mp4' ? 'mp4' : 'webm'}`;
    const thumb = typeof meta.thumb === 'string' && meta.thumb.startsWith('data:image/jpeg;base64,') ? Buffer.from(meta.thumb.slice(23), 'base64') : null;
    try {
      await write(name, bytes, { at, duration, start: Math.min(duration, Math.max(0, Number(meta.start) || 0)) }, thumb);
    } catch (error) { problem = `Le clip n'a pas pu être écrit (${error.message}).`; }
    notify();
  });
  ipcMain.on('clips-rec:error', (event, message) => {
    if (event.sender !== rec?.webContents) return;
    problem = String(message).slice(0, 300);
    stop();
    notify();
  });
  app.on('will-quit', stop);

  handle('clips:state', status);
  handle('clips:set', setSettings);
  handle('clips:now', () => { if (!rec) throw new Error("Active d'abord les clips."); save(); });
  handle('clips:list', list);
  handle('clips:read', (name) => fsp.readFile(fileOf(name)));
  // La coupe faite dans la bibliothèque : un nouveau clip, l'original reste.
  handle('clips:save-cut', async (name, bytes, duration, mime) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('Coupe vide.');
    const at = Date.now(), cut = `clip-${stamp(at)}-coupe.${mime === 'video/mp4' ? 'mp4' : 'webm'}`;
    const thumb = await fsp.readFile(sideOf(name, '.jpg')).catch(() => null);
    await write(cut, bytes, { at, duration: Math.max(0, Number(duration) || 0), start: 0 }, thumb);
    return cut;
  });
  handle('clips:delete', async (name) => {
    for (const file of [fileOf(name), sideOf(name, '.json'), sideOf(name, '.jpg')]) if (fs.existsSync(file)) await shell.trashItem(file);
  });
  handle('clips:reveal', async (name) => {
    if (name) return shell.showItemInFolder(fileOf(name));
    await fsp.mkdir(dir(), { recursive: true });
    await shell.openPath(dir());
  });
  handle('clips:share', share);
  handle('clips:unshare', unshare);
  handle('clips:copy', async (name) => { const { shared } = await readMeta(name); if (shared?.url) clipboard.writeText(shared.url); });
  // Le dossier des clips : choisi dans une fenêtre de Windows (reset : celui par défaut). Les clips déjà pris restent où ils sont.
  handle('clips:pick-dir', async (reset) => {
    let chosen = '';
    if (!reset) {
      const result = await dialog.showOpenDialog(ctx.getWin(), { title: 'Dossier des clips', defaultPath: dir(), properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled || !result.filePaths[0]) return status();
      chosen = result.filePaths[0];
    }
    store.setPref('clips', { ...settings(), dir: chosen });
    notify();
    return status();
  });
  // Pendant qu'on choisit une nouvelle touche, l'actuelle ne prend plus de clip (sinon elle n'arriverait jamais à la page).
  handle('clips:key-pause', (paused) => {
    if (paused && key) { globalShortcut.unregister(key); key = null; }
    else if (!paused && rec && !key && globalShortcut.register(settings().key, save)) key = settings().key;
  });
}

module.exports = { init, sync, stop, isKey };
