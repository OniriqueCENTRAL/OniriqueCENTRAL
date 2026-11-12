// ONIRIQUE ENVOI (site/envoi) : des fichiers lourds (stems, sessions, clips) envoyés par un lien, comme un transfert de
// fichiers classique. Il faut un compte validé pour envoyer ; le destinataire, lui, télécharge sans compte, fichier par
// fichier ou tout en .zip. L'envoi expire au bout de 1 à 30 jours (choisi par l'expéditeur) et ses fichiers sont effacés.
// Un mot de passe facultatif protège le lien : il n'est jamais mis dans une adresse ; la page reçoit une clé tirée de
// son empreinte, valable pour ce seul envoi.
// Les fichiers vivent dans data/envois, hors de la sauvegarde de la nuit (seuls keys, files et media y partent).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, get, all, run, now, setting } from './db.js';
import { HttpError, rateLimit, hashPassword, verifyPassword, optionalUser } from './auth.js';
import { writeZip, zipName } from './zipstream.js';

db.exec(`
CREATE TABLE IF NOT EXISTS envois (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT '',
  message       TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  ready         INTEGER NOT NULL DEFAULT 0,
  downloads     INTEGER NOT NULL DEFAULT 0,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS envoi_files (
  id        INTEGER PRIMARY KEY,
  envoi_id  TEXT NOT NULL REFERENCES envois(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  stored_as TEXT NOT NULL,
  size      INTEGER NOT NULL
);
`);

// Par envoi : l'archive .zip (sans ZIP64) tient sous 4 Go ; un fichier seul est limité à 2 Go par nginx.
export const ENVOI_MAX = 4e9;
export const ENVOI_FILES = 100;
export const ENVOI_DAYS = [1, 7, 14, 30];
const DAY = 86400_000;
const dir = path.join(config.dataDir, 'envois');
fs.mkdirSync(dir, { recursive: true });

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max) : '');
/** La clé que la page envoie à la place du mot de passe : elle change si le mot de passe change. */
const keyOf = (e) => crypto.createHash('sha256').update(`${e.id}:${e.password_hash}`).digest('hex').slice(0, 32);

/** Efface les envois expirés et ceux jamais terminés depuis un jour, puis les fichiers que plus rien ne cite. */
export function sweepEnvois(at = now()) {
  run('DELETE FROM envois WHERE expires_at < ? OR (ready = 0 AND created_at < ?)', at, at - DAY);
  const kept = new Set(all('SELECT stored_as FROM envoi_files').map((f) => f.stored_as));
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    // Un fichier tout juste reçu n'a peut-être pas encore sa ligne : on le laisse une heure.
    if (!kept.has(name) && fs.statSync(file).mtimeMs < at - 3600_000) fs.rmSync(file, { force: true });
  }
}

export function mountEnvoi(app, { requireVerified, receiveFile, wrap }) {
  sweepEnvois();
  setInterval(() => { try { sweepEnvois(); } catch (error) { console.error('envois :', error.message); } }, 3600_000).unref();

  const own = (req) => {
    const e = get('SELECT * FROM envois WHERE id = ? AND user_id = ?', String(req.params.id), req.user.id);
    if (!e) throw new HttpError(404, 'Envoi introuvable.');
    return e;
  };
  const filesOf = (id) => all('SELECT id, name, size, stored_as FROM envoi_files WHERE envoi_id = ? ORDER BY id', id);
  const summary = (e) => {
    const files = filesOf(e.id);
    return { id: e.id, title: e.title, message: e.message, locked: !!e.password_hash, ready: !!e.ready, downloads: e.downloads,
      expiresAt: e.expires_at, createdAt: e.created_at, size: files.reduce((s, f) => s + f.size, 0),
      files: files.map((f) => ({ id: f.id, name: f.name, size: f.size })) };
  };
  // L'envoi vu par le destinataire : prêt, pas expiré, et la bonne clé s'il a un mot de passe.
  const open = (req) => {
    const e = get('SELECT * FROM envois WHERE id = ? AND ready = 1 AND expires_at > ?', String(req.params.id), now());
    if (!e) throw new HttpError(404, "Ce lien a expiré ou n'existe pas.");
    if (e.password_hash && req.query.k !== keyOf(e)) throw Object.assign(new HttpError(401, 'Mot de passe requis.'), { data: { locked: true } });
    return e;
  };

  // ——— Expéditeur ———
  app.post('/api/envois', requireVerified, wrap(async (req, res) => {
    rateLimit(`envoi:${req.user.id}`, 30, DAY);
    const days = ENVOI_DAYS.includes(Number(req.body?.days)) ? Number(req.body.days) : 7;
    const password = clean(req.body?.password, 200);
    const id = crypto.randomBytes(9).toString('base64url');
    run('INSERT INTO envois (id, user_id, title, message, password_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, req.user.id, clean(req.body?.title, 120), clean(req.body?.message, 2000), password ? hashPassword(password) : '', now() + days * DAY, now());
    res.status(201).json({ id });
  }));

  app.post('/api/envois/:id/files', requireVerified, wrap(async (req, res) => {
    const e = own(req);
    if (e.ready) throw new HttpError(409, 'Cet envoi est déjà parti : crée-en un nouveau.');
    const length = Number(req.headers['content-length']);
    if (!Number.isFinite(length) || length <= 0) throw new HttpError(411, 'Taille du fichier inconnue.');
    const files = filesOf(e.id), used = files.reduce((s, f) => s + f.size, 0);
    if (files.length >= ENVOI_FILES) throw new HttpError(413, `${ENVOI_FILES} fichiers au plus par envoi.`);
    if (used + length > ENVOI_MAX) throw new HttpError(413, 'Un envoi fait 4 Go au plus.');
    const disk = fs.statfsSync(config.dataDir), total = disk.blocks * disk.bsize, taken = total - disk.bavail * disk.bsize;
    if ((taken + length) / total > setting('sounds_disk_max', 0.8)) throw new HttpError(507, "Le disque du serveur est presque plein : réessaie plus tard.");
    const stored = await receiveFile(req, dir, ENVOI_MAX - used);
    const name = zipName(clean(String(req.query.name || ''), 200) || 'fichier');
    const { lastInsertRowid } = run('INSERT INTO envoi_files (envoi_id, name, stored_as, size) VALUES (?, ?, ?, ?)', e.id, name, stored.storedAs, stored.size);
    res.status(201).json({ id: Number(lastInsertRowid), name, size: stored.size });
  }));

  app.post('/api/envois/:id/ready', requireVerified, wrap(async (req, res) => {
    const e = own(req);
    if (!filesOf(e.id).length) throw new HttpError(400, 'Ajoute au moins un fichier.');
    run('UPDATE envois SET ready = 1 WHERE id = ?', e.id);
    res.json(summary({ ...e, ready: 1 }));
  }));

  app.get('/api/envois', requireVerified, wrap(async (req, res) => {
    res.json(all('SELECT * FROM envois WHERE user_id = ? AND ready = 1 AND expires_at > ? ORDER BY created_at DESC', req.user.id, now()).map(summary));
  }));

  app.delete('/api/envois/:id', requireVerified, wrap(async (req, res) => {
    const e = own(req);
    const files = filesOf(e.id);
    run('DELETE FROM envois WHERE id = ?', e.id);
    for (const f of files) fs.rmSync(path.join(dir, f.stored_as), { force: true });
    res.json({ ok: true });
  }));

  // ——— Destinataire (sans compte) ———
  app.get('/api/envois/:id', wrap(async (req, res) => {
    const e = open(req);
    const sender = get('SELECT name FROM users WHERE id = ?', e.user_id);
    const me = optionalUser(req);
    res.set('Cache-Control', 'no-store').json({ ...summary(e), sender: sender?.name || 'Un membre ONIRIQUE', mine: me?.id === e.user_id });
  }));

  // Le mot de passe arrive dans le corps (jamais dans l'adresse) ; la réponse donne la clé des téléchargements.
  app.post('/api/envois/:id/unlock', wrap(async (req, res) => {
    rateLimit(`envoi-unlock:${req.ip}:${req.params.id}`, 10, 15 * 60_000);
    const e = get('SELECT * FROM envois WHERE id = ? AND ready = 1 AND expires_at > ?', String(req.params.id), now());
    if (!e) throw new HttpError(404, "Ce lien a expiré ou n'existe pas.");
    if (e.password_hash && !verifyPassword(String(req.body?.password || ''), e.password_hash)) throw new HttpError(403, 'Mot de passe incorrect.');
    res.json({ key: keyOf(e) });
  }));

  app.get('/api/envois/:id/files/:file', wrap(async (req, res) => {
    const e = open(req);
    const f = get('SELECT * FROM envoi_files WHERE id = ? AND envoi_id = ?', Number(req.params.file) || 0, e.id);
    if (!f) throw new HttpError(404, 'Fichier introuvable.');
    run('UPDATE envois SET downloads = downloads + 1 WHERE id = ?', e.id);
    res.download(path.join(dir, f.stored_as), f.name, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }));

  app.get('/api/envois/:id/zip', wrap(async (req, res) => {
    const e = open(req);
    const files = filesOf(e.id);
    // Deux fichiers au même nom dans l'archive : le second prend un numéro.
    const seen = new Map();
    const entries = files.map((f) => {
      const n = (seen.get(f.name) || 0) + 1;
      seen.set(f.name, n);
      return { name: n > 1 ? f.name.replace(/(\.[^.]*)?$/, ` (${n})$1`) : f.name, path: path.join(dir, f.stored_as) };
    });
    run('UPDATE envois SET downloads = downloads + 1 WHERE id = ?', e.id);
    const title = zipName(e.title || `ONIRIQUE ENVOI ${e.id}`);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="envoi.zip"; filename*=UTF-8''${encodeURIComponent(title)}.zip` });
    await writeZip(res, entries).catch((error) => res.destroy(error));
    res.end();
  }));
}
