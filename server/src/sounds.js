// « ONIRIQUE CLOUD » : l'espace des membres ONIRIQUE (et des fondateurs) pour leur musique en cours, façon [untitled].
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
import { push, wants, prefsOf } from './push.js';
import { mailDraft, packMailHtml } from './packmail.js';
import { mountBeatStore, offersOf, filesOf, sellerView, licensesOf, licensePricesOf, payMethods } from './beatstore.js';
import { mountPackSend, recipientFor, trackRecipient, coverPalette } from './packsend.js';
import { writeZip, zipName, zipSize } from './zipstream.js';
import { mountBeatTube } from './beattube.js';

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
// Le suivi d'une écoute : l'auditeur (son compte, sinon un identifiant gardé par son navigateur), jusqu'où il est allé
// dans le titre et la durée du titre, en secondes.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_plays') WHERE name = 'listener'`).get()) {
  db.exec(`ALTER TABLE sound_plays ADD COLUMN listener TEXT NOT NULL DEFAULT '';
    ALTER TABLE sound_plays ADD COLUMN reached REAL NOT NULL DEFAULT 0;
    ALTER TABLE sound_plays ADD COLUMN length REAL NOT NULL DEFAULT 0;`);
}
// Un commentaire coché « Réglé » : un retour de mix traité (null : encore à régler).
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_comments') WHERE name = 'resolved_at'`).get()) {
  db.exec('ALTER TABLE sound_comments ADD COLUMN resolved_at INTEGER');
}
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
// La répartition d'un titre (split sheet) : chaque personne, son rôle, sa part du master et des éditions, en %.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_tracks') WHERE name = 'splits'`).get()) {
  db.exec(`ALTER TABLE sound_tracks ADD COLUMN splits TEXT NOT NULL DEFAULT '[]'`);
}
// Les paroles d'un titre, une ligne par ligne ; « [mm:ss.cc] » en tête d'une ligne la synchronise (format LRC).
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_tracks') WHERE name = 'lyrics'`).get()) {
  db.exec(`ALTER TABLE sound_tracks ADD COLUMN lyrics TEXT NOT NULL DEFAULT ''`);
}
// « À propos de l'artiste » : la fiche d'un membre (photo, texte, lien), affichée à côté de ses projets s'il le choisit.
db.exec(`CREATE TABLE IF NOT EXISTS sound_artists (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  photo TEXT, bio TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', visible INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
)`);
// La date de sortie d'un projet (AAAA-MM-JJ, '' : pas de date) : prévue si elle est à venir, passée sinon.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_projects') WHERE name = 'release_date'`).get()) {
  db.exec(`ALTER TABLE sound_projects ADD COLUMN release_date TEXT NOT NULL DEFAULT ''`);
}
// La préparation de la sortie d'un projet : ses tâches (nom, jour par rapport à la sortie, faite ou non) et le choix des
// rappels par e-mail ; « reminded » note les rappels envoyés pour la date en cours (« 2026-11-20:7,1 »).
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_projects') WHERE name = 'plan'`).get()) {
  db.exec(`ALTER TABLE sound_projects ADD COLUMN plan TEXT NOT NULL DEFAULT '';
    ALTER TABLE sound_projects ADD COLUMN reminded TEXT NOT NULL DEFAULT '';`);
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
// Un dossier peut être rangé dans un autre (null : à la racine de ONIRIQUE CLOUD).
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_folders') WHERE name = 'parent_id'`).get()) {
  db.exec('ALTER TABLE sound_folders ADD COLUMN parent_id INTEGER REFERENCES sound_folders(id) ON DELETE SET NULL');
}
// Les collaborateurs d'un projet (invités par un lien que l'auteur crée, coupe ou renouvelle) : ils écoutent, ajoutent
// des titres et des versions, modifient noms, étapes, crédits et notes, et le partagent par leurs propres liens d'écoute
// (qui ne s'ouvrent plus s'ils quittent le projet). Supprimer le projet et gérer ses collaborateurs restent à l'auteur ;
// ce qu'ils envoient compte dans son espace.
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
// Un collaborateur range lui aussi le projet dans ses propres dossiers (null : à la racine de sa page).
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_collabs') WHERE name = 'folder_id'`).get()) {
  db.exec('ALTER TABLE sound_collabs ADD COLUMN folder_id INTEGER REFERENCES sound_folders(id) ON DELETE SET NULL');
}
// Un projet que le membre peut ouvrir : le sien, ou un projet où il est collaborateur (p = sound_projects).
const ACCESS = '(p.user_id = ? OR p.id IN (SELECT project_id FROM sound_collabs WHERE user_id = ?))';
// Un lien d'écoute (l = sound_links) dont l'auteur a encore accès au projet : l'auteur du projet ou l'un de ses
// collaborateurs. Celui d'un collaborateur retiré (ou parti) ne s'ouvre plus.
const LINK_OPEN = `EXISTS (SELECT 1 FROM sound_projects lp WHERE lp.id = COALESCE(l.project_id, (SELECT project_id FROM sound_tracks WHERE id = l.track_id))
  AND (lp.user_id = l.user_id OR lp.id IN (SELECT project_id FROM sound_collabs WHERE user_id = l.user_id)))`;
// Le projet d'un lien et le nom de son auteur (affiché aux auditeurs quand le projet n'a pas de nom d'artiste).
const linkProject = (l) => get(`SELECT p.*, u.name AS author_name, u.avatar AS author_avatar, u.instagram AS author_instagram FROM sound_projects p JOIN users u ON u.id = p.user_id
  WHERE p.id = ?`, l.project_id || get('SELECT project_id FROM sound_tracks WHERE id = ?', l.track_id).project_id);
// La date d'un titre (création, enregistrement…), affichée en badge à côté de son étape ; '' : pas de date.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_tracks') WHERE name = 'day'`).get()) {
  db.exec(`ALTER TABLE sound_tracks ADD COLUMN day TEXT NOT NULL DEFAULT ''`);
}
// L'image de fond d'un projet (sa page et sa page d'écoute), choisie en mode édition.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_projects') WHERE name = 'background'`).get()) {
  db.exec('ALTER TABLE sound_projects ADD COLUMN background TEXT');
}
// Les packs de prods : un projet de beatmaker (kind = 'pack') et le brouillon de son mail ; chaque prod a son BPM, sa
// clé (« C# min »), son prix en centimes et le lien de paiement du beatmaker (0 / '' : pas en vente).
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_projects') WHERE name = 'kind'`).get()) {
  db.exec(`ALTER TABLE sound_projects ADD COLUMN kind TEXT NOT NULL DEFAULT ''`);
  db.exec(`ALTER TABLE sound_projects ADD COLUMN mail TEXT NOT NULL DEFAULT '{}'`);
  db.exec('ALTER TABLE sound_tracks ADD COLUMN bpm INTEGER NOT NULL DEFAULT 0');
  db.exec(`ALTER TABLE sound_tracks ADD COLUMN music_key TEXT NOT NULL DEFAULT ''`);
  db.exec('ALTER TABLE sound_tracks ADD COLUMN price INTEGER NOT NULL DEFAULT 0');
  db.exec(`ALTER TABLE sound_tracks ADD COLUMN buy_url TEXT NOT NULL DEFAULT ''`);
}
// La vente des prods, façon BeatStars : les licences de chaque beatmaker (MP3, WAV, Track Stems, Exclusive…), les
// fichiers livrés avec chaque prod, son compte de paiement (Stripe ou PayPal, clés chiffrées), les commandes, et ses
// listes d'adresses pour les mails (importées d'un CSV).
db.exec(`
CREATE TABLE IF NOT EXISTS sound_licenses (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  price      INTEGER NOT NULL,
  files      TEXT NOT NULL DEFAULT '[]',
  terms      TEXT NOT NULL DEFAULT '',
  exclusive  INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sound_deliverables (
  track_id   INTEGER NOT NULL REFERENCES sound_tracks(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  filename   TEXT NOT NULL,
  stored_as  TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (track_id, kind)
);
CREATE TABLE IF NOT EXISTS sound_sellers (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL DEFAULT '',
  client_id  TEXT NOT NULL DEFAULT '',
  secret     TEXT,
  sandbox    INTEGER NOT NULL DEFAULT 0,
  account    TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sound_orders (
  id           INTEGER PRIMARY KEY,
  token        TEXT NOT NULL UNIQUE,
  seller_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id     INTEGER REFERENCES sound_tracks(id) ON DELETE SET NULL,
  link_id      INTEGER REFERENCES sound_links(id) ON DELETE SET NULL,
  track_title  TEXT NOT NULL,
  artist       TEXT NOT NULL,
  license      TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'eur',
  provider     TEXT NOT NULL,
  sandbox      INTEGER NOT NULL DEFAULT 0,
  provider_ref TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending',
  buyer_email  TEXT NOT NULL DEFAULT '',
  buyer_name   TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  paid_at      INTEGER
);
CREATE INDEX IF NOT EXISTS sound_orders_by_seller ON sound_orders (seller_id, created_at);
CREATE TABLE IF NOT EXISTS sound_mail_lists (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  emails     TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
`);
// Une prod en vente (licences du beatmaker), et vendue en exclusivité : alors plus personne ne peut l'acheter.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_tracks') WHERE name = 'for_sale'`).get()) {
  db.exec('ALTER TABLE sound_tracks ADD COLUMN for_sale INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE sound_tracks ADD COLUMN sold INTEGER NOT NULL DEFAULT 0');
}
// Le prix de chaque licence pour une prod, quand il change de celui du beatmaker : { idLicence: centimes, 0 : pas proposée }.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_tracks') WHERE name = 'license_prices'`).get()) {
  db.exec(`ALTER TABLE sound_tracks ADD COLUMN license_prices TEXT NOT NULL DEFAULT '{}'`);
}
// Le modèle de contrat de licence du beatmaker (voir beatstore.js).
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_sellers') WHERE name = 'contract'`).get()) {
  db.exec(`ALTER TABLE sound_sellers ADD COLUMN contract TEXT NOT NULL DEFAULT '{}'`);
}
// Le webhook Stripe du beatmaker : seul lui confirme qu'une commande est payée.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_sellers') WHERE name = 'webhook_secret'`).get()) {
  db.exec('ALTER TABLE sound_sellers ADD COLUMN webhook_secret TEXT');
  db.exec(`ALTER TABLE sound_sellers ADD COLUMN webhook_id TEXT NOT NULL DEFAULT ''`);
}
// Une liste de contacts partagée par un fondateur avec tous les membres ONIRIQUE (par exemple « CSV ARTISTES BY ONIRIQUE »).
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_mail_lists') WHERE name = 'shared'`).get()) {
  db.exec('ALTER TABLE sound_mail_lists ADD COLUMN shared INTEGER NOT NULL DEFAULT 0');
}
// PayPal à côté de Stripe : un beatmaker peut brancher les deux, l'acheteur choisit. Un compte PayPal branché avant
// (dans les colonnes de Stripe) est déplacé dans les siennes.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_sellers') WHERE name = 'paypal_secret'`).get()) {
  db.exec(`ALTER TABLE sound_sellers ADD COLUMN paypal_client_id TEXT NOT NULL DEFAULT ''`);
  db.exec('ALTER TABLE sound_sellers ADD COLUMN paypal_secret TEXT');
  db.exec('ALTER TABLE sound_sellers ADD COLUMN paypal_sandbox INTEGER NOT NULL DEFAULT 0');
  db.exec(`UPDATE sound_sellers SET paypal_client_id = client_id, paypal_secret = secret, paypal_sandbox = sandbox,
    provider = '', client_id = '', secret = NULL, sandbox = 0, account = '' WHERE provider = 'paypal'`);
}
// Un compte Stripe branché par « Se connecter avec Stripe » (Stripe Connect, acct_…) : pas de clé du beatmaker, la
// plateforme parle en son nom (beatstore.js).
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_sellers') WHERE name = 'connect_account'`).get()) {
  db.exec(`ALTER TABLE sound_sellers ADD COLUMN connect_account TEXT NOT NULL DEFAULT ''`);
}
// Le compte relié par Connect au moment de l'achat : une commande se vérifie là où elle a été faite.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_orders') WHERE name = 'connect_account'`).get()) {
  db.exec(`ALTER TABLE sound_orders ADD COLUMN connect_account TEXT NOT NULL DEFAULT ''`);
}
/** « c#m », « Bb minor », « F majeur »… → « C# min », « Bb min », « F maj » ; null si ce n'est pas une tonalité. */
export function musicKey(value) {
  const m = /^([a-g])\s*(#|♯|b|♭)?\s*(m|min|minor|mineur|maj|major|majeur)?$/i.exec(String(value || '').trim());
  if (!m) return null;
  return m[1].toUpperCase() + (m[2] ? (/[#♯]/.test(m[2]) ? '#' : 'b') : '') + (/^(m|min)/i.test(m[3] || '') && !/^maj/i.test(m[3]) ? ' min' : ' maj');
}
/** Le titre d'une prod d'après son fichier, son BPM (« 140bpm ») et sa clé (« C#min », « Am ») s'ils y sont. */
export function prodFromFilename(name) {
  let title = String(name).replace(/\.[a-z0-9]{2,5}$/i, '');
  let bpm = 0, key = '';
  title = title.replace(/(\d{2,3})\s*bpm|bpm\s*(\d{2,3})/i, (all, a, b) => { const n = Number(a || b); if (n < 40 || n > 300) return all; bpm = n; return ' '; });
  const sep = '(^|[\\s_\\-.()\\[\\]])';
  title = title.replace(new RegExp(sep + '([a-g](?:#|♯|b|♭)?)\\s?(minor|min|major|maj|mineur|majeur|m)(?=$|[\\s_\\-.()\\[\\]])', 'i'), (all, before, note, mode) => {
    // « Am » seul n'est une clé qu'en majuscule et à côté d'un BPM (« I Am Legend » garde son titre).
    if (key || (mode.toLowerCase() === 'm' && (note[0] !== note[0].toUpperCase() || (!bpm && note.length === 1)))) return all;
    key = musicKey(note + mode); return before + ' ';
  });
  title = title.replace(/_+/g, ' ').replace(/\(\s*\)|\[\s*\]/g, ' ').replace(/(\s*[-–|·]\s*){2,}/g, ' - ')
    .replace(/^[\s\-–|·]+|[\s\-–|·]+$/g, '').replace(/\s+/g, ' ').trim();
  return { title: title || String(name).replace(/\.[a-z0-9]{2,5}$/i, ''), bpm, key };
}
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
// Les versions et les fichiers livrés avec les prods comptent dans l'espace du membre.
export const usedBy = (userId) => get(`SELECT COALESCE(SUM(v.size), 0) AS n FROM sound_versions v JOIN sound_tracks t ON t.id = v.track_id
  JOIN sound_projects p ON p.id = t.project_id WHERE p.user_id = ?`, userId).n + get(`SELECT COALESCE(SUM(d.size), 0) AS n FROM sound_deliverables d
  JOIN sound_tracks t ON t.id = d.track_id JOIN sound_projects p ON p.id = t.project_id WHERE p.user_id = ?`, userId).n;

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
// Un téléchargement depuis un lien d'écoute porte ce lien (l), pour prévenir celui qui l'a partagé, et le destinataire du
// mail qui l'a amené là (r), pour son suivi.
function audioUrl(versionId, download = false, linkId = 0, r = '') {
  const e = now() + 6 * 3600_000, d = download ? 1 : 0, l = download ? linkId : 0, rr = l ? r : '';
  return `/api/sounds/audio/${versionId}?e=${e}&d=${d}${l ? `&l=${l}` : ''}${rr ? `&r=${rr}` : ''}&s=${sign(`${versionId}.${e}.${d}${l ? `.${l}` : ''}${rr ? `.r${rr}` : ''}`)}`;
}
// Le laissez-passer d'un lien protégé, rendu une fois le mot de passe donné.
const passFor = (link) => sign(`link.${link.id}.${link.password_hash}`);

const versionView = (v, i, download) => ({
  id: v.id, n: i + 1, filename: v.filename, size: v.size, duration: v.duration, peaks: JSON.parse(v.peaks), note: v.note,
  createdAt: v.created_at, url: audioUrl(v.id), downloadUrl: download ? audioUrl(v.id, true) : null,
});
const commentView = (c) => ({ id: c.id, trackId: c.track_id, versionId: c.version_id, author: c.author, at: c.at, body: c.body, createdAt: c.created_at, resolved: !!c.resolved_at });
const media = (name) => (name ? `/api/media/${name}` : null);
// La fiche artiste d'un membre ; sans lien choisi, sa page de liens ONIRIQUE s'il en a une. Une fiche masquée n'est
// montrée qu'à son auteur (pour la modifier).
function aboutOf(userId, mine) {
  const a = get('SELECT * FROM sound_artists WHERE user_id = ?', userId);
  if (!a ? !mine : !a.visible && !mine) return null;
  const handle = get('SELECT handle FROM link_pages WHERE user_id = ?', userId)?.handle;
  return { photo: media(a?.photo), bio: a?.bio || '', link: a?.link || '', visible: a ? !!a.visible : false,
    linkPage: handle ? `${config.linksUrl}/${handle}` : null };
}
// Les fiches affichées des collaborateurs d'un projet, sous celle de l'auteur.
const aboutsOf = (people) => people.map((u) => { const a = aboutOf(u.id, false); return a && { ...a, name: u.name || 'ONIRIQUE' }; }).filter(Boolean);
// Ce que disent les écoutes d'un titre : auditeurs différents, part écoutée en moyenne, écoutes menées au bout et, pour
// chaque dixième du titre, la part des écoutes encore là. Les écoutes d'avant ce suivi ne comptent que dans le total.
function listenStats(rows) {
  const who = new Set(rows.map((r) => r.listener).filter(Boolean));
  const parts = rows.filter((r) => r.length > 0).map((r) => Math.min(1, r.reached / r.length));
  const share = (test) => (parts.length ? parts.filter(test).length / parts.length : null);
  return { listeners: who.size, followed: parts.length, average: parts.length ? parts.reduce((s, x) => s + x, 0) / parts.length : null,
    complete: share((x) => x >= 0.9), curve: parts.length ? Array.from({ length: 10 }, (_, i) => share((x) => x >= (i + 1) / 10 - 0.02)) : [] };
}
const planOf = (row) => { try { return row.plan ? JSON.parse(row.plan) : null; } catch { return null; } };
/** Le plan de sortie envoyé par le membre : 40 tâches au plus, chacune à un jour donné autour de la sortie. */
function planIn(body) {
  if (body === null) return '';
  if (!body || !Array.isArray(body.items) || body.items.length > 40) throw new HttpError(400, 'Préparation de la sortie : 40 tâches au plus.');
  const items = body.items.map((x) => ({ label: str(x?.label, 100), note: str(x?.note, 160), days: Math.max(-365, Math.min(365, Math.round(Number(x?.days) || 0))), done: !!x?.done }))
    .filter((x) => x.label);
  return JSON.stringify({ items, remind: body.remind !== false });
}
const splitsOf = (row) => { try { return JSON.parse(row.splits || '[]'); } catch { return []; } };
/** La répartition envoyée par le membre : 20 personnes au plus, des parts de 0 à 100 % qui ne dépassent pas 100 % en tout. */
function splitsIn(list) {
  if (!Array.isArray(list) || list.length > 20) throw new HttpError(400, 'Répartition : 20 personnes au plus.');
  const share = (value) => {
    const n = Math.round(Number(String(value ?? '').replace(',', '.') || 0) * 100) / 100;
    if (!(n >= 0 && n <= 100)) throw new HttpError(400, 'Répartition : une part va de 0 à 100 %.');
    return n;
  };
  const rows = list.map((r) => ({ name: str(r?.name, 80), role: str(r?.role, 60), master: share(r?.master), publishing: share(r?.publishing) })).filter((r) => r.name);
  for (const [k, label] of [['master', 'du master'], ['publishing', 'des éditions']]) {
    if (rows.reduce((sum, r) => sum + r[k], 0) > 100.001) throw new HttpError(400, `Répartition : les parts ${label} dépassent 100 %.`);
  }
  return rows;
}
const creditsOf = (row) => { try { return JSON.parse(row.credits || '{}'); } catch { return {}; } };
const person = (u) => ({ id: u.id, name: u.name || 'ONIRIQUE', avatar: media(u.avatar) });
const linkView = (l) => ({
  id: l.id, url: `${config.siteUrl}/ecoute?t=${l.token}`, projectId: l.project_id, trackId: l.track_id, label: l.label,
  password: !!l.password_hash, expiresAt: l.expires_at, download: !!l.download, requireAccount: !!l.require_account, createdAt: l.created_at,
});

// Tout un projet dans un .zip : chaque titre dans son dossier avec toutes ses versions et ses paroles, la pochette, et
// une fiche texte qui reprend les crédits, la répartition, les notes de version et les retours (en UTF-8 marqué, pour
// que les accents s'affichent dans tous les éditeurs).
function projectZip(p) {
  const folder = zipName(p.title), entries = [], pct = (n) => `${String(n).replace('.', ',')} %`;
  const info = [p.title.toUpperCase(), p.artist ? `Artiste : ${p.artist}` : '', p.release_date ? `Date de sortie : ${p.release_date.split('-').reverse().join('/')}` : '',
    p.cover_by ? `Pochette : ${p.cover_by}` : '', ''].filter((line, i) => line || i === 4);
  if (p.cover) {
    const file = path.join(config.mediaDir, path.basename(p.cover));
    if (fs.existsSync(file)) entries.push({ name: `${folder}/Pochette${path.extname(file)}`, path: file });
  }
  const labels = { feat: 'Feat.', beat: 'Beatmaker', mix: 'Ingé mix', master: 'Ingé master', rec: 'Ingé rec' };
  all('SELECT * FROM sound_tracks WHERE project_id = ? ORDER BY position, id', p.id).forEach((t, i) => {
    const dir = `${folder}/${String(i + 1).padStart(2, '0')} - ${zipName(t.title)}`, credits = creditsOf(t);
    const versions = all('SELECT * FROM sound_versions WHERE track_id = ? ORDER BY id', t.id);
    versions.forEach((v, n) => {
      const file = path.join(soundsDir, v.stored_as);
      if (fs.existsSync(file)) entries.push({ name: `${dir}/v${n + 1} - ${zipName(v.filename)}`, path: file });
    });
    if (t.lyrics) entries.push({ name: `${dir}/Paroles.txt`, data: Buffer.from('﻿' + t.lyrics.replace(/\n/g, '\r\n')) });
    const comments = all('SELECT * FROM sound_comments WHERE track_id = ? ORDER BY at', t.id);
    const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    info.push(`${i + 1}. ${t.title}${credits.feat ? ` (feat. ${credits.feat})` : ''}${t.stage ? ` · ${t.stage.toUpperCase()}` : ''}`,
      ...Object.entries(labels).filter(([k]) => k !== 'feat' && credits[k]).map(([k, label]) => `   ${label} : ${credits[k]}`),
      ...splitsOf(t).map((r) => `   Part de ${r.name}${r.role ? ` (${r.role})` : ''} : master ${pct(r.master)}, éditions ${pct(r.publishing)}`),
      ...versions.map((v, n) => `   v${n + 1}${v.id === t.current_id ? ' (en avant)' : ''} : ${v.filename}${v.note ? ` · ${v.note}` : ''}`),
      ...comments.map((c) => `   ${c.resolved_at ? '[réglé] ' : ''}${clock(c.at)} ${c.author} : ${c.body}`), '');
  });
  entries.unshift({ name: `${folder}/Infos du projet.txt`, data: Buffer.from('﻿' + info.join('\r\n')) });
  return entries;
}

function removeVersionFiles(rows) {
  for (const r of rows) fs.rmSync(path.join(soundsDir, r.stored_as), { force: true });
}
/** Les fichiers qui ne correspondent plus à aucune version (compte supprimé, envoi interrompu) sont effacés au démarrage. */
export function sweepSounds() {
  const kept = new Set(all('SELECT stored_as FROM sound_versions UNION SELECT stored_as FROM sound_deliverables').map((r) => r.stored_as));
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
  const l = get(`SELECT l.*, u.name AS owner_name, u.role AS owner_role FROM sound_links l JOIN users u ON u.id = l.user_id WHERE l.token = ? AND ${LINK_OPEN}`, String(token || '').slice(0, 40));
  if (!l || !rolesWith('sounds').includes(l.owner_role) || (l.expires_at && l.expires_at < now())) return null;
  if (l.password_hash || l.require_account) return { link: l, locked: true };
  const t = l.track_id ? get('SELECT * FROM sound_tracks WHERE id = ?', l.track_id) : null;
  const p = linkProject(l);
  const tracks = l.track_id ? [t] : all('SELECT * FROM sound_tracks WHERE project_id = ? ORDER BY position, id', p.id);
  const seconds = tracks.reduce((sum, x) => sum + (get('SELECT duration FROM sound_versions WHERE id = ?', x.current_id)?.duration || 0), 0);
  return { link: l, locked: false, owner: p.artist || p.author_name || 'ONIRIQUE', title: t ? t.title : p.title, project: p.title, cover: p.cover,
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
    : next(new HttpError(403, 'ONIRIQUE CLOUD est réservé aux membres ONIRIQUE.')));
  const me = [requireUser, member];

  const project = (req, pid) => {
    const row = get(`SELECT p.* FROM sound_projects p WHERE p.id = ? AND ${ACCESS}`, id(pid), req.user.id, req.user.id);
    if (!row) throw new HttpError(404, 'Projet introuvable.');
    return row;
  };
  // Ce que seul l'auteur fait : supprimer, ranger dans ses dossiers, gérer les collaborateurs.
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
    // VANISH : un fondateur voit les projets de tous les comptes, en lecture seule ; rien n'est compté ni signalé.
    const vanish = req.query.vanish === '1' && req.user.role === 'founder';
    const scope = vanish ? '1 = 1' : ACCESS, args = vanish ? [] : [u, u];
    const projects = all(`SELECT p.*, o.name AS owner_name, o.avatar AS owner_avatar FROM sound_projects p JOIN users o ON o.id = p.user_id
      WHERE ${scope} ORDER BY p.created_at DESC`, ...args);
    const collabFolders = new Map(all('SELECT project_id, folder_id FROM sound_collabs WHERE user_id = ?', u).map((c) => [c.project_id, c.folder_id]));
    const collabs = all(`SELECT c.project_id, u.id, u.name, u.avatar FROM sound_collabs c JOIN users u ON u.id = c.user_id
      JOIN sound_projects p ON p.id = c.project_id WHERE ${scope} ORDER BY c.created_at`, ...args);
    const tracks = all(`SELECT t.* FROM sound_tracks t JOIN sound_projects p ON p.id = t.project_id WHERE ${scope} ORDER BY t.position, t.id`, ...args);
    const versions = all(`SELECT v.* FROM sound_versions v JOIN sound_tracks t ON t.id = v.track_id JOIN sound_projects p ON p.id = t.project_id
      WHERE ${scope} ORDER BY v.id`, ...args);
    const comments = all(`SELECT c.* FROM sound_comments c JOIN sound_tracks t ON t.id = c.track_id JOIN sound_projects p ON p.id = t.project_id
      WHERE ${scope} ORDER BY c.at`, ...args);
    const links = all(`SELECT l.*, (SELECT COUNT(*) FROM sound_plays WHERE link_id = l.id) AS plays,
      (SELECT MAX(created_at) FROM sound_plays WHERE link_id = l.id) AS last_play FROM sound_links l WHERE l.user_id = ? ORDER BY l.created_at DESC`, req.user.id);
    // Les écoutes de chaque titre, tous liens confondus (ceux de l'auteur et des collaborateurs), et les auditeurs
    // connectés (le dernier venu d'abord).
    const plays = all(`SELECT s.track_id, s.link_id, s.created_at, s.listener, s.reached, s.length, u.id, u.name, u.avatar FROM sound_plays s
      JOIN sound_tracks t ON t.id = s.track_id JOIN sound_projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = s.user_id WHERE ${scope} ORDER BY s.created_at DESC`, ...args);
    const listeners = (rows) => [...new Map(rows.filter((r) => r.id).map((r) => [r.id, { ...person(r), at: r.created_at }])).values()];
    const d = disk();
    res.json({
      owner: person(req.user), founder: req.user.role === 'founder', vanish,
      // Le compte de paiement et les licences, pour les badges de vente des packs.
      store: projects.some((p) => p.kind === 'pack' && p.user_id === u) ? { seller: sellerView(u), licenses: licensesOf(u) } : null,
      quota: { used: usedBy(req.user.id), limit: quotaBytes(), full: d.used / d.total >= diskMax() },
      projects: projects.map((p) => ({
        id: p.id, kind: p.kind, title: p.title, artist: p.artist, cover: media(p.cover), background: media(p.background), coverBy: p.cover_by, releaseDate: p.release_date, plan: planOf(p), createdAt: p.created_at,
        // Chacun range le projet dans ses dossiers : l'auteur dans le projet, un collaborateur dans sa place de collaborateur.
        mine: p.user_id === u, folderId: vanish ? null : p.user_id === u ? p.folder_id : collabFolders.get(p.id) ?? null,
        owner: person({ id: p.user_id, name: p.owner_name, avatar: p.owner_avatar }),
        collaborators: collabs.filter((c) => c.project_id === p.id).map(person),
        inviteUrl: p.user_id === u && p.invite_token ? `${config.siteUrl}/mes-sons#/invite/${p.invite_token}` : null,
        about: aboutOf(p.user_id, p.user_id === u), collabAbouts: aboutsOf(collabs.filter((c) => c.project_id === p.id)),
        // Le mail d'un pack (sa liste d'adresses comprise) ne se montre qu'à son auteur.
        mail: p.kind === 'pack' && p.user_id === u ? mailDraft(JSON.parse(p.mail || '{}')) : null,
        tracks: tracks.filter((t) => t.project_id === p.id).map((t) => {
          const mine = plays.filter((r) => r.track_id === t.id);
          return {
            id: t.id, title: t.title, stage: t.stage, day: t.day, credits: creditsOf(t), splits: splitsOf(t), lyrics: t.lyrics, currentId: t.current_id, createdAt: t.created_at,
            bpm: t.bpm, key: t.music_key, forSale: !!t.for_sale, sold: !!t.sold, ...(p.kind === 'pack' ? { files: filesOf(t.id), licensePrices: JSON.parse(t.license_prices || '{}') } : {}),
            versions: versions.filter((v) => v.track_id === t.id).map((v, i) => versionView(v, i, true)),
            comments: comments.filter((c) => c.track_id === t.id).map(commentView),
            plays: mine.length, lastPlay: mine[0]?.created_at ?? null, listeners: listeners(mine), stats: listenStats(mine),
          };
        }),
      })),
      links: links.map((l) => {
        const mine = plays.filter((r) => r.link_id === l.id);
        return { ...linkView(l), plays: l.plays, lastPlay: l.last_play, listeners: listeners(mine) };
      }),
      folders: all('SELECT id, title, parent_id, created_at FROM sound_folders WHERE user_id = ? ORDER BY created_at DESC', req.user.id)
        .map((f) => ({ id: f.id, title: f.title, parentId: f.parent_id, createdAt: f.created_at })),
      // Les projets des autres, enregistrés : encore ouverts si le lien vit et que son auteur est toujours membre.
      saved: all(`SELECT s.id, s.folder_id, s.pass, s.created_at, l.id AS link_id, l.token, l.track_id, l.expires_at, l.password_hash,
          a.name AS owner_name, a.avatar AS owner_avatar, u.role AS owner_role, p.title AS project_title, p.cover, p.artist, t.title AS track_title,
          (SELECT COUNT(*) FROM sound_tracks WHERE project_id = p.id) AS tracks, ${LINK_OPEN} AS open
        FROM sound_saves s JOIN sound_links l ON l.id = s.link_id JOIN users u ON u.id = l.user_id
        LEFT JOIN sound_tracks t ON t.id = l.track_id JOIN sound_projects p ON p.id = COALESCE(l.project_id, t.project_id) JOIN users a ON a.id = p.user_id
        WHERE s.user_id = ? ORDER BY s.created_at DESC`, req.user.id).map((r) => ({
        id: r.id, token: r.token, folderId: r.folder_id, title: r.track_id ? r.track_title : r.project_title, owner: r.artist || r.owner_name || 'ONIRIQUE',
        ownerAvatar: media(r.owner_avatar), cover: media(r.cover), tracks: r.track_id ? 1 : r.tracks, createdAt: r.created_at,
        available: !!r.open && rolesWith('sounds').includes(r.owner_role) && !(r.expires_at && r.expires_at < now()),
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
  // Les dossiers au-dessus d'un dossier, du parent à la racine.
  const ancestors = (fid) => {
    const up = [];
    for (let at = get('SELECT parent_id FROM sound_folders WHERE id = ?', fid)?.parent_id; at && up.length < 50; at = get('SELECT parent_id FROM sound_folders WHERE id = ?', at)?.parent_id) up.push(at);
    return up;
  };
  const MAX_DEPTH = 8;
  // Le dossier où en ranger un autre : jamais lui-même ni l'un de ses sous-dossiers, et pas plus de MAX_DEPTH niveaux.
  const parentFor = (req, fid, value) => {
    const parent = folderOf(req, value);
    if (parent === null) return null;
    if (fid && (parent === fid || ancestors(parent).includes(fid))) throw new HttpError(400, 'Un dossier ne peut pas aller dans lui-même ni dans un de ses sous-dossiers.');
    const below = (id) => Math.max(0, ...all('SELECT id FROM sound_folders WHERE parent_id = ?', id).map((c) => 1 + below(c.id)));
    if (ancestors(parent).length + 2 + (fid ? below(fid) : 0) > MAX_DEPTH) throw new HttpError(400, `Pas plus de ${MAX_DEPTH} niveaux de dossiers.`);
    return parent;
  };
  app.post('/api/me/sounds/folders', ...me, (req, res) => {
    rateLimit(`sounds:${req.user.id}`, 300);
    const title = str(req.body.title, 80);
    if (!title) throw new HttpError(400, 'Donne un nom au dossier.');
    const parent = parentFor(req, null, req.body.parentId);
    res.status(201).json({ id: run('INSERT INTO sound_folders (user_id, title, parent_id, created_at) VALUES (?, ?, ?, ?)', req.user.id, title, parent, now()).lastInsertRowid });
  });
  // Renommer un dossier, ou le ranger dans un autre (parentId null : à la racine).
  app.patch('/api/me/sounds/folders/:id', ...me, (req, res) => {
    const fid = folderOf(req, req.params.id);
    if (req.body.title !== undefined) {
      const title = str(req.body.title, 80);
      if (!title) throw new HttpError(400, 'Donne un nom au dossier.');
      run('UPDATE sound_folders SET title = ? WHERE id = ?', title, fid);
    }
    if (req.body.parentId !== undefined) run('UPDATE sound_folders SET parent_id = ? WHERE id = ?', parentFor(req, fid, req.body.parentId), fid);
    res.json({ ok: true });
  });
  // Supprimer un dossier : ce qu'il contient (projets, projets enregistrés, sous-dossiers) remonte d'un niveau, rien n'est effacé.
  app.delete('/api/me/sounds/folders/:id', ...me, (req, res) => {
    const fid = folderOf(req, req.params.id);
    const parent = get('SELECT parent_id FROM sound_folders WHERE id = ?', fid).parent_id;
    transaction(() => {
      run('UPDATE sound_folders SET parent_id = ? WHERE parent_id = ?', parent, fid);
      run('UPDATE sound_projects SET folder_id = ? WHERE folder_id = ?', parent, fid);
      run('UPDATE sound_collabs SET folder_id = ? WHERE folder_id = ?', parent, fid);
      run('UPDATE sound_saves SET folder_id = ? WHERE folder_id = ?', parent, fid);
      run('DELETE FROM sound_folders WHERE id = ?', fid);
    });
    res.json({ ok: true, parentId: parent });
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
    const kind = req.body.kind === 'pack' ? 'pack' : '';
    res.status(201).json({ id: run('INSERT INTO sound_projects (user_id, title, kind, created_at) VALUES (?, ?, ?, ?)', req.user.id, title, kind, now()).lastInsertRowid });
  });
  app.patch('/api/me/sounds/projects/:id', ...me, (req, res) => {
    const p = project(req, req.params.id);
    if (req.body.title !== undefined) {
      const title = str(req.body.title, 120);
      if (!title) throw new HttpError(400, 'Donne un nom au projet.');
      run('UPDATE sound_projects SET title = ? WHERE id = ?', title, p.id);
    }
    // Un projet devient un pack de prods (ou redevient un projet) : son BPM et sa clé, quand il en manque, sont lus dans le
    // nom du fichier de chaque son ; la page détecte ensuite sur le son ceux que le nom ne donne pas.
    if (req.body.kind !== undefined) {
      const kind = req.body.kind === 'pack' ? 'pack' : '';
      run('UPDATE sound_projects SET kind = ? WHERE id = ?', kind, ownProject(req, p.id).id);
      if (kind === 'pack') {
        for (const t of all('SELECT t.id, t.title, t.bpm, t.music_key, v.filename FROM sound_tracks t JOIN sound_versions v ON v.id = t.current_id WHERE t.project_id = ?', p.id)) {
          const prod = prodFromFilename(t.filename);
          // Un titre jamais renommé (le nom du fichier) perd son BPM et sa clé, affichés à côté, comme à l'envoi dans un pack.
          const title = t.title === t.filename.replace(/\.[a-z0-9]{2,5}$/i, '') ? prod.title || t.title : t.title;
          run('UPDATE sound_tracks SET title = ?, bpm = ?, music_key = ? WHERE id = ?', title, t.bpm || prod.bpm, t.music_key || prod.key, t.id);
        }
      }
    }
    if (req.body.mail !== undefined) {
      if (ownProject(req, p.id).kind !== 'pack') throw new HttpError(400, "Seul un pack de prods a un mail.");
      run('UPDATE sound_projects SET mail = ? WHERE id = ?', JSON.stringify(mailDraft(req.body.mail)), p.id);
    }
    if (req.body.coverBy !== undefined) run('UPDATE sound_projects SET cover_by = ? WHERE id = ?', str(req.body.coverBy, 80), p.id);
    if (req.body.artist !== undefined) run('UPDATE sound_projects SET artist = ? WHERE id = ?', str(req.body.artist, 120), p.id);
    if (req.body.folderId !== undefined) {
      const fid = folderOf(req, req.body.folderId);
      if (p.user_id === req.user.id) run('UPDATE sound_projects SET folder_id = ? WHERE id = ?', fid, p.id);
      else run('UPDATE sound_collabs SET folder_id = ? WHERE project_id = ? AND user_id = ?', fid, p.id, req.user.id);
    }
    if (req.body.plan !== undefined) run('UPDATE sound_projects SET plan = ? WHERE id = ?', planIn(req.body.plan), p.id);
    if (req.body.releaseDate !== undefined) {
      const day = String(req.body.releaseDate || '');
      if (day && !isDay(day)) throw new HttpError(400, 'Date de sortie invalide.');
      run('UPDATE sound_projects SET release_date = ? WHERE id = ?', day, p.id);
      if (day !== p.release_date) run(`UPDATE sound_projects SET reminded = '' WHERE id = ?`, p.id);
    }
    // L'ordre des titres : la liste de leurs identifiants, seulement ceux de ce projet.
    if (Array.isArray(req.body.order)) transaction(() => req.body.order.forEach((tid, i) =>
      run('UPDATE sound_tracks SET position = ? WHERE id = ? AND project_id = ?', i, id(tid), p.id)));
    res.json({ ok: true });
  });
  // L'aperçu du mail d'un pack, tel qu'il est en train d'être rempli (rien n'est enregistré ni envoyé).
  app.post('/api/me/sounds/projects/:id/mail/preview', ...me, wrap(async (req, res) => {
    const p = ownProject(req, req.params.id);
    rateLimit(`sounds-mail:${req.user.id}`, 600);
    const tracks = all('SELECT * FROM sound_tracks WHERE project_id = ? ORDER BY position, id', p.id);
    const link = get('SELECT token FROM sound_links WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC', p.id, req.user.id);
    const draft = mailDraft(req.body), palette = draft.coverColors ? await coverPalette(p.cover) : null;
    res.json({ palette, html: packMailHtml(palette ? { ...draft, colors: palette } : draft, {
      // Sans lien encore créé (il l'est à l'envoi), l'aperçu montre quand même les boutons « Écouter ».
      title: p.title, artist: p.artist || req.user.name || 'ONIRIQUE', cover: media(p.cover), listenUrl: link ? `${config.siteUrl}/ecoute?t=${link.token}` : `${config.siteUrl}/ecoute`,
      tracks: tracks.map((t) => ({ id: t.id, title: t.title, bpm: t.bpm, key: t.music_key })),
    }) });
  }));
  app.delete('/api/me/sounds/projects/:id', ...me, (req, res) => {
    const p = ownProject(req, req.params.id);
    const files = all(`SELECT v.stored_as FROM sound_versions v JOIN sound_tracks t ON t.id = v.track_id WHERE t.project_id = ?
      UNION ALL SELECT d.stored_as FROM sound_deliverables d JOIN sound_tracks t ON t.id = d.track_id WHERE t.project_id = ?`, p.id, p.id);
    run('DELETE FROM sound_projects WHERE id = ?', p.id);
    removeVersionFiles(files);
    if (p.cover) removeMedia(p.cover);
    if (p.background) removeMedia(p.background);
    res.json({ ok: true });
  });
  // Le fond de la page du projet : une image (8 Mo au plus) ; DELETE le retire.
  app.put('/api/me/sounds/projects/:id/background', ...me, wrap(async (req, res) => {
    const p = project(req, req.params.id);
    rateLimit(`sounds-cover:${req.user.id}`, 30);
    const name = await receiveImage(req, 8 * 1024 * 1024);
    run('UPDATE sound_projects SET background = ? WHERE id = ?', name, p.id);
    if (p.background) removeMedia(p.background);
    res.json({ background: media(name) });
  }));
  app.delete('/api/me/sounds/projects/:id/background', ...me, (req, res) => {
    const p = project(req, req.params.id);
    run('UPDATE sound_projects SET background = NULL WHERE id = ?', p.id);
    if (p.background) removeMedia(p.background);
    res.json({ ok: true });
  });
  // La fiche « À propos de l'artiste » du membre : texte, lien (http ou https) et affichage ; la photo à part.
  const ensureAbout = (userId) => run('INSERT OR IGNORE INTO sound_artists (user_id, updated_at) VALUES (?, ?)', userId, now());
  app.patch('/api/me/sounds/about', ...me, (req, res) => {
    ensureAbout(req.user.id);
    const b = req.body || {};
    if (typeof b.bio === 'string') {
      const bio = b.bio.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[^\S\n]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);
      run('UPDATE sound_artists SET bio = ? WHERE user_id = ?', bio, req.user.id);
    }
    if (typeof b.link === 'string') {
      let link = b.link.trim().slice(0, 300);
      if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
      if (link) { try { new URL(link); } catch { throw new HttpError(400, 'Lien invalide.'); } }
      run('UPDATE sound_artists SET link = ? WHERE user_id = ?', link, req.user.id);
    }
    if (b.visible !== undefined) run('UPDATE sound_artists SET visible = ? WHERE user_id = ?', b.visible ? 1 : 0, req.user.id);
    run('UPDATE sound_artists SET updated_at = ? WHERE user_id = ?', now(), req.user.id);
    res.json(aboutOf(req.user.id, true));
  });
  app.put('/api/me/sounds/about/photo', ...me, wrap(async (req, res) => {
    rateLimit(`sounds-cover:${req.user.id}`, 30);
    const name = await receiveImage(req, 5 * 1024 * 1024);
    ensureAbout(req.user.id);
    const before = get('SELECT photo FROM sound_artists WHERE user_id = ?', req.user.id).photo;
    run('UPDATE sound_artists SET photo = ?, updated_at = ? WHERE user_id = ?', name, now(), req.user.id);
    if (before) removeMedia(before);
    res.json({ photo: media(name) });
  }));
  app.delete('/api/me/sounds/about/photo', ...me, (req, res) => {
    const before = get('SELECT photo FROM sound_artists WHERE user_id = ?', req.user.id)?.photo;
    run('UPDATE sound_artists SET photo = NULL WHERE user_id = ?', req.user.id);
    if (before) removeMedia(before);
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
    // Dans un pack, le BPM et la clé écrits dans le nom du fichier deviennent ceux de la prod.
    const prod = p.kind === 'pack' ? prodFromFilename(file.filename) : { title: file.filename.replace(/\.[a-z0-9]{2,5}$/i, ''), bpm: 0, key: '' };
    const title = str(req.query.title, 120) || str(prod.title, 120);
    const trackId = transaction(() => {
      const position = get('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM sound_tracks WHERE project_id = ?', p.id).n;
      const tid = run('INSERT INTO sound_tracks (project_id, title, position, bpm, music_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        p.id, title, position, prod.bpm, prod.key || '', now()).lastInsertRowid;
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
    if (req.body.splits !== undefined) run('UPDATE sound_tracks SET splits = ? WHERE id = ?', JSON.stringify(splitsIn(req.body.splits)), t.id);
    if (typeof req.body.lyrics === 'string') {
      const lyrics = req.body.lyrics.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/\s+/g, ' ').trim().slice(0, 300)).join('\n').trim().slice(0, 20000);
      run('UPDATE sound_tracks SET lyrics = ? WHERE id = ?', lyrics, t.id);
    }
    if (req.body.day !== undefined) {
      const day = String(req.body.day || '');
      if (day && !isDay(day)) throw new HttpError(400, 'Date invalide.');
      run('UPDATE sound_tracks SET day = ? WHERE id = ?', day, t.id);
    }
    // La prod d'un pack : BPM (0 : aucun), clé ('' : aucune), mise en vente selon les licences du beatmaker.
    if (req.body.bpm !== undefined) {
      const bpm = Math.round(Number(req.body.bpm) || 0);
      if (bpm && (bpm < 40 || bpm > 300)) throw new HttpError(400, 'Le BPM va de 40 à 300.');
      run('UPDATE sound_tracks SET bpm = ? WHERE id = ?', bpm, t.id);
    }
    if (req.body.key !== undefined) {
      const key = req.body.key ? musicKey(req.body.key) : '';
      if (key === null) throw new HttpError(400, 'Clé inconnue : écris par exemple « C# min » ou « F maj ».');
      run('UPDATE sound_tracks SET music_key = ? WHERE id = ?', key, t.id);
    }
    if (req.body.forSale !== undefined) run('UPDATE sound_tracks SET for_sale = ? WHERE id = ? AND sold = 0', req.body.forSale ? 1 : 0, t.id);
    if (req.body.licensePrices !== undefined) run('UPDATE sound_tracks SET license_prices = ? WHERE id = ?', licensePricesOf(req.body.licensePrices, t.owner_id), t.id);
    if (req.body.stage !== undefined) {
      // Maquette, V1 à V99, final, ou un texte libre du membre.
      const raw = String(req.body.stage).replace(/\s+/g, ' ').trim();
      if (raw.length > 40) throw new HttpError(400, 'Étape trop longue : 40 caractères au plus.');
      const stage = STAGE.test(raw.toLowerCase()) ? raw.toLowerCase() : raw;
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
      const created = run('INSERT INTO sound_tracks (project_id, title, position, bpm, music_key, price, buy_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        t.project_id, str(`${t.title} (copie)`, 120), t.position + 1, t.bpm, t.music_key, t.price, t.buy_url, now()).lastInsertRowid;
      const vid = run(`INSERT INTO sound_versions (track_id, filename, stored_as, mime, size, duration, peaks, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        created, v.filename, storedAs, v.mime, v.size, v.duration, v.peaks, v.note, now()).lastInsertRowid;
      run('UPDATE sound_tracks SET current_id = ? WHERE id = ?', vid, created);
      return created;
    });
    res.status(201).json({ id: tid });
  });
  app.delete('/api/me/sounds/tracks/:id', ...me, (req, res) => {
    const t = track(req, req.params.id);
    const files = all('SELECT stored_as FROM sound_versions WHERE track_id = ? UNION ALL SELECT stored_as FROM sound_deliverables WHERE track_id = ?', t.id, t.id);
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

  // Les liens d'écoute : un projet entier ou un seul titre, créés par l'auteur ou par un collaborateur (chacun gère les siens).
  app.post('/api/me/sounds/links', ...me, (req, res) => {
    rateLimit(`sounds:${req.user.id}`, 300);
    const projectId = req.body.projectId ? project(req, req.body.projectId).id : null;
    const trackId = !projectId && req.body.trackId ? track(req, req.body.trackId).id : null;
    if (!projectId && !trackId) throw new HttpError(400, 'Choisis un projet ou un titre à partager.');
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (password && password.length < 4) throw new HttpError(400, 'Mot de passe : 4 caractères au moins.');
    const expiresAt = req.body.expiresAt ? Number(req.body.expiresAt) : null;
    if (expiresAt !== null && !(expiresAt > now())) throw new HttpError(400, 'La date de fin doit être dans le futur.');
    const token = crypto.randomBytes(12).toString('base64url');
    const defaults = prefsOf(req.user.id).links;
    const lid = run(`INSERT INTO sound_links (token, user_id, project_id, track_id, label, password_hash, expires_at, download, require_account, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, token, req.user.id, projectId, trackId, str(req.body.label, 80), password ? hashPassword(password) : null,
    expiresAt, (req.body.download ?? defaults.download) ? 1 : 0, (req.body.requireAccount ?? defaults.requireAccount) ? 1 : 0, now()).lastInsertRowid;
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

  // « Réglé » : l'auteur ou un collaborateur coche un retour traité, ou le remet à régler.
  app.patch('/api/me/sounds/comments/:id', ...me, (req, res) => {
    const c = get(`SELECT c.id FROM sound_comments c JOIN sound_tracks t ON t.id = c.track_id JOIN sound_projects p ON p.id = t.project_id
      WHERE c.id = ? AND ${ACCESS}`, id(req.params.id), req.user.id, req.user.id);
    if (!c) throw new HttpError(404, 'Commentaire introuvable.');
    run('UPDATE sound_comments SET resolved_at = ? WHERE id = ?', req.body.resolved ? now() : null, c.id);
    res.json(commentView(get('SELECT * FROM sound_comments WHERE id = ?', c.id)));
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
  /** Un membre connecté qui n'est pas l'auteur peut enregistrer le projet dans « ONIRIQUE CLOUD ». */
  function saveState(req, link) {
    const viewer = optionalUser(req);
    const p = linkProject(link);
    const canSave = !!viewer && rolesWith('sounds').includes(viewer.role) && viewer.id !== link.user_id && viewer.id !== p.user_id
      && !get('SELECT 1 FROM sound_collabs WHERE project_id = ? AND user_id = ?', p.id, viewer.id);
    return { canSave, saved: canSave && !!get('SELECT 1 FROM sound_saves WHERE user_id = ? AND link_id = ?', viewer.id, link.id) };
  }

  function openLink(req) {
    const link = get(`SELECT l.*, u.name AS owner_name, u.email AS owner_email, u.avatar AS owner_avatar FROM sound_links l JOIN users u ON u.id = l.user_id
      WHERE l.token = ? AND ${LINK_OPEN} AND u.role IN (${rolesWith('sounds').map(() => '?').join(', ')})`, str(req.params.token, 40), ...rolesWith('sounds'));
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

  // Prévient celui qui a partagé le lien, sur ses appareils et par e-mail, selon ses réglages. Un même geste d'une même
  // personne ne prévient qu'une fois par jour ; l'e-mail attend de savoir qui c'est (compte ou nom donné).
  const told = new Map();
  function tell(link, event, { who, title, key }) {
    const k = `${event}:${link.id}:${key}`;
    if (told.get(k) > now()) return;
    if (told.size > 20000) told.clear();
    told.set(k, now() + 86400_000);
    const where = link.label ? ` (lien « ${link.label} »)` : '';
    const text = {
      play: `${who || "Quelqu'un"} écoute « ${title} »`,
      download: `${who || "Quelqu'un"} a téléchargé « ${title} »`,
      comment: `${who} a commenté « ${title} »`,
      save: `${who} a ajouté « ${title} » à son ONIRIQUE CLOUD`,
    }[event];
    if (wants(link.user_id, event, 'push')) push(link.user_id, { title: 'ONIRIQUE CLOUD', body: text + where, url: '/mes-sons' });
    if (who && wants(link.user_id, event, 'mail')) {
      sendMail(link.owner_email, `${text} — ONIRIQUE`, `${text}${where}.\n\n${config.siteUrl}/mes-sons\n\nONIRIQUE`,
        undefined, { buttonLabel: 'Ouvrir ONIRIQUE CLOUD', eyebrow: 'ONIRIQUE CLOUD' }).catch((error) => console.error('Avis ONIRIQUE CLOUD :', error.message));
    }
  }
  const nameOf = (user) => (user ? user.name || user.email : null);
  // Le destinataire d'un mail de pack venu par son lien (r) : son nom, sinon son adresse.
  const contactOf = (link, req) => recipientFor(link.user_id, req.body?.r || req.query?.r);
  const contactName = (r) => (r ? r.name || r.email : null);
  const linkTitle = (link) => (link.track_id ? get('SELECT title FROM sound_tracks WHERE id = ?', link.track_id)?.title
    : get('SELECT title FROM sound_projects WHERE id = ?', link.project_id)?.title) || '';

  app.post('/api/sounds/share/:token/save', ...me, (req, res) => {
    const link = openLink(req);
    if (!saveState(req, link).canSave) throw new HttpError(400, "Ce projet est déjà dans ONIRIQUE CLOUD : c'est le tien, ou tu y collabores.");
    run('INSERT OR IGNORE INTO sound_saves (user_id, link_id, pass, created_at) VALUES (?, ?, ?, ?)',
      req.user.id, link.id, link.password_hash ? passFor(link) : null, now());
    tell(link, 'save', { who: nameOf(req.user), title: linkTitle(link), key: req.user.id });
    res.status(201).json({ saved: true });
  });
  app.delete('/api/sounds/share/:token/save', ...me, (req, res) => {
    run('DELETE FROM sound_saves WHERE user_id = ? AND link_id = (SELECT id FROM sound_links WHERE token = ?)', req.user.id, str(req.params.token, 40));
    res.json({ saved: false });
  });

  app.post('/api/sounds/share/:token', (req, res) => {
    rateLimit(`sounds-share:${req.ip}`, 300);
    const link = openLink(req);
    const p = linkProject(link);
    const tracks = linkTracks(link);
    const comments = all(`SELECT * FROM sound_comments WHERE link_id = ? ORDER BY at`, link.id);
    // Un fondateur peut simuler l'achat d'une prod en vente, même sans compte de paiement branché, pour voir les licences.
    const simulate = p.kind === 'pack' && optionalUser(req)?.role === 'founder';
    // Les prods d'un pack se téléchargent toujours ; le destinataire d'un mail est suivi jusqu'au téléchargement.
    const download = !!link.download || p.kind === 'pack', contact = contactOf(link, req);
    trackRecipient(contact, 'visit');
    res.set('Cache-Control', 'no-store');
    res.json({
      pass: link.password_hash ? passFor(link) : null,
      ...saveState(req, link), simulate, pay: p.kind === 'pack' ? payMethods(p.user_id) : [],
      owner: p.artist || p.author_name || 'ONIRIQUE', ownerAvatar: media(p.author_avatar), title: link.track_id ? tracks[0]?.title : p.title, project: p.title, cover: media(p.cover), background: media(p.background), coverBy: p.cover_by, releaseDate: p.release_date,
      download, about: aboutOf(p.user_id, false), contact: p.kind === 'pack' ? p.author_instagram || null : null,
      collabAbouts: aboutsOf(all('SELECT u.id, u.name FROM sound_collabs c JOIN users u ON u.id = c.user_id WHERE c.project_id = ? ORDER BY c.created_at', p.id)),
      tracks: tracks.map((t) => ({
        id: t.id, title: t.title, stage: t.stage, day: t.day, credits: creditsOf(t), lyrics: t.lyrics, bpm: t.bpm, key: t.music_key,
        offers: p.kind === 'pack' ? offersOf(t, p.user_id, simulate) : [], sold: !!t.sold,
        version: { id: t.vid, filename: t.filename, duration: t.duration, peaks: JSON.parse(t.peaks), url: audioUrl(t.vid), downloadUrl: download ? audioUrl(t.vid, true, link.id, contact?.token) : null },
        comments: comments.filter((c) => c.track_id === t.id).map(commentView),
      })),
    });
  });

  // Une écoute : comptée, et l'auteur prévenu (une fois par jour, par titre et par auditeur).
  app.post('/api/sounds/share/:token/play', (req, res) => {
    rateLimit(`sounds-play:${req.ip}`, 200);
    const link = openLink(req);
    const t = linkTracks(link).find((row) => row.id === id(req.body.trackId));
    if (!t) throw new HttpError(404, 'Titre introuvable.');
    const listener = optionalUser(req);
    const listenerId = listener && listener.id !== link.user_id ? listener.id : null;
    // L'auditeur : son compte s'il est connecté, sinon l'identifiant que son navigateur garde (pour compter les personnes).
    const who = listener ? `u${listener.id}` : str(req.body.listener, 40).replace(/[^\w-]/g, '');
    const play = run('INSERT INTO sound_plays (link_id, track_id, user_id, listener, created_at) VALUES (?, ?, ?, ?, ?)', link.id, t.id, listenerId, who, now()).lastInsertRowid;
    const contact = contactOf(link, req);
    trackRecipient(contact, 'play', t.title);
    if (listener?.id !== link.user_id) tell(link, 'play', { who: contactName(contact) || nameOf(listener), title: t.title, key: `${t.id}:${listenerId || contact?.id || req.ip}` });
    res.json({ ok: true, play });
  });
  // Jusqu'où l'écoute est allée : envoyé pendant la lecture, seul le point le plus loin est gardé.
  app.post('/api/sounds/share/:token/progress', (req, res) => {
    rateLimit(`sounds-progress:${req.ip}`, 600);
    const link = openLink(req);
    const reached = Number(req.body.reached), length = Number(req.body.length);
    if (!(reached >= 0 && length > 0 && length < 86400)) throw new HttpError(400, 'Écoute invalide.');
    run('UPDATE sound_plays SET reached = MAX(reached, ?), length = ? WHERE rowid = ? AND link_id = ?', Math.min(reached, length), length, id(req.body.play), link.id);
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
    if (listener?.id !== link.user_id) tell(link, 'comment', { who: author, title: t.title, key: `c${cid}` });
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
    const e = Number(req.query.e), d = req.query.d === '1' ? 1 : 0, l = d ? id(req.query.l) : 0, s = String(req.query.s || '');
    const rr = l ? str(req.query.r, 64) : '';
    if (!(e > now()) || !same(s, sign(`${id(req.params.id)}.${e}.${d}${l ? `.${l}` : ''}${rr ? `.r${rr}` : ''}`))) throw new HttpError(403, "Ce lien d'écoute a expiré : recharge la page.");
    const v = get('SELECT * FROM sound_versions WHERE id = ?', id(req.params.id));
    if (!v) throw new HttpError(404, 'Son introuvable.');
    res.set({ 'Content-Type': v.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    if (d) res.attachment(v.filename);
    const link = l && get('SELECT l.*, u.email AS owner_email FROM sound_links l JOIN users u ON u.id = l.user_id WHERE l.id = ?', l);
    if (link) {
      const title = get('SELECT title FROM sound_tracks WHERE id = ?', v.track_id)?.title || v.filename, contact = recipientFor(link.user_id, rr);
      // Un lecteur qui reprend le fichier par morceaux (Range) ne compte qu'une fois.
      if (!req.headers.range || /^bytes=0-/.test(req.headers.range)) trackRecipient(contact, 'download', title);
      tell(link, 'download', { who: contactName(contact), title, key: `${v.id}:${contact?.id || req.ip}` });
    }
    res.sendFile(path.join(soundsDir, v.stored_as));
  });

  // Télécharger un projet entier : un lien signé de dix minutes (un téléchargement ne porte pas la connexion), qui vérifie
  // encore l'accès au moment de l'envoi, puis le .zip, écrit au fil de l'envoi.
  app.post('/api/me/sounds/projects/:id/zip', ...me, (req, res) => {
    const p = project(req, req.params.id), e = now() + 10 * 60_000;
    res.json({ url: `/api/sounds/zip/${p.id}?u=${req.user.id}&e=${e}&s=${sign(`zip.${p.id}.${req.user.id}.${e}`)}` });
  });
  app.get('/api/sounds/zip/:id', wrap(async (req, res) => {
    rateLimit(`sounds-zip:${req.ip}`, 30);
    const pid = id(req.params.id), uid = id(req.query.u), e = Number(req.query.e), s = String(req.query.s || '');
    if (!(e > now()) || !same(s, sign(`zip.${pid}.${uid}.${e}`))) throw new HttpError(403, 'Ce lien de téléchargement a expiré : relance-le depuis ONIRIQUE CLOUD.');
    const p = get(`SELECT p.* FROM sound_projects p WHERE p.id = ? AND ${ACCESS}`, pid, uid, uid);
    if (!p) throw new HttpError(404, 'Projet introuvable.');
    const entries = projectZip(p), bytes = zipSize(entries);
    if (bytes > 0xFFFFFFFE) throw new HttpError(413, 'Ce projet dépasse 4 Go : télécharge ses titres un par un.');
    res.set({ 'Content-Type': 'application/zip', 'Content-Length': String(bytes), 'Cache-Control': 'no-store' });
    res.attachment(`${zipName(p.title)}.zip`);
    // Une coupure en cours d'envoi (fichier disparu, connexion fermée) arrête l'archive : le navigateur la voit incomplète.
    await writeZip(res, entries).catch((error) => { console.error(`[zip] projet ${p.id} : ${error.message}`); res.destroy(); });
  }));

  mountBeatStore(app, { me, track, room, receiveFile, openLink, linkTracks, linkProject, soundsDir, audioType, wrap });
  mountPackSend(app, { me, ownProject, sign, wrap });
  mountBeatTube(app, { me, track, soundsDir, wrap });
}

// Les rappels de sortie : sept jours avant et la veille, à partir de 9 h (heure de Paris), un e-mail à l'auteur du projet et
// à ses collaborateurs avec ce qu'il reste à faire. Chaque rappel ne part qu'une fois par date de sortie.
const parisDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(date);
const parisHour = () => Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
const dayShift = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const longDate = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export async function remindReleases({ force = false } = {}) {
  if (!force && parisHour() < 9) return 0;
  const today = parisDay();
  let sent = 0;
  for (const p of all(`SELECT * FROM sound_projects WHERE release_date > ? AND plan != ''`, today)) {
    const plan = planOf(p);
    const left = Math.round((Date.parse(p.release_date) - Date.parse(today)) / 86400_000);
    if (!plan || !plan.remind || ![7, 1].includes(left)) continue;
    const [date, marks = ''] = p.reminded.split(':');
    const done = date === p.release_date ? marks.split(',') : [];
    if (done.includes(String(left))) continue;
    run('UPDATE sound_projects SET reminded = ? WHERE id = ?', `${p.release_date}:${[...done, left].filter(Boolean).join(',')}`, p.id);
    const todo = plan.items.filter((x) => !x.done);
    const when = left === 1 ? 'demain' : `dans ${left} jours`;
    const text = [`« ${p.title} » sort ${when}, le ${longDate(p.release_date)}.`, '',
      ...(todo.length ? [`Il reste ${todo.length} tâche${todo.length > 1 ? 's' : ''} à faire :`, ...todo.map((x) => `- ${x.label} (${x.days === 0 ? 'le jour J' : `pour le ${longDate(dayShift(p.release_date, x.days))}`})`)]
        : ['Toutes les tâches de la préparation sont faites. Bonne sortie !']),
      '', `${config.siteUrl}/mes-sons#/p/${p.id}`, '', 'ONIRIQUE'].join('\n');
    const people = all(`SELECT email FROM users WHERE id = ? OR id IN (SELECT user_id FROM sound_collabs WHERE project_id = ?)`, p.user_id, p.id);
    for (const u of people) {
      await sendMail(u.email, `« ${p.title} » sort ${when} — ONIRIQUE`, text, undefined, { buttonLabel: 'Ouvrir le projet', eyebrow: 'Préparation de la sortie' })
        .then(() => { sent++; }, (error) => console.error('Rappel de sortie :', error.message));
    }
  }
  return sent;
}
