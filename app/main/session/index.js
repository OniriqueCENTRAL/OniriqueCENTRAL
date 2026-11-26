// ONIRIQUE SESSION dans CENTRAL : la page (site/session.html) reconnaît et nomme les stems ; ici, ce qui touche
// l'ordinateur, comme le faisait la partie Python de l'application ONIRIQUE Session (main.py) : lire les fichiers que
// l'utilisateur a donnés, ses dossiers clients et ses templates, écrire le projet (FL Studio, Pro Tools). La page
// vient du site : elle ne lit que les fichiers déposés ou choisis, et n'écrit que dans le dossier des clients choisi
// ici, par une fenêtre de l'ordinateur.
const { app, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const plan = require('./plan');
const flp = require('./flp');

const AUDIO = /\.(wav|wave|aif|aiff|aifc|flac|mp3|ogg|m4a)$/i;
const files = new Map(); // identifiant → chemin : seuls les fichiers donnés par l'utilisateur sont lisibles
const allowed = { templates: new Set(), projects: new Set() }; // templates vues ou choisies, projets créés
const settingsFile = () => path.join(app.getPath('userData'), 'session.json');
const logFile = () => path.join(app.getPath('userData'), 'session-erreurs.txt');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
function saveSettings(values) {
  const s = { ...loadSettings() };
  for (const key of ['daw', 'client', 'templates']) if (key in values) s[key] = values[key]; // le dossier ne se règle que par la fenêtre
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 1));
}
const folderOf = (s = loadSettings()) => s.folder || path.join(app.getPath('documents'), 'ONIRIQUE Sessions');

//----------------------------------------------------------------------------------------------------------------------
// Les fichiers : leur format (durée, fréquence, voies) lu dans l'en-tête, sans tout lire.
function readAt(fd, position, length) {
  const b = Buffer.alloc(length);
  return b.subarray(0, fs.readSync(fd, b, 0, length, position));
}
/** L'en-tête d'un WAV, d'un AIFF ou d'un FLAC : { seconds, rate, channels, bits, … } ; null pour les autres (MP3…). */
function probe(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, head = readAt(fd, 0, 12), id = head.toString('latin1', 0, 4), type = head.toString('latin1', 8, 12);
    if ((id === 'RIFF' || id === 'RF64') && type === 'WAVE') {
      let at = 12, fmt = null;
      while (at + 8 <= size) {
        const c = readAt(fd, at, 8), name = c.toString('latin1', 0, 4), length = c.readUInt32LE(4);
        if (name === 'fmt ') {
          const f = readAt(fd, at + 8, Math.min(length, 40));
          fmt = { channels: f.readUInt16LE(2), rate: f.readUInt32LE(4), blockAlign: f.readUInt16LE(12), bits: f.readUInt16LE(14) };
        } else if (name === 'data' && fmt) {
          const bytes = length === 0xFFFFFFFF ? size - at - 8 : Math.min(length, size - at - 8);
          return { ...fmt, seconds: bytes / fmt.blockAlign / fmt.rate };
        }
        at += 8 + length + (length & 1);
      }
      return null;
    }
    if (id === 'FORM' && (type === 'AIFF' || type === 'AIFC')) {
      const aiff = aiffInfo(fd, size);
      return aiff && { channels: aiff.channels, rate: aiff.rate, bits: aiff.bits, seconds: aiff.frames / aiff.rate };
    }
    if (id.startsWith('fLaC')) {
      const s = readAt(fd, 8, 18); // STREAMINFO, juste après l'en-tête de son bloc
      const rate = (s[10] << 12) | (s[11] << 4) | (s[12] >> 4), channels = ((s[12] >> 1) & 7) + 1;
      const total = (s[13] & 15) * 2 ** 32 + s.readUInt32BE(14);
      return rate ? { channels, rate, bits: (((s[12] & 1) << 4) | (s[13] >> 4)) + 1, seconds: total / rate } : null;
    }
    return null;
  } catch { return null; } finally { fs.closeSync(fd); }
}
/** Le flottant de 80 bits (IEEE étendu) où un AIFF écrit sa fréquence. */
function extended(b) {
  const exp = ((b[0] & 0x7F) << 8) | b[1], hi = b.readUInt32BE(2), lo = b.readUInt32BE(6);
  return (hi * 2 ** 32 + lo) * 2 ** (exp - 16383 - 63);
}
function aiffInfo(fd, size) {
  const kind = readAt(fd, 8, 4).toString('latin1');
  let at = 12, info = null;
  while (at + 8 <= size) {
    const c = readAt(fd, at, 8), name = c.toString('latin1', 0, 4), length = c.readUInt32BE(4);
    if (name === 'COMM') {
      const f = readAt(fd, at + 8, Math.min(length, 22));
      info = { channels: f.readUInt16BE(0), frames: f.readUInt32BE(2), bits: f.readUInt16BE(6), rate: extended(f.subarray(8, 18)),
        compression: kind === 'AIFC' && f.length >= 22 ? f.toString('latin1', 18, 22) : 'NONE' };
    } else if (name === 'SSND' && info) {
      const offset = readAt(fd, at + 8, 4).readUInt32BE(0);
      return { ...info, dataAt: at + 16 + offset, dataLength: length - 8 - offset };
    }
    at += 8 + length + (length & 1);
  }
  return null;
}
/** Un AIFF en WAV, que Chromium sait décoder (il ne lit pas l'AIFF) : mêmes échantillons, octets remis dans l'ordre. */
function aiffToWav(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const a = aiffInfo(fd, fs.fstatSync(fd).size);
    if (!a) throw new Error('AIFF illisible.');
    const float = /^(fl32|FL32)$/.test(a.compression), little = a.compression === 'sowt';
    if (!float && !['NONE', 'twos', 'sowt'].includes(a.compression)) throw new Error(`AIFF compressé (${a.compression}) : exporte-le en WAV.`);
    const bytes = Math.ceil(a.bits / 8), data = readAt(fd, a.dataAt, a.frames * a.channels * bytes);
    if (!little) for (let i = 0; i + bytes <= data.length; i += bytes) data.subarray(i, i + bytes).reverse(); // big-endian → little-endian
    if (bytes === 1) for (let i = 0; i < data.length; i++) data[i] ^= 0x80; // 8 bits : signé en AIFF, non signé en WAV
    const head = Buffer.alloc(44);
    head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8, 'latin1');
    head.writeUInt32LE(16, 16); head.writeUInt16LE(float ? 3 : 1, 20); head.writeUInt16LE(a.channels, 22);
    head.writeUInt32LE(Math.round(a.rate), 24); head.writeUInt32LE(Math.round(a.rate) * a.channels * bytes, 28);
    head.writeUInt16LE(a.channels * bytes, 32); head.writeUInt16LE(bytes * 8, 34); head.write('data', 36, 'latin1'); head.writeUInt32LE(data.length, 40);
    return Buffer.concat([head, data]);
  } finally { fs.closeSync(fd); }
}

/** Ce que la page sait d'un fichier avant de l'entendre : son nom, sa durée, sa fréquence, ses voies. */
function register(paths) {
  const out = [];
  for (const p of paths) {
    let stat;
    try { stat = fs.statSync(p); } catch { continue; }
    if (stat.isDirectory()) { // un dossier déposé : ses fichiers audio
      out.push(...register(fs.readdirSync(p).filter((n) => AUDIO.test(n)).sort().map((n) => path.join(p, n))));
      continue;
    }
    if (!AUDIO.test(p)) continue;
    const id = String(files.size);
    files.set(id, p);
    const info = probe(p);
    out.push({ id, name: path.basename(p), path: p, ...(info ? { seconds: info.seconds, rate: info.rate, channels: info.channels } : {}) });
  }
  return out;
}

//----------------------------------------------------------------------------------------------------------------------
// Les templates de chaque DAW, sur Windows comme sur Mac : celles de l'utilisateur d'abord, puis celles livrées avec le DAW.
const flVersion = (name) => Number((name.match(/\d+/) || [0])[0]); // « FL Studio 2025 » → 2025, « 21 » → 21
function templateRoots(daw) {
  const windows = process.platform === 'win32', documents = app.getPath('documents');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  if (daw === 'protools') {
    const roots = [[path.join(documents, 'Pro Tools', 'Session Templates'), false]];
    if (windows) roots.push([path.join(programFiles, 'Avid', 'Pro Tools', 'Session Templates'), true]);
    return roots;
  }
  if (daw !== 'fl') return [];
  const roots = [[path.join(documents, 'Image-Line', 'FL Studio', 'Projects', 'Templates'), false]];
  const list = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
  const installs = windows
    ? list(path.join(programFiles, 'Image-Line')).map((n) => [n, path.join(programFiles, 'Image-Line', n, 'Data', 'Templates')])
    : list('/Applications').filter((n) => n.startsWith('FL Studio') && n.endsWith('.app')).map((n) => [n, path.join('/Applications', n, 'Contents', 'Resources', 'FL', 'Data', 'Templates')]);
  const found = installs.filter(([, dir]) => fs.existsSync(dir)).sort((a, b) => flVersion(a[0]) - flVersion(b[0]));
  if (found.length) roots.push([found[found.length - 1][1], true]);
  return roots;
}
// Les templates qu'Avid installe dans le dossier de l'utilisateur, avec les siennes : rangées avec celles « d'usine ».
const AVID_STOCK = new Set(['Dolby Atmos', 'Getting Started', 'Getting Started Pro Tools Intro', 'Music', 'Post-Production/5.1 Post Production',
  'Post-Production/Stereo Post Production', 'Post-Production/7.1 Post Production']);
function listTemplates(daw) {
  const ext = { fl: '.flp', protools: '.ptxt' }[daw], out = [];
  if (!ext) return out;
  for (const [root, factory] of templateRoots(daw)) {
    const walk = (dir, depth) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!e.name.startsWith('.') && !e.name.startsWith('Backup') && depth < 6) walk(full, depth + 1); continue; }
        if (!e.name.toLowerCase().endsWith(ext) || e.name.startsWith('._')) continue;
        const rel = path.relative(root, full).split(path.sep), name = path.basename(e.name, path.extname(e.name)), group = rel.length > 1 ? rel[0] : '';
        const stock = daw === 'protools' && (AVID_STOCK.has(group) || AVID_STOCK.has(`${group}/${name}`));
        out.push({ path: full, name, group, factory: factory || stock });
      }
    };
    walk(root, 0);
  }
  out.sort((a, b) => (a.factory - b.factory) || a.group.toLowerCase().localeCompare(b.group.toLowerCase()) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  for (const t of out) allowed.templates.add(t.path);
  return out;
}

//----------------------------------------------------------------------------------------------------------------------
const settings = () => {
  const s = loadSettings();
  return { ...s, folder: folderOf(s),
    // Les bus et leurs couleurs viennent de plan.js, pour que la page montre ce que le projet contiendra.
    groups: Object.fromEntries(Object.entries(plan.GROUPS).map(([g, [c, kinds]]) => [g, { color: '#' + c.toString(16).toUpperCase().padStart(6, '0'), kinds }])),
    kindColors: Object.fromEntries(Object.entries(plan.KIND_COLORS).map(([k, c]) => [k, '#' + c.toString(16).toUpperCase().padStart(6, '0')])),
    platform: process.platform, daws: ['fl', 'protools'] };
};

/**
 * Les appels de la page. isSession(event) : vrai seulement pour la page SESSION du site ; win() : la fenêtre de
 * l'application, mère des fenêtres de choix.
 */
function register$(ipcMain, isSession, win) {
  const on = (name, fn) => ipcMain.handle(`session:${name}`, async (event, ...args) => {
    if (!isSession(event)) throw new Error('Réservé à ONIRIQUE SESSION.');
    return fn(...args);
  });
  on('settings', settings);
  on('save-settings', (values) => saveSettings(values && typeof values === 'object' ? values : {}));
  on('register', (paths) => register((Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && path.isAbsolute(p))));
  on('pick-files', async () => {
    const r = await dialog.showOpenDialog(win(), { title: 'Les pistes du morceau', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg', 'm4a'] }, { name: 'Tous les fichiers', extensions: ['*'] }] });
    return r.canceled ? [] : register(r.filePaths);
  });
  // Le son d'un fichier donné, pour l'écoute : tel quel, ou en WAV pour un AIFF.
  on('read', (id) => {
    const p = files.get(String(id));
    if (!p) throw new Error('Fichier inconnu.');
    return /\.(aif|aiff|aifc)$/i.test(p) ? aiffToWav(p) : fs.readFileSync(p);
  });
  on('pick-folder', async () => {
    const r = await dialog.showOpenDialog(win(), { title: 'Le dossier des clients', defaultPath: folderOf(), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const s = loadSettings();
    s.folder = r.filePaths[0];
    fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 1));
    return s.folder;
  });
  on('subfolders', () => {
    try {
      return fs.readdirSync(folderOf(), { withFileTypes: true }).filter((e) => e.isDirectory() && !/^[.$]/.test(e.name)).map((e) => e.name)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    } catch { return []; }
  });
  on('templates', (daw) => { try { return listTemplates(String(daw)); } catch { return []; } });
  // « Autre fichier… » s'ouvre là où ce DAW range ses templates sur ce système.
  on('pick-template', async (daw) => {
    const filters = { fl: [{ name: 'Projet FL Studio', extensions: ['flp'] }], protools: [{ name: 'Template Pro Tools', extensions: ['ptxt'] }] }[daw] || [];
    const start = templateRoots(String(daw)).map(([root]) => root).find((r) => fs.existsSync(r)) || app.getPath('documents');
    const r = await dialog.showOpenDialog(win(), { title: 'La template', defaultPath: start, properties: ['openFile'], filters });
    if (r.canceled || !r.filePaths[0]) return null;
    allowed.templates.add(r.filePaths[0]);
    return r.filePaths[0];
  });
  on('describe', (p) => {
    if (!allowed.templates.has(p)) return { slots: [] }; // une template proposée par l'app ou choisie par l'utilisateur
    try { return p.toLowerCase().endsWith('.flp') ? flp.describe(p) : { slots: [] }; } catch (e) { return { error: e.message }; }
  });
  on('create', async (request) => {
    try {
      const r = request && typeof request === 'object' ? request : {};
      const stems = (Array.isArray(r.stems) ? r.stems : []).map((s) => {
        const p = files.get(String(s.id));
        if (!p) throw new Error('Une piste n\'est plus disponible : redépose-la.');
        return { path: p, kind: String(s.kind), file: plan.safe(s.file) || path.basename(p), track: String(s.track || s.kind).slice(0, 120),
          seconds: Number(s.seconds) || 0, rate: Number(s.rate) || 0 };
      });
      if (!stems.length) throw new Error('Aucune piste.');
      const template = r.template && allowed.templates.has(r.template) ? r.template : null;
      let folder = folderOf();
      if (r.client) folder = path.join(folder, plan.safe(r.client)); // le dossier du client, créé s'il est nouveau
      fs.mkdirSync(folder, { recursive: true });
      const info = Object.fromEntries(['artist', 'title', 'feat', 'producer', 'engineer', 'label', 'genre', 'bpm', 'key', 'comments']
        .map((k) => [k, String(r.info?.[k] ?? '').slice(0, k === 'comments' ? 2000 : 120)]));
      const words = (Array.isArray(r.words) ? r.words : []).filter((w) => Array.isArray(w) && w.length === 2).map(([k, s]) => [String(k), String(s)]);
      const result = await plan.create({ daw: String(r.daw), template, folder, info, stems, words });
      allowed.projects.add(result.project);
      return result;
    } catch (e) {
      // Le détail dans un journal que l'on peut renvoyer au support.
      try { fs.appendFileSync(logFile(), `\n--- ${new Date().toISOString()} ${request?.daw}\n${e.stack || e}\n`); } catch {}
      return { error: e.message || String(e) };
    }
  });
  on('reveal', (p) => { if (allowed.projects.has(p)) shell.showItemInFolder(p); });
  on('open', (p) => { if (allowed.projects.has(p)) return shell.openPath(p); });
}

module.exports = { register: register$, probe, aiffToWav, listTemplates, templateRoots, settings };
