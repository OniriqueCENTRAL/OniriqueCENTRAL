// « Mes sons » : l'espace des membres ONIRIQUE (et des fondateurs) pour leur musique en cours, façon [untitled].
// Des projets, des titres et leurs versions successives, des liens d'écoute privés (mot de passe, date de fin,
// téléchargement au choix), les écoutes comptées et des commentaires placés à un moment du titre.
// Les fichiers vont dans data/sounds/ ; chaque membre a un quota, et plus rien n'entre quand le disque est plein à 80 %.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db, get, all, run, now, setting, setSetting, transaction } from './db.js';
import { HttpError, rateLimit, optionalUser, hashPassword, verifyPassword, rolesWith } from './auth.js';
import { sendMail } from './mail.js';
import { escapeHtml } from './mailtemplate.js';
import { textImage } from './linkpage.js';

db.exec(`
CREATE TABLE IF NOT EXISTS sound_projects (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  cover      TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sound_tracks (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES sound_projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  current_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sound_versions (
  id         INTEGER PRIMARY KEY,
  track_id   INTEGER NOT NULL REFERENCES sound_tracks(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  stored_as  TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  duration   REAL NOT NULL DEFAULT 0,
  peaks      TEXT NOT NULL DEFAULT '[]',
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sound_links (
  id            INTEGER PRIMARY KEY,
  token         TEXT NOT NULL UNIQUE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id    INTEGER REFERENCES sound_projects(id) ON DELETE CASCADE,
  track_id      INTEGER REFERENCES sound_tracks(id) ON DELETE CASCADE,
  label         TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  expires_at    INTEGER,
  download      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sound_plays (
  link_id    INTEGER NOT NULL REFERENCES sound_links(id) ON DELETE CASCADE,
  track_id   INTEGER NOT NULL REFERENCES sound_tracks(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sound_plays_by_link ON sound_plays (link_id, track_id);
CREATE TABLE IF NOT EXISTS sound_comments (
  id         INTEGER PRIMARY KEY,
  track_id   INTEGER NOT NULL REFERENCES sound_tracks(id) ON DELETE CASCADE,
  version_id INTEGER REFERENCES sound_versions(id) ON DELETE SET NULL,
  link_id    INTEGER REFERENCES sound_links(id) ON DELETE SET NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author     TEXT NOT NULL,
  at         REAL NOT NULL DEFAULT 0,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

// Un lien peut n'ouvrir qu'aux personnes connectées à un compte ONIRIQUE.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_links') WHERE name = 'require_account'`).get()) {
  db.exec('ALTER TABLE sound_links ADD COLUMN require_account INTEGER NOT NULL DEFAULT 0');
}
// Où en est un titre : maquette, V1 à V99 ou final ('' : non précisé).
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_tracks') WHERE name = 'stage'`).get()) {
  db.exec(`ALTER TABLE sound_tracks ADD COLUMN stage TEXT NOT NULL DEFAULT ''`);
}
export const STAGE = /^(|maquette|final|v[1-9][0-9]?)$/;
// Les crédits d'un titre (beatmaker, ingés mix, master, rec) et l'auteur de la pochette d'un projet.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_tracks') WHERE name = 'credits'`).get()) {
  db.exec(`ALTER TABLE sound_tracks ADD COLUMN credits TEXT NOT NULL DEFAULT '{}'`);
}
// Le nom d'artiste affiché pour le projet (« dias7am & Nay »…) ; vide : le nom du compte de l'auteur.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_projects') WHERE name = 'artist'`).get()) {
  db.exec(`ALTER TABLE sound_projects ADD COLUMN artist TEXT NOT NULL DEFAULT ''`);
}
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_projects') WHERE name = 'cover_by'`).get()) {
  db.exec(`ALTER TABLE sound_projects ADD COLUMN cover_by TEXT NOT NULL DEFAULT ''`);
}
export const CREDIT_ROLES = ['feat', 'beat', 'mix', 'master', 'rec'];
// La date de sortie d'un projet (AAAA-MM-JJ, '' : pas de date) : prévue si elle est à venir, passée sinon.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_projects') WHERE name = 'release_date'`).get()) {
  db.exec(`ALTER TABLE sound_projects ADD COLUMN release_date TEXT NOT NULL DEFAULT ''`);
}
// Les dossiers d'un membre, et les projets d'autres membres qu'il a enregistrés (par leur lien d'écoute : le lien
// coupé, le projet disparaît de sa page). Un dossier supprimé laisse ses projets à la racine.
db.exec(`
CREATE TABLE IF NOT EXISTS sound_folders (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sound_saves (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  link_id    INTEGER NOT NULL REFERENCES sound_links(id) ON DELETE CASCADE,
  folder_id  INTEGER REFERENCES sound_folders(id) ON DELETE SET NULL,
  pass       TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, link_id)
);
`);
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_projects') WHERE name = 'folder_id'`).get()) {
  db.exec('ALTER TABLE sound_projects ADD COLUMN folder_id INTEGER REFERENCES sound_folders(id) ON DELETE SET NULL');
}
// Les collaborateurs d'un projet (invités par un lien que l'auteur crée, coupe ou renouvelle) : ils écoutent, ajoutent
// des titres et des versions, modifient noms, étapes, crédits et notes. Supprimer le projet, le partager et gérer ses
// collaborateurs restent à l'auteur ; ce qu'ils envoient compte dans son espace.
db.exec(`
CREATE TABLE IF NOT EXISTS sound_collabs (
  project_id INTEGER NOT NULL REFERENCES sound_projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
`);
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_projects') WHERE name = 'invite_token'`).get()) {
  db.exec('ALTER TABLE sound_projects ADD COLUMN invite_token TEXT');
}
// Un projet que le membre peut ouvrir : le sien, ou un projet où il est collaborateur (p = sound_projects).
const ACCESS = '(p.user_id = ? OR p.id IN (SELECT project_id FROM sound_collabs WHERE user_id = ?))';
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().startsWith(value);

export const soundsDir = path.join(config.dataDir, 'sounds');
fs.mkdirSync(soundsDir, { recursive: true });

const MAX_FILE = 500 * 1024 * 1024;
const GB = 1024 ** 3;
const str = (value, max = 200) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const id = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0);

/** Le quota de chaque membre (en Go) et le remplissage du disque au-delà duquel plus rien n'entre, réglables par un fondateur. */
export const quotaBytes = () => setting('sounds_quota_gb', 10) * GB;
const diskMax = () => setting('sounds_disk_max', 0.8);

/** Le disque du serveur : taille et place occupée. */
function disk() {
  const s = fs.statfsSync(config.dataDir);
  const total = s.blocks * s.bsize;
  return { total, used: total - s.bavail * s.bsize };
}
const usedBy = (userId) => get(`SELECT COALESCE(SUM(v.size), 0) AS n FROM sound_versions v JOIN sound_tracks t ON t.id = v.track_id
  JOIN sound_projects p ON p.id = t.project_id WHERE p.user_id = ?`, userId).n;

/** Le format d'un fichier audio, lu sur ses premiers octets : WAV, AIFF, FLAC, MP3, OGG ou M4A. */
export function audioType(head) {
  const at = (start, end) => head.toString('latin1', start, end);
  if (at(0, 4) === 'RIFF' && at(8, 12) === 'WAVE') return 'audio/wav';
  if (at(0, 4) === 'FORM' && ['AIFF', 'AIFC'].includes(at(8, 12))) return 'audio/aiff';
  if (at(0, 4) === 'fLaC') return 'audio/flac';
  if (at(0, 4) === 'OggS') return 'audio/ogg';
  if (at(4, 8) === 'ftyp') return 'audio/mp4';
  if (at(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}

// Les adresses des fichiers audio sont signées et valables quelques heures : un lecteur <audio> n'envoie pas de jeton.
function signKey() {
  let key = setting('sounds_key', null);
  if (!key) { key = crypto.randomBytes(32).toString('hex'); setSetting('sounds_key', key); }
  return key;
}
const sign = (text) => crypto.createHmac('sha256', signKey()).update(text).digest('base64url');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function audioUrl(versionId, download = false) {
  const e = now() + 6 * 3600_000, d = download ? 1 : 0;
  return `/api/sounds/audio/${versionId}?e=${e}&d=${d}&s=${sign(`${versionId}.${e}.${d}`)}`;
}
// Le laissez-passer d'un lien protégé, rendu une fois le mot de passe donné.
const passFor = (link) => sign(`link.${link.id}.${link.password_hash}`);

const versionView = (v, i, download) => ({
  id: v.id, n: i + 1, filename: v.filename, size: v.size, duration: v.duration, peaks: JSON.parse(v.peaks), note: v.note,
  createdAt: v.created_at, url: audioUrl(v.id), downloadUrl: download ? audioUrl(v.id, true) : null,
});
const commentView = (c) => ({ id: c.id, trackId: c.track_id, versionId: c.version_id, author: c.author, at: c.at, body: c.body, createdAt: c.created_at });
const media = (name) => (name ? `/api/media/${name}` : null);
const creditsOf = (row) => { try { return JSON.parse(row.credits || '{}'); } catch { return {}; } };
const person = (u) => ({ id: u.id, name: u.name || 'ONIRIQUE', avatar: media(u.avatar) });
const linkView = (l) => ({
  id: l.id, url: `${config.siteUrl}/ecoute?t=${l.token}`, projectId: l.project_id, trackId: l.track_id, label: l.label,
  password: !!l.password_hash, expiresAt: l.expires_at, download: !!l.download, requireAccount: !!l.require_account, createdAt: l.created_at,
});

function removeVersionFiles(rows) {
  for (const r of rows) fs.rmSync(path.join(soundsDir, r.stored_as), { force: true });
}
/** Les fichiers qui ne correspondent plus à aucune version (compte supprimé, envoi interrompu) sont effacés au démarrage. */
export function sweepSounds() {
  const kept = new Set(all('SELECT stored_as FROM sound_versions').map((r) => r.stored_as));
  for (const name of fs.readdirSync(soundsDir)) if (!kept.has(name)) fs.rmSync(path.join(soundsDir, name), { force: true });
}

//==============================================================================
//  L'aperçu d'un lien d'écoute (Discord, WhatsApp, iMessage…) : la page porte son titre, sa description et une image
//  1200 × 630 aux couleurs de la pochette. Un lien protégé (mot de passe ou compte exigé) ne dévoile rien du projet.
//==============================================================================
// Les pages du site : à côté du serveur en développement, dans /var/www/site en production.
const SITE_DIRS = [process.env.SITE_DIR, path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site'), '/var/www/site'];
const listeningPage = () => {
  const dir = SITE_DIRS.find((d) => d && fs.existsSync(path.join(d, 'ecoute.html')));
  return dir ? fs.readFileSync(path.join(dir, 'ecoute.html'), 'utf8') : null;
};

/** Le lien et ce que son aperçu peut montrer ; null si le lien n'existe pas, n'est plus valable ou que l'auteur n'est plus membre. */
function previewOf(token) {
  const l = get(`SELECT l.*, u.name AS owner_name, u.role AS owner_role FROM sound_links l JOIN users u ON u.id = l.user_id WHERE l.token = ?`, String(token || '').slice(0, 40));
  if (!l || !rolesWith('sounds').includes(l.owner_role) || (l.expires_at && l.expires_at < now())) return null;
  if (l.password_hash || l.require_account) return { link: l, locked: true };
  const t = l.track_id ? get('SELECT * FROM sound_tracks WHERE id = ?', l.track_id) : null;
  const p = get('SELECT * FROM sound_projects WHERE id = ?', l.project_id || t.project_id);
  const tracks = l.track_id ? [t] : all('SELECT * FROM sound_tracks WHERE project_id = ? ORDER BY position, id', p.id);
  const seconds = tracks.reduce((sum, x) => sum + (get('SELECT duration FROM sound_versions WHERE id = ?', x.current_id)?.duration || 0), 0);
  return { link: l, locked: false, owner: p.artist || l.owner_name || 'ONIRIQUE', title: t ? t.title : p.title, project: p.title, cover: p.cover,
    count: tracks.length, seconds, release: p.release_date, stage: t ? t.stage : '' };
}
const releaseText = (day) => {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number), date = new Date(Date.UTC(y, m - 1, d));
  const text = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (date.getTime() > Date.now() ? 'Sortie prévue le ' : 'Sorti le ') + text;
};
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const previewKey = (v) => crypto.createHash('sha1').update(JSON.stringify(v ? { ...v, link: v.link.id } : null)).digest('hex').slice(0, 12);

/** La couleur dominante d'une pochette, éclaircie pour être lisible sur un fond sombre ; gris pour une pochette en noir et blanc. */
async function accentOf(file, sharp) {
  try {
    const { dominant: { r, g, b } } = await sharp(file).stats();
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 24) return '#d9d4d5';
    const k = 200 / max; // même teinte, poussée vers le clair
    return '#' + [r, g, b].map((c) => Math.min(255, Math.round(c * k + 30)).toString(16).padStart(2, '0')).join('');
  } catch { return '#e23444'; }
}

async function previewImage(v) {
  const sharp = (await import('sharp')).default;
  const W = 1200, H = 630, layers = [];
  const cover = v && !v.locked && v.cover ? path.join(config.mediaDir, path.basename(v.cover)) : null;
  const hasCover = cover && fs.existsSync(cover);
  const accent = hasCover ? await accentOf(cover, sharp) : '#e23444';
  // Le fond : la pochette floutée et assombrie, sinon le dégradé sang et nuit d'ONIRIQUE.
  const gradient = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g" cx="25%" cy="0%" r="110%">
    <stop offset="0" stop-color="#8c0614"/><stop offset=".45" stop-color="#2a0a0e"/><stop offset="1" stop-color="#0d0809"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  const base = hasCover
    ? await sharp(cover).resize(W, H, { fit: 'cover' }).blur(48).modulate({ brightness: 0.42, saturation: 1.3 }).png().toBuffer().catch(() => gradient)
    : gradient;
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="s" x1="0" x2="1">
    <stop offset="0" stop-color="#0d0809" stop-opacity=".15"/><stop offset="1" stop-color="#0d0809" stop-opacity=".75"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#s)"/></svg>`), left: 0, top: 0 });

  let left = 80;
  if (!v || v.locked || hasCover) {
    const size = 440, top = Math.round((H - size) / 2);
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="34" fill="#fff"/></svg>`);
    const art = hasCover
      ? await sharp(cover).resize(size, size, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
      : Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><radialGradient id="c" cx="30%" cy="20%" r="90%"><stop offset="0" stop-color="#e23444"/><stop offset=".6" stop-color="#5c0008"/><stop offset="1" stop-color="#0d0809"/></radialGradient></defs>
        <rect width="${size}" height="${size}" rx="34" fill="url(#c)"/>
        ${v && v.locked
          ? `<g transform="translate(${size / 2 - 60} ${size / 2 - 76})" fill="none" stroke="#f6eeee" stroke-width="12" stroke-linecap="round"><rect x="0" y="62" width="120" height="96" rx="18" fill="#f6eeee" stroke="none"/><path d="M24 64V42a36 36 0 0 1 72 0v22"/></g>`
          : `<path transform="translate(${size / 2 - 80} ${size / 2 - 80}) scale(6.67)" d="M12 1.5 13.3 10.7 22.5 12 13.3 13.3 12 22.5 10.7 13.3 1.5 12 10.7 10.7Z" fill="#f6eeee" fill-opacity=".85"/>`}</svg>`);
    layers.push({ input: art, left, top });
    left += size + 64;
  }
  const width = W - left - 70;
  const title = !v ? 'Lien introuvable' : v.locked ? "Lien d'écoute protégé" : v.title;
  const lines = [];
  lines.push({ img: await textImage(v && v.locked ? 'ÉCOUTE PRIVÉE · PROTÉGÉE' : 'ÉCOUTE PRIVÉE', 'JetBrains Mono', 'JetBrainsMono500.ttf', 20, accent, width), gap: 22 });
  const big = await textImage(title, 'Unbounded', 'Unbounded800.ttf', title.length > 34 ? 40 : title.length > 18 ? 50 : 62, '#f6eeee', width);
  lines.push({ img: big.height > 260 ? { ...big, data: await sharp(big.data).extract({ left: 0, top: 0, width: big.width, height: 260 }).png().toBuffer(), height: 260 } : big, gap: 24 });
  const meta = !v ? "Ce lien n'existe pas, ou n'est plus valable."
    : v.locked ? `Partagé par ${v.link.owner_name || 'un membre'} · ${v.link.password_hash ? 'mot de passe demandé' : 'compte ONIRIQUE demandé'}`
      : [`par ${v.owner}`, v.title !== v.project ? `extrait de ${v.project}` : `${v.count} titre${v.count > 1 ? 's' : ''}`, v.seconds ? clock(v.seconds) : ''].filter(Boolean).join(' · ');
  lines.push({ img: await textImage(meta, 'Hanken Grotesk', 'HankenGrotesk600.ttf', 26, '#dccfd1', width), gap: 18 });
  const release = v && !v.locked ? releaseText(v.release) : '';
  if (release) lines.push({ img: await textImage(release, 'Hanken Grotesk', 'HankenGrotesk600.ttf', 24, accent, width), gap: 0 });
  const block = lines.reduce((sum, l) => sum + l.img.height + l.gap, 0);
  let top = Math.max(50, Math.round((H - block) / 2));
  for (const l of lines) { layers.push({ input: l.img.data, left, top }); top += l.img.height + l.gap; }
  const mark = await textImage('✦ ONIRIQUE', 'JetBrains Mono', 'JetBrainsMono500.ttf', 18, '#f6eeee', 300, '65%');
  layers.push({ input: mark.data, left: W - mark.width - 50, top: H - mark.height - 40 });
  return { png: await sharp(base).composite(layers).png({ compressionLevel: 9 }).toBuffer(), accent };
}

/** La page d'écoute avec les balises de partage de ce lien (le reste de la page ne change pas). */
function listeningHtml(v, token) {
  const page = listeningPage();
  if (!page) return null;
  const site = config.siteUrl;
  const title = !v ? 'Écoute privée · ONIRIQUE' : v.locked ? `${v.link.owner_name || 'ONIRIQUE'} — Écoute privée` : `${v.owner} — ${v.title}`;
  const description = !v ? "Ce lien d'écoute n'existe pas, ou n'est plus valable."
    : v.locked ? `Lien d'écoute protégé, partagé sur ONIRIQUE${v.link.password_hash ? ' : mot de passe demandé' : ' : compte ONIRIQUE demandé'}.`
      : [v.title !== v.project ? `Un titre extrait de ${v.project}` : `${v.count} titre${v.count > 1 ? 's' : ''}${v.seconds ? ` · ${clock(v.seconds)}` : ''}`,
        releaseText(v.release), 'Écoute privée sur ONIRIQUE'].filter(Boolean).join(' · ');
  const image = `${site}/api/sounds/share/${encodeURIComponent(token)}/apercu.png?v=${previewKey(v)}`;
  const tags = `<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="music.album">
<meta property="og:site_name" content="ONIRIQUE">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(`${site}/ecoute?t=${encodeURIComponent(token)}`)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeHtml(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<meta name="theme-color" content="${escapeHtml(v && v.accent ? v.accent : '#e23444')}">`;
  return page.replace(/<title>[^<]*<\/title>/, tags);
}

export function mountSounds(app, { requireUser, receiveFile, receiveImage, removeMedia, wrap }) {
  sweepSounds();
  const member = (req, _res, next) => (rolesWith('sounds').includes(req.user.role) ? next()
    : next(new HttpError(403, 'Mes sons est réservé aux membres ONIRIQUE.')));
  const me = [requireUser, member];

  const project = (req, pid) => {
    const row = get(`SELECT p.* FROM sound_projects p WHERE p.id = ? AND ${ACCESS}`, id(pid), req.user.id, req.user.id);
    if (!row) throw new HttpError(404, 'Projet introuvable.');
    return row;
  };
  // Ce que seul l'auteur fait : supprimer, partager, ranger dans ses dossiers, gérer les collaborateurs.
  const ownProject = (req, pid) => {
    const row = project(req, pid);
    if (row.user_id !== req.user.id) throw new HttpError(403, "Seul l'auteur du projet peut faire ça.");
    return row;
  };
  const track = (req, tid) => {
    const row = get(`SELECT t.*, p.user_id AS owner_id FROM sound_tracks t JOIN sound_projects p ON p.id = t.project_id WHERE t.id = ? AND ${ACCESS}`, id(tid), req.user.id, req.user.id);
    if (!row) throw new HttpError(404, 'Titre introuvable.');
    return row;
  };
  const versionOf = (req, vid) => {
    const row = get(`SELECT v.*, t.current_id FROM sound_versions v JOIN sound_tracks t ON t.id = v.track_id JOIN sound_projects p ON p.id = t.project_id
      WHERE v.id = ? AND ${ACCESS}`, id(vid), req.user.id, req.user.id);
    if (!row) throw new HttpError(404, 'Version introuvable.');
    return row;
  };

  /** La place qui reste au membre, si ce fichier peut entrer sans dépasser son quota ni le seuil du disque. */
  function room(req, length, ownerId = req.user.id) {
    const d = disk();
    if ((d.used + length) / d.total > diskMax()) throw new HttpError(507, "L'espace de stockage d'ONIRIQUE est plein pour le moment : aucun envoi n'est possible. Réessaie plus tard.");
    const left = quotaBytes() - usedBy(ownerId);
    if (length > left) throw new HttpError(413, ownerId !== req.user.id ? "L'espace de l'auteur du projet est plein : il doit faire de la place pour que tu envoies d'autres sons." : `Ton espace est plein (${Math.round(quotaBytes() / GB)} Go) : supprime des versions ou des titres pour en envoyer d'autres.`);
    return left;
  }
  /** Reçoit un fichier audio : refusé si le quota du membre ou le seuil du disque serait dépassé. */
  async function receiveAudio(req, ownerId = req.user.id) {
    const length = Number(req.headers['content-length']);
    if (!Number.isFinite(length) || length <= 0) throw new HttpError(411, 'Taille du fichier inconnue.');
    if (length > MAX_FILE) throw new HttpError(413, 'Fichier trop volumineux : 500 Mo au plus par fichier.');
    const file = await receiveFile(req, soundsDir, Math.min(MAX_FILE, room(req, length, ownerId)));
    const stored = path.join(soundsDir, file.storedAs);
    const head = Buffer.alloc(12);
    const fd = fs.openSync(stored, 'r');
    fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
    const mime = audioType(head);
    if (!mime) {
      fs.rmSync(stored, { force: true });
      throw new HttpError(400, "Ce fichier n'est pas un son reconnu : WAV, AIFF, FLAC, MP3, OGG ou M4A.");
    }
    return { ...file, mime, filename: str(req.query.filename, 200) || 'son' };
  }
  const addVersion = (trackId, file, note) => run(
    `INSERT INTO sound_versions (track_id, filename, stored_as, mime, size, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    trackId, file.filename, file.storedAs, file.mime, file.size, note, now()).lastInsertRowid;

  // Tout l'espace du membre en une fois : projets, titres, versions, commentaires, liens et place occupée.
  app.get('/api/me/sounds', ...me, (req, res) => {
    const u = req.user.id;
    const projects = all(`SELECT p.*, o.name AS owner_name, o.avatar AS owner_avatar FROM sound_projects p JOIN users o ON o.id = p.user_id
      WHERE ${ACCESS} ORDER BY p.created_at DESC`, u, u);
    const collabs = all(`SELECT c.project_id, u.id, u.name, u.avatar FROM sound_collabs c JOIN users u ON u.id = c.user_id
      JOIN sound_projects p ON p.id = c.project_id WHERE ${ACCESS} ORDER BY c.created_at`, u, u);
    const tracks = all(`SELECT t.* FROM sound_tracks t JOIN sound_projects p ON p.id = t.project_id WHERE ${ACCESS} ORDER BY t.position, t.id`, u, u);
    const versions = all(`SELECT v.* FROM sound_versions v JOIN sound_tracks t ON t.id = v.track_id JOIN sound_projects p ON p.id = t.project_id
      WHERE ${ACCESS} ORDER BY v.id`, u, u);
    const comments = all(`SELECT c.* FROM sound_comments c JOIN sound_tracks t ON t.id = c.track_id JOIN sound_projects p ON p.id = t.project_id
      WHERE ${ACCESS} ORDER BY c.at`, u, u);
    const links = all(`SELECT l.*, (SELECT COUNT(*) FROM sound_plays WHERE link_id = l.id) AS plays,
      (SELECT MAX(created_at) FROM sound_plays WHERE link_id = l.id) AS last_play FROM sound_links l WHERE l.user_id = ? ORDER BY l.created_at DESC`, req.user.id);
    // Les écoutes de chaque titre, tous liens confondus, et les auditeurs connectés (le dernier venu d'abord).
    const plays = all(`SELECT s.track_id, s.link_id, s.created_at, u.id, u.name, u.avatar FROM sound_plays s JOIN sound_links l ON l.id = s.link_id
      LEFT JOIN users u ON u.id = s.user_id WHERE l.user_id = ? ORDER BY s.created_at DESC`, req.user.id);
    const listeners = (rows) => [...new Map(rows.filter((r) => r.id).map((r) => [r.id, { ...person(r), at: r.created_at }])).values()];
    const d = disk();
    res.json({
      owner: person(req.user),
      quota: { used: usedBy(req.user.id), limit: quotaBytes(), full: d.used / d.total >= diskMax() },
      projects: projects.map((p) => ({
        id: p.id, title: p.title, artist: p.artist, cover: media(p.cover), coverBy: p.cover_by, releaseDate: p.release_date, createdAt: p.created_at,
        // Les dossiers sont ceux de l'auteur : un projet où l'on collabore est à la racine de sa page.
        mine: p.user_id === u, folderId: p.user_id === u ? p.folder_id : null,
        owner: person({ id: p.user_id, name: p.owner_name, avatar: p.owner_avatar }),
        collaborators: collabs.filter((c) => c.project_id === p.id).map(person),
        inviteUrl: p.user_id === u && p.invite_token ? `${config.siteUrl}/mes-sons#/invite/${p.invite_token}` : null,
        tracks: tracks.filter((t) => t.project_id === p.id).map((t) => {
          const mine = plays.filter((r) => r.track_id === t.id);
          return {
            id: t.id, title: t.title, stage: t.stage, credits: creditsOf(t), currentId: t.current_id, createdAt: t.created_at,
            versions: versions.filter((v) => v.track_id === t.id).map((v, i) => versionView(v, i, true)),
            comments: comments.filter((c) => c.track_id === t.id).map(commentView),
            plays: mine.length, lastPlay: mine[0]?.created_at ?? null, listeners: listeners(mine),
          };
        }),
      })),
      links: links.map((l) => {
        const mine = plays.filter((r) => r.link_id === l.id);
        return { ...linkView(l), plays: l.plays, lastPlay: l.last_play, listeners: listeners(mine) };
      }),
      folders: all('SELECT id, title, created_at FROM sound_folders WHERE user_id = ? ORDER BY created_at DESC', req.user.id)
        .map((f) => ({ id: f.id, title: f.title, createdAt: f.created_at })),
      // Les projets des autres, enregistrés : encore ouverts si le lien vit et que son auteur est toujours membre.
      saved: all(`SELECT s.id, s.folder_id, s.pass, s.created_at, l.id AS link_id, l.token, l.track_id, l.expires_at, l.password_hash,
          u.name AS owner_name, u.avatar AS owner_avatar, u.role AS owner_role, p.title AS project_title, p.cover, p.artist, t.title AS track_title,
          (SELECT COUNT(*) FROM sound_tracks WHERE project_id = p.id) AS tracks
        FROM sound_saves s JOIN sound_links l ON l.id = s.link_id JOIN users u ON u.id = l.user_id
        LEFT JOIN sound_tracks t ON t.id = l.track_id JOIN sound_projects p ON p.id = COALESCE(l.project_id, t.project_id)
        WHERE s.user_id = ? ORDER BY s.created_at DESC`, req.user.id).map((r) => ({
        id: r.id, token: r.token, folderId: r.folder_id, title: r.track_id ? r.track_title : r.project_title, owner: r.artist || r.owner_name || 'ONIRIQUE',
        ownerAvatar: media(r.owner_avatar), cover: media(r.cover), tracks: r.track_id ? 1 : r.tracks, createdAt: r.created_at,
        available: rolesWith('sounds').includes(r.owner_role) && !(r.expires_at && r.expires_at < now()),
        pass: r.password_hash && r.pass && same(r.pass, passFor({ id: r.link_id, password_hash: r.password_hash })) ? r.pass : null,
      })),
    });
  });

  // Les dossiers.
  const folderOf = (req, value) => {
    if (value === null || value === '' || value === undefined) return null;
    const f = get('SELECT id FROM sound_folders WHERE id = ? AND user_id = ?', id(value), req.user.id);
    if (!f) throw new HttpError(404, 'Dossier introuvable.');
    return f.id;
  };
  app.post('/api/me/sounds/folders', ...me, (req, res) => {
    rateLimit(`sounds:${req.user.id}`, 300);
    const title = str(req.body.title, 80);
    if (!title) throw new HttpError(400, 'Donne un nom au dossier.');
    res.status(201).json({ id: run('INSERT INTO sound_folders (user_id, title, created_at) VALUES (?, ?, ?)', req.user.id, title, now()).lastInsertRowid });
  });
  app.patch('/api/me/sounds/folders/:id', ...me, (req, res) => {
    const fid = folderOf(req, req.params.id);
    const title = str(req.body.title, 80);
    if (!title) throw new HttpError(400, 'Donne un nom au dossier.');
    run('UPDATE sound_folders SET title = ? WHERE id = ?', title, fid);
    res.json({ ok: true });
  });
  app.delete('/api/me/sounds/folders/:id', ...me, (req, res) => {
    run('DELETE FROM sound_folders WHERE id = ?', folderOf(req, req.params.id));
    res.json({ ok: true });
  });

  // Les projets enregistrés : rangés dans un dossier, ou retirés de la page.
  const ownSave = (req) => {
    const save = get('SELECT * FROM sound_saves WHERE id = ? AND user_id = ?', id(req.params.id), req.user.id);
    if (!save) throw new HttpError(404, 'Projet enregistré introuvable.');
    return save;
  };
  app.patch('/api/me/sounds/saves/:id', ...me, (req, res) => {
    run('UPDATE sound_saves SET folder_id = ? WHERE id = ?', folderOf(req, req.body.folderId), ownSave(req).id);
    res.json({ ok: true });
  });
  app.delete('/api/me/sounds/saves/:id', ...me, (req, res) => {
    run('DELETE FROM sound_saves WHERE id = ?', ownSave(req).id);
    res.json({ ok: true });
  });

  app.post('/api/me/sounds/projects', ...me, (req, res) => {
    rateLimit(`sounds:${req.user.id}`, 300);
    const title = str(req.body.title, 120);
    if (!title) throw new HttpError(400, 'Donne un nom au projet.');
    res.status(201).json({ id: run('INSERT INTO sound_projects (user_id, title, created_at) VALUES (?, ?, ?)', req.user.id, title, now()).lastInsertRowid });
  });
  app.patch('/api/me/sounds/projects/:id', ...me, (req, res) => {
    const p = project(req, req.params.id);
    if (req.body.title !== undefined) {
      const title = str(req.body.title, 120);
      if (!title) throw new HttpError(400, 'Donne un nom au projet.');
      run('UPDATE sound_projects SET title = ? WHERE id = ?', title, p.id);
    }
    if (req.body.coverBy !== undefined) run('UPDATE sound_projects SET cover_by = ? WHERE id = ?', str(req.body.coverBy, 80), p.id);
    if (req.body.artist !== undefined) run('UPDATE sound_projects SET artist = ? WHERE id = ?', str(req.body.artist, 120), p.id);
    if (req.body.folderId !== undefined) run('UPDATE sound_projects SET folder_id = ? WHERE id = ?', folderOf(req, req.body.folderId), ownProject(req, p.id).id);
    if (req.body.releaseDate !== undefined) {
      const day = String(req.body.releaseDate || '');
      if (day && !isDay(day)) throw new HttpError(400, 'Date de sortie invalide.');
      run('UPDATE sound_projects SET release_date = ? WHERE id = ?', day, p.id);
    }
    // L'ordre des titres : la liste de leurs identifiants, seulement ceux de ce projet.
    if (Array.isArray(req.body.order)) transaction(() => req.body.order.forEach((tid, i) =>
      run('UPDATE sound_tracks SET position = ? WHERE id = ? AND project_id = ?', i, id(tid), p.id)));
    res.json({ ok: true });
  });
  app.delete('/api/me/sounds/projects/:id', ...me, (req, res) => {
    const p = ownProject(req, req.params.id);
    const files = all('SELECT v.stored_as FROM sound_versions v JOIN sound_tracks t ON t.id = v.track_id WHERE t.project_id = ?', p.id);
    run('DELETE FROM sound_projects WHERE id = ?', p.id);
    removeVersionFiles(files);
    if (p.cover) removeMedia(p.cover);
    res.json({ ok: true });
  });
  app.put('/api/me/sounds/projects/:id/cover', ...me, wrap(async (req, res) => {
    const p = project(req, req.params.id);
    rateLimit(`sounds-cover:${req.user.id}`, 30);
    const name = await receiveImage(req, 5 * 1024 * 1024);
    run('UPDATE sound_projects SET cover = ? WHERE id = ?', name, p.id);
    if (p.cover) removeMedia(p.cover);
    res.json({ cover: media(name) });
  }));

  // Un nouveau titre : le fichier en corps brut, son nom dans ?filename= ; il devient sa version 1.
  app.post('/api/me/sounds/projects/:id/tracks', ...me, wrap(async (req, res) => {
    const p = project(req, req.params.id);
    rateLimit(`sounds-upload:${req.user.id}`, 200, 3600_000);
    const file = await receiveAudio(req, p.user_id);
    const title = str(req.query.title, 120) || file.filename.replace(/\.[a-z0-9]{2,5}$/i, '');
    const trackId = transaction(() => {
      const position = get('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM sound_tracks WHERE project_id = ?', p.id).n;
      const tid = run('INSERT INTO sound_tracks (project_id, title, position, created_at) VALUES (?, ?, ?, ?)', p.id, title, position, now()).lastInsertRowid;
      run('UPDATE sound_tracks SET current_id = ? WHERE id = ?', addVersion(tid, file, ''), tid);
      return tid;
    });
    res.status(201).json({ id: trackId, versionId: get('SELECT current_id FROM sound_tracks WHERE id = ?', trackId).current_id });
  }));
  // Une nouvelle version d'un titre : elle devient celle qu'on écoute, les précédentes restent dans l'historique.
  app.post('/api/me/sounds/tracks/:id/versions', ...me, wrap(async (req, res) => {
    const t = track(req, req.params.id);
    rateLimit(`sounds-upload:${req.user.id}`, 200, 3600_000);
    const file = await receiveAudio(req, t.owner_id);
    const vid = addVersion(t.id, file, str(req.query.note, 300));
    run('UPDATE sound_tracks SET current_id = ? WHERE id = ?', vid, t.id);
    res.status(201).json({ id: vid });
  }));
  app.patch('/api/me/sounds/tracks/:id', ...me, (req, res) => {
    const t = track(req, req.params.id);
    // Les crédits : un nom par rôle, un rôle vide est retiré.
    if (req.body.credits && typeof req.body.credits === 'object') {
      const credits = Object.fromEntries(CREDIT_ROLES.map((role) => [role, str(req.body.credits[role], 120)]).filter(([, name]) => name));
      run('UPDATE sound_tracks SET credits = ? WHERE id = ?', JSON.stringify(credits), t.id);
    }
    if (req.body.stage !== undefined) {
      const stage = String(req.body.stage).toLowerCase();
      if (!STAGE.test(stage)) throw new HttpError(400, 'Étape inconnue : maquette, V1 à V99 ou final.');
      run('UPDATE sound_tracks SET stage = ? WHERE id = ?', stage, t.id);
    }
    if (req.body.title !== undefined) {
      const title = str(req.body.title, 120);
      if (!title) throw new HttpError(400, 'Donne un nom au titre.');
      run('UPDATE sound_tracks SET title = ? WHERE id = ?', title, t.id);
    }
    if (req.body.currentId !== undefined) {
      if (!get('SELECT 1 FROM sound_versions WHERE id = ? AND track_id = ?', id(req.body.currentId), t.id)) throw new HttpError(400, 'Version inconnue.');
      run('UPDATE sound_tracks SET current_id = ? WHERE id = ?', id(req.body.currentId), t.id);
    }
    // Déplacer le titre dans un autre projet du membre : il arrive à la fin.
    if (req.body.projectId !== undefined && id(req.body.projectId) !== t.project_id) {
      const to = project(req, req.body.projectId);
      run('UPDATE sound_tracks SET project_id = ?, position = (SELECT COALESCE(MAX(position), -1) + 1 FROM sound_tracks WHERE project_id = ?) WHERE id = ?', to.id, to.id, t.id);
    }
    res.json({ ok: true });
  });
  // Dupliquer un titre : un nouveau titre juste après, avec une copie du fichier de la version en avant.
  app.post('/api/me/sounds/tracks/:id/duplicate', ...me, (req, res) => {
    const t = track(req, req.params.id);
    rateLimit(`sounds-upload:${req.user.id}`, 200, 3600_000);
    const v = get('SELECT * FROM sound_versions WHERE id = ?', t.current_id);
    room(req, v.size, t.owner_id);
    const storedAs = crypto.randomBytes(16).toString('hex');
    fs.copyFileSync(path.join(soundsDir, v.stored_as), path.join(soundsDir, storedAs));
    const tid = transaction(() => {
      run('UPDATE sound_tracks SET position = position + 1 WHERE project_id = ? AND position > ?', t.project_id, t.position);
      const created = run('INSERT INTO sound_tracks (project_id, title, position, created_at) VALUES (?, ?, ?, ?)',
        t.project_id, str(`${t.title} (copie)`, 120), t.position + 1, now()).lastInsertRowid;
      const vid = run(`INSERT INTO sound_versions (track_id, filename, stored_as, mime, size, duration, peaks, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        created, v.filename, storedAs, v.mime, v.size, v.duration, v.peaks, v.note, now()).lastInsertRowid;
      run('UPDATE sound_tracks SET current_id = ? WHERE id = ?', vid, created);
      return created;
    });
    res.status(201).json({ id: tid });
  });
  app.delete('/api/me/sounds/tracks/:id', ...me, (req, res) => {
    const t = track(req, req.params.id);
    const files = all('SELECT stored_as FROM sound_versions WHERE track_id = ?', t.id);
    run('DELETE FROM sound_tracks WHERE id = ?', t.id);
    removeVersionFiles(files);
    res.json({ ok: true });
  });

  // La forme d'onde et la durée, calculées par le navigateur à l'envoi ; la note de version.
  app.patch('/api/me/sounds/versions/:id', ...me, (req, res) => {
    const v = versionOf(req, req.params.id);
    if (Array.isArray(req.body.peaks)) {
      const peaks = req.body.peaks.slice(0, 2000).map((n) => Math.min(1, Math.max(0, Math.round(Number(n) * 1000) / 1000 || 0)));
      run('UPDATE sound_versions SET peaks = ? WHERE id = ?', JSON.stringify(peaks), v.id);
    }
    if (Number.isFinite(Number(req.body.duration))) run('UPDATE sound_versions SET duration = ? WHERE id = ?', Math.max(0, Number(req.body.duration)), v.id);
    if (req.body.note !== undefined) run('UPDATE sound_versions SET note = ? WHERE id = ?', str(req.body.note, 300), v.id);
    res.json({ ok: true });
  });
  app.delete('/api/me/sounds/versions/:id', ...me, (req, res) => {
    const v = versionOf(req, req.params.id);
    const others = all('SELECT id FROM sound_versions WHERE track_id = ? AND id != ? ORDER BY id DESC', v.track_id, v.id);
    if (!others.length) throw new HttpError(400, "C'est la seule version de ce titre : supprime le titre à la place.");
    transaction(() => {
      run('DELETE FROM sound_versions WHERE id = ?', v.id);
      if (v.current_id === v.id) run('UPDATE sound_tracks SET current_id = ? WHERE id = ?', others[0].id, v.track_id);
    });
    removeVersionFiles([v]);
    res.json({ ok: true });
  });

  // Les liens d'écoute : un projet entier ou un seul titre.
  app.post('/api/me/sounds/links', ...me, (req, res) => {
    rateLimit(`sounds:${req.user.id}`, 300);
    const projectId = req.body.projectId ? ownProject(req, req.body.projectId).id : null;
    const trackId = !projectId && req.body.trackId ? ownProject(req, track(req, req.body.trackId).project_id) && id(req.body.trackId) : null;
    if (!projectId && !trackId) throw new HttpError(400, 'Choisis un projet ou un titre à partager.');
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (password && password.length < 4) throw new HttpError(400, 'Mot de passe : 4 caractères au moins.');
    const expiresAt = req.body.expiresAt ? Number(req.body.expiresAt) : null;
    if (expiresAt !== null && !(expiresAt > now())) throw new HttpError(400, 'La date de fin doit être dans le futur.');
    const token = crypto.randomBytes(12).toString('base64url');
    const lid = run(`INSERT INTO sound_links (token, user_id, project_id, track_id, label, password_hash, expires_at, download, require_account, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, token, req.user.id, projectId, trackId, str(req.body.label, 80), password ? hashPassword(password) : null,
    expiresAt, req.body.download ? 1 : 0, req.body.requireAccount ? 1 : 0, now()).lastInsertRowid;
    res.status(201).json(linkView(get('SELECT * FROM sound_links WHERE id = ?', lid)));
  });
  const ownLink = (req) => {
    const l = get('SELECT * FROM sound_links WHERE id = ? AND user_id = ?', id(req.params.id), req.user.id);
    if (!l) throw new HttpError(404, 'Lien introuvable.');
    return l;
  };
  // Les réglages d'un lien : téléchargement, compte exigé, mot de passe ('' le retire), date de fin (null la retire).
  app.patch('/api/me/sounds/links/:id', ...me, (req, res) => {
    const l = ownLink(req);
    if (typeof req.body.password === 'string' && req.body.password && req.body.password.length < 4) throw new HttpError(400, 'Mot de passe : 4 caractères au moins.');
    const at = req.body.expiresAt ? Number(req.body.expiresAt) : null;
    if (req.body.expiresAt !== undefined && at !== null && !(at > now())) throw new HttpError(400, 'La date de fin doit être dans le futur.');
    if (req.body.download !== undefined) run('UPDATE sound_links SET download = ? WHERE id = ?', req.body.download ? 1 : 0, l.id);
    if (req.body.requireAccount !== undefined) run('UPDATE sound_links SET require_account = ? WHERE id = ?', req.body.requireAccount ? 1 : 0, l.id);
    if (typeof req.body.password === 'string') run('UPDATE sound_links SET password_hash = ? WHERE id = ?', req.body.password ? hashPassword(req.body.password) : null, l.id);
    if (req.body.expiresAt !== undefined) run('UPDATE sound_links SET expires_at = ? WHERE id = ?', at, l.id);
    res.json(linkView(get('SELECT * FROM sound_links WHERE id = ?', l.id)));
  });
  // Une nouvelle adresse pour le lien : l'ancienne ne s'ouvre plus, les réglages et les écoutes restent.
  app.post('/api/me/sounds/links/:id/reset', ...me, (req, res) => {
    const l = ownLink(req);
    run('UPDATE sound_links SET token = ? WHERE id = ?', crypto.randomBytes(12).toString('base64url'), l.id);
    res.json(linkView(get('SELECT * FROM sound_links WHERE id = ?', l.id)));
  });
  app.delete('/api/me/sounds/links/:id', ...me, (req, res) => {
    if (!run('DELETE FROM sound_links WHERE id = ? AND user_id = ?', id(req.params.id), req.user.id).changes) throw new HttpError(404, 'Lien introuvable.');
    res.json({ ok: true });
  });
  app.delete('/api/me/sounds/comments/:id', ...me, (req, res) => {
    const c = get(`SELECT c.id FROM sound_comments c JOIN sound_tracks t ON t.id = c.track_id JOIN sound_projects p ON p.id = t.project_id
      WHERE c.id = ? AND p.user_id = ?`, id(req.params.id), req.user.id);
    if (!c) throw new HttpError(404, 'Commentaire introuvable.');
    run('DELETE FROM sound_comments WHERE id = ?', c.id);
    res.json({ ok: true });
  });

  // L'invitation à collaborer : un lien que l'auteur crée (ou renouvelle, l'ancien ne marche plus) et peut couper.
  app.post('/api/me/sounds/projects/:id/invite', ...me, (req, res) => {
    const p = ownProject(req, req.params.id);
    const token = crypto.randomBytes(12).toString('base64url');
    run('UPDATE sound_projects SET invite_token = ? WHERE id = ?', token, p.id);
    res.json({ url: `${config.siteUrl}/mes-sons#/invite/${token}` });
  });
  app.delete('/api/me/sounds/projects/:id/invite', ...me, (req, res) => {
    run('UPDATE sound_projects SET invite_token = NULL WHERE id = ?', ownProject(req, req.params.id).id);
    res.json({ ok: true });
  });
  // Retirer un collaborateur (l'auteur), ou quitter le projet (le collaborateur lui-même).
  app.delete('/api/me/sounds/projects/:id/collabs/:user', ...me, (req, res) => {
    const p = project(req, req.params.id), who = id(req.params.user);
    if (p.user_id !== req.user.id && who !== req.user.id) throw new HttpError(403, "Seul l'auteur du projet peut retirer un collaborateur.");
    run('DELETE FROM sound_collabs WHERE project_id = ? AND user_id = ?', p.id, who);
    res.json({ ok: true });
  });
  const invitation = (token) => {
    const p = get(`SELECT p.*, u.name AS owner_name, u.avatar AS owner_avatar FROM sound_projects p JOIN users u ON u.id = p.user_id
      WHERE p.invite_token = ?`, str(token, 40));
    if (!p || !p.invite_token) throw new HttpError(404, "Cette invitation n'existe pas ou n'est plus valable.");
    return p;
  };
  app.get('/api/sounds/invite/:token', ...me, (req, res) => {
    const p = invitation(req.params.token);
    res.json({ project: p.title, cover: media(p.cover), owner: person({ id: p.user_id, name: p.owner_name, avatar: p.owner_avatar }),
      projectId: p.id, mine: p.user_id === req.user.id,
      already: !!get('SELECT 1 FROM sound_collabs WHERE project_id = ? AND user_id = ?', p.id, req.user.id) });
  });
  app.post('/api/sounds/invite/:token/accept', ...me, (req, res) => {
    rateLimit(`sounds-invite:${req.user.id}`, 60);
    const p = invitation(req.params.token);
    if (p.user_id === req.user.id) throw new HttpError(400, "C'est ton propre projet.");
    run('INSERT OR IGNORE INTO sound_collabs (project_id, user_id, created_at) VALUES (?, ?, ?)', p.id, req.user.id, now());
    res.json({ projectId: p.id });
  });

  // Le quota par membre et le seuil du disque, pour les fondateurs.
  app.get('/api/admin/sounds', requireUser, (req, res) => {
    if (req.user.role !== 'founder') throw new HttpError(403, 'Réservé aux fondateurs.');
    const d = disk();
    res.json({ quotaGb: quotaBytes() / GB, diskUsed: d.used, diskTotal: d.total, diskMax: diskMax(),
      stored: get('SELECT COALESCE(SUM(size), 0) AS n FROM sound_versions').n });
  });
  app.put('/api/admin/sounds', requireUser, (req, res) => {
    if (req.user.role !== 'founder') throw new HttpError(403, 'Réservé aux fondateurs.');
    const gb = Number(req.body.quotaGb);
    if (!(gb >= 0.1 && gb <= 1000)) throw new HttpError(400, 'Quota : entre 0,1 et 1000 Go.');
    setSetting('sounds_quota_gb', gb);
    res.json({ quotaGb: gb });
  });

  // ——— Le côté auditeur : ecoute.html?t=<jeton> ———

  /** Le lien demandé, s'il est encore valable et que son auteur est toujours membre ; le mot de passe ou le laissez-passer vérifié. */
  /** Un membre connecté qui n'est pas l'auteur peut enregistrer le projet dans « Mes sons ». */
  function saveState(req, link) {
    const viewer = optionalUser(req);
    const canSave = !!viewer && rolesWith('sounds').includes(viewer.role) && viewer.id !== link.user_id;
    return { canSave, saved: canSave && !!get('SELECT 1 FROM sound_saves WHERE user_id = ? AND link_id = ?', viewer.id, link.id) };
  }

  function openLink(req) {
    const link = get(`SELECT l.*, u.name AS owner_name, u.email AS owner_email, u.avatar AS owner_avatar FROM sound_links l JOIN users u ON u.id = l.user_id
      WHERE l.token = ? AND u.role IN (${rolesWith('sounds').map(() => '?').join(', ')})`, str(req.params.token, 40), ...rolesWith('sounds'));
    if (!link || (link.expires_at && link.expires_at < now())) throw new HttpError(404, "Ce lien d'écoute n'existe pas ou n'est plus valable.");
    if (link.require_account && !optionalUser(req)) {
      throw Object.assign(new HttpError(401, 'Connecte-toi à ton compte ONIRIQUE pour écouter ce lien.'), { data: { account: true } });
    }
    if (link.password_hash) {
      const pass = typeof req.body?.pass === 'string' ? req.body.pass : '';
      if (!(pass && same(pass, passFor(link)))) {
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!password) throw new HttpError(401, 'Ce lien est protégé par un mot de passe.');
        rateLimit(`sounds-password:${req.ip}`, 20);
        if (!verifyPassword(password, link.password_hash)) throw new HttpError(401, 'Mot de passe incorrect.');
      }
    }
    return link;
  }
  const linkTracks = (link) => all(`SELECT t.*, v.id AS vid, v.filename, v.size, v.duration, v.peaks, v.note, v.created_at AS vat, v.track_id
    FROM sound_tracks t JOIN sound_versions v ON v.id = t.current_id
    WHERE ${link.track_id ? 't.id = ?' : 't.project_id = ?'} ORDER BY t.position, t.id`, link.track_id || link.project_id);

  app.post('/api/sounds/share/:token/save', ...me, (req, res) => {
    const link = openLink(req);
    if (link.user_id === req.user.id) throw new HttpError(400, "C'est ton propre projet : il est déjà dans Mes sons.");
    run('INSERT OR IGNORE INTO sound_saves (user_id, link_id, pass, created_at) VALUES (?, ?, ?, ?)',
      req.user.id, link.id, link.password_hash ? passFor(link) : null, now());
    res.status(201).json({ saved: true });
  });
  app.delete('/api/sounds/share/:token/save', ...me, (req, res) => {
    run('DELETE FROM sound_saves WHERE user_id = ? AND link_id = (SELECT id FROM sound_links WHERE token = ?)', req.user.id, str(req.params.token, 40));
    res.json({ saved: false });
  });

  app.post('/api/sounds/share/:token', (req, res) => {
    rateLimit(`sounds-share:${req.ip}`, 300);
    const link = openLink(req);
    const p = get('SELECT * FROM sound_projects WHERE id = ?', link.project_id
      || get('SELECT project_id FROM sound_tracks WHERE id = ?', link.track_id).project_id);
    const tracks = linkTracks(link);
    const comments = all(`SELECT * FROM sound_comments WHERE link_id = ? ORDER BY at`, link.id);
    res.set('Cache-Control', 'no-store');
    res.json({
      pass: link.password_hash ? passFor(link) : null,
      ...saveState(req, link),
      owner: p.artist || link.owner_name || 'ONIRIQUE', ownerAvatar: media(link.owner_avatar), title: link.track_id ? tracks[0]?.title : p.title, project: p.title, cover: media(p.cover), coverBy: p.cover_by, releaseDate: p.release_date,
      download: !!link.download,
      tracks: tracks.map((t) => ({
        id: t.id, title: t.title, stage: t.stage, credits: creditsOf(t),
        version: { id: t.vid, filename: t.filename, duration: t.duration, peaks: JSON.parse(t.peaks), url: audioUrl(t.vid), downloadUrl: link.download ? audioUrl(t.vid, true) : null },
        comments: comments.filter((c) => c.track_id === t.id).map(commentView),
      })),
    });
  });

  // Une écoute : comptée ; si l'auditeur est connecté, l'auteur est prévenu (une fois par jour, par titre et par auditeur).
  app.post('/api/sounds/share/:token/play', (req, res) => {
    rateLimit(`sounds-play:${req.ip}`, 200);
    const link = openLink(req);
    const t = linkTracks(link).find((row) => row.id === id(req.body.trackId));
    if (!t) throw new HttpError(404, 'Titre introuvable.');
    const listener = optionalUser(req);
    const listenerId = listener && listener.id !== link.user_id ? listener.id : null;
    const recent = listenerId && get('SELECT 1 FROM sound_plays WHERE link_id = ? AND track_id = ? AND user_id = ? AND created_at > ?',
      link.id, t.id, listenerId, now() - 86400_000);
    run('INSERT INTO sound_plays (link_id, track_id, user_id, created_at) VALUES (?, ?, ?, ?)', link.id, t.id, listenerId, now());
    if (listenerId && !recent) {
      sendMail(link.owner_email, `${listener.name || listener.email} écoute « ${t.title} » — ONIRIQUE`,
        `${listener.name || listener.email} vient d'écouter « ${t.title} »${link.label ? ` (lien « ${link.label} »)` : ''}.\n\n${config.siteUrl}/mes-sons\n\nONIRIQUE`,
        undefined, { buttonLabel: 'Ouvrir Mes sons', eyebrow: 'Mes sons' }).catch((error) => console.error('Avis d\'écoute :', error.message));
    }
    res.json({ ok: true });
  });

  app.post('/api/sounds/share/:token/comments', (req, res) => {
    rateLimit(`sounds-comment:${req.ip}`, 30);
    const link = openLink(req);
    const t = linkTracks(link).find((row) => row.id === id(req.body.trackId));
    if (!t) throw new HttpError(404, 'Titre introuvable.');
    const listener = optionalUser(req);
    const author = str(listener?.name, 60) || str(req.body.name, 60);
    const body = str(req.body.body, 1000);
    if (!author) throw new HttpError(400, 'Indique ton nom.');
    if (!body) throw new HttpError(400, 'Écris ton commentaire.');
    const at = Math.max(0, Math.min(Number(req.body.at) || 0, t.duration || 86400));
    const cid = run(`INSERT INTO sound_comments (track_id, version_id, link_id, user_id, author, at, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      t.id, t.vid, link.id, listener?.id ?? null, author, at, body, now()).lastInsertRowid;
    res.status(201).json(commentView(get('SELECT * FROM sound_comments WHERE id = ?', cid)));
  });

  // La page d'écoute, servie avec l'aperçu de son lien (nginx envoie /ecoute ici).
  app.get(['/ecoute', '/ecoute.html'], wrap(async (req, res) => {
    const token = String(req.query.t || '');
    const v = previewOf(token);
    // La couleur de l'aperçu Discord (theme-color) vient de la pochette ; calculée avec l'image, puis gardée.
    if (v && !v.locked && v.cover) {
      const file = path.join(config.mediaDir, path.basename(v.cover));
      if (fs.existsSync(file)) v.accent = await accentOf(file, (await import('sharp')).default);
    }
    const html = listeningHtml(v, token);
    if (!html) throw new HttpError(404, 'Page introuvable.');
    res.set('Cache-Control', 'no-cache').type('html').send(html);
  }));
  // L'image d'aperçu : fabriquée une fois par version (titre, pochette, date…), puis gardée.
  app.get('/api/sounds/share/:token/apercu.png', wrap(async (req, res) => {
    rateLimit(`sounds-apercu:${req.ip}`, 120);
    const v = previewOf(req.params.token);
    const dir = path.join(config.mediaDir, 'apercus-sons');
    const name = `${v ? v.link.id : 'x'}-${previewKey(v)}.png`;
    const target = path.join(dir, name);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(dir, { recursive: true });
      if (v) for (const old of fs.readdirSync(dir)) if (old.startsWith(`${v.link.id}-`)) fs.rmSync(path.join(dir, old), { force: true });
      fs.writeFileSync(target, (await previewImage(v)).png);
    }
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' }).sendFile(target);
  }));

  // Le fichier audio, par une adresse signée ; la lecture peut sauter n'importe où (Range, géré par sendFile).
  app.get('/api/sounds/audio/:id', (req, res) => {
    const e = Number(req.query.e), d = req.query.d === '1' ? 1 : 0, s = String(req.query.s || '');
    if (!(e > now()) || !same(s, sign(`${id(req.params.id)}.${e}.${d}`))) throw new HttpError(403, "Ce lien d'écoute a expiré : recharge la page.");
    const v = get('SELECT * FROM sound_versions WHERE id = ?', id(req.params.id));
    if (!v) throw new HttpError(404, 'Son introuvable.');
    res.set({ 'Content-Type': v.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    if (d) res.attachment(v.filename);
    res.sendFile(path.join(soundsDir, v.stored_as));
  });
}
