// « Mes sons » : l'espace des membres ONIRIQUE (et des fondateurs) pour leur musique en cours, façon [untitled].
// Des projets, des titres et leurs versions successives, des liens d'écoute privés (mot de passe, date de fin,
// téléchargement au choix), les écoutes comptées et des commentaires placés à un moment du titre.
// Les fichiers vont dans data/sounds/ ; chaque membre a un quota, et plus rien n'entre quand le disque est plein à 80 %.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, get, all, run, now, setting, setSetting, transaction } from './db.js';
import { HttpError, rateLimit, optionalUser, hashPassword, verifyPassword } from './auth.js';
import { sendMail } from './mail.js';

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

export const soundsDir = path.join(config.dataDir, 'sounds');
fs.mkdirSync(soundsDir, { recursive: true });

const MAX_FILE = 500 * 1024 * 1024;
const GB = 1024 ** 3;
export const MEMBERS = ['vip', 'founder'];
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

function removeVersionFiles(rows) {
  for (const r of rows) fs.rmSync(path.join(soundsDir, r.stored_as), { force: true });
}
/** Les fichiers qui ne correspondent plus à aucune version (compte supprimé, envoi interrompu) sont effacés au démarrage. */
export function sweepSounds() {
  const kept = new Set(all('SELECT stored_as FROM sound_versions').map((r) => r.stored_as));
  for (const name of fs.readdirSync(soundsDir)) if (!kept.has(name)) fs.rmSync(path.join(soundsDir, name), { force: true });
}

export function mountSounds(app, { requireUser, receiveFile, receiveImage, removeMedia, wrap }) {
  sweepSounds();
  const member = (req, _res, next) => (MEMBERS.includes(req.user.role) ? next()
    : next(new HttpError(403, 'Mes sons est réservé aux membres ONIRIQUE.')));
  const me = [requireUser, member];

  const project = (req, pid) => {
    const row = get('SELECT * FROM sound_projects WHERE id = ? AND user_id = ?', id(pid), req.user.id);
    if (!row) throw new HttpError(404, 'Projet introuvable.');
    return row;
  };
  const track = (req, tid) => {
    const row = get(`SELECT t.* FROM sound_tracks t JOIN sound_projects p ON p.id = t.project_id WHERE t.id = ? AND p.user_id = ?`, id(tid), req.user.id);
    if (!row) throw new HttpError(404, 'Titre introuvable.');
    return row;
  };
  const versionOf = (req, vid) => {
    const row = get(`SELECT v.*, t.current_id FROM sound_versions v JOIN sound_tracks t ON t.id = v.track_id JOIN sound_projects p ON p.id = t.project_id
      WHERE v.id = ? AND p.user_id = ?`, id(vid), req.user.id);
    if (!row) throw new HttpError(404, 'Version introuvable.');
    return row;
  };

  /** Reçoit un fichier audio : refusé si le quota du membre ou le seuil du disque serait dépassé. */
  async function receiveAudio(req) {
    const length = Number(req.headers['content-length']);
    if (!Number.isFinite(length) || length <= 0) throw new HttpError(411, 'Taille du fichier inconnue.');
    if (length > MAX_FILE) throw new HttpError(413, 'Fichier trop volumineux : 500 Mo au plus par fichier.');
    const d = disk();
    if ((d.used + length) / d.total > diskMax()) throw new HttpError(507, "L'espace de stockage d'ONIRIQUE est plein pour le moment : aucun envoi n'est possible. Réessaie plus tard.");
    const left = quotaBytes() - usedBy(req.user.id);
    if (length > left) throw new HttpError(413, `Ton espace est plein (${Math.round(quotaBytes() / GB)} Go) : supprime des versions ou des titres pour en envoyer d'autres.`);
    const file = await receiveFile(req, soundsDir, Math.min(MAX_FILE, left));
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
    const projects = all('SELECT * FROM sound_projects WHERE user_id = ? ORDER BY created_at DESC', req.user.id);
    const tracks = all(`SELECT t.* FROM sound_tracks t JOIN sound_projects p ON p.id = t.project_id WHERE p.user_id = ? ORDER BY t.position, t.id`, req.user.id);
    const versions = all(`SELECT v.* FROM sound_versions v JOIN sound_tracks t ON t.id = v.track_id JOIN sound_projects p ON p.id = t.project_id
      WHERE p.user_id = ? ORDER BY v.id`, req.user.id);
    const comments = all(`SELECT c.* FROM sound_comments c JOIN sound_tracks t ON t.id = c.track_id JOIN sound_projects p ON p.id = t.project_id
      WHERE p.user_id = ? ORDER BY c.at`, req.user.id);
    const links = all(`SELECT l.*, (SELECT COUNT(*) FROM sound_plays WHERE link_id = l.id) AS plays,
      (SELECT MAX(created_at) FROM sound_plays WHERE link_id = l.id) AS last_play FROM sound_links l WHERE l.user_id = ? ORDER BY l.created_at DESC`, req.user.id);
    const d = disk();
    res.json({
      quota: { used: usedBy(req.user.id), limit: quotaBytes(), full: d.used / d.total >= diskMax() },
      projects: projects.map((p) => ({
        id: p.id, title: p.title, cover: media(p.cover), createdAt: p.created_at,
        tracks: tracks.filter((t) => t.project_id === p.id).map((t) => ({
          id: t.id, title: t.title, currentId: t.current_id,
          versions: versions.filter((v) => v.track_id === t.id).map((v, i) => versionView(v, i, true)),
          comments: comments.filter((c) => c.track_id === t.id).map(commentView),
        })),
      })),
      links: links.map((l) => ({
        id: l.id, url: `${config.siteUrl}/ecoute?t=${l.token}`, projectId: l.project_id, trackId: l.track_id, label: l.label,
        password: !!l.password_hash, expiresAt: l.expires_at, download: !!l.download, plays: l.plays, lastPlay: l.last_play, createdAt: l.created_at,
      })),
    });
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
    // L'ordre des titres : la liste de leurs identifiants, seulement ceux de ce projet.
    if (Array.isArray(req.body.order)) transaction(() => req.body.order.forEach((tid, i) =>
      run('UPDATE sound_tracks SET position = ? WHERE id = ? AND project_id = ?', i, id(tid), p.id)));
    res.json({ ok: true });
  });
  app.delete('/api/me/sounds/projects/:id', ...me, (req, res) => {
    const p = project(req, req.params.id);
    const files = all('SELECT v.stored_as FROM sound_versions v JOIN sound_tracks t ON t.id = v.track_id WHERE t.project_id = ?', p.id);
    run('DELETE FROM sound_projects WHERE id = ?', p.id);
    removeVersionFiles(files);
    if (p.cover) removeMedia(p.cover);
    res.json({ ok: true });
  });
  app.put('/api/me/sounds/projects/:id/cover', ...me, wrap(async (req, res) => {
    const p = project(req, req.params.id);
    rateLimit(`sounds-cover:${req.user.id}`, 30);
    const name = await receiveImage(req, 3 * 1024 * 1024);
    run('UPDATE sound_projects SET cover = ? WHERE id = ?', name, p.id);
    if (p.cover) removeMedia(p.cover);
    res.json({ cover: media(name) });
  }));

  // Un nouveau titre : le fichier en corps brut, son nom dans ?filename= ; il devient sa version 1.
  app.post('/api/me/sounds/projects/:id/tracks', ...me, wrap(async (req, res) => {
    const p = project(req, req.params.id);
    rateLimit(`sounds-upload:${req.user.id}`, 200, 3600_000);
    const file = await receiveAudio(req);
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
    const file = await receiveAudio(req);
    const vid = addVersion(t.id, file, str(req.query.note, 300));
    run('UPDATE sound_tracks SET current_id = ? WHERE id = ?', vid, t.id);
    res.status(201).json({ id: vid });
  }));
  app.patch('/api/me/sounds/tracks/:id', ...me, (req, res) => {
    const t = track(req, req.params.id);
    if (req.body.title !== undefined) {
      const title = str(req.body.title, 120);
      if (!title) throw new HttpError(400, 'Donne un nom au titre.');
      run('UPDATE sound_tracks SET title = ? WHERE id = ?', title, t.id);
    }
    if (req.body.currentId !== undefined) {
      if (!get('SELECT 1 FROM sound_versions WHERE id = ? AND track_id = ?', id(req.body.currentId), t.id)) throw new HttpError(400, 'Version inconnue.');
      run('UPDATE sound_tracks SET current_id = ? WHERE id = ?', id(req.body.currentId), t.id);
    }
    res.json({ ok: true });
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
    const projectId = req.body.projectId ? project(req, req.body.projectId).id : null;
    const trackId = !projectId && req.body.trackId ? track(req, req.body.trackId).id : null;
    if (!projectId && !trackId) throw new HttpError(400, 'Choisis un projet ou un titre à partager.');
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (password && password.length < 4) throw new HttpError(400, 'Mot de passe : 4 caractères au moins.');
    const expiresAt = req.body.expiresAt ? Number(req.body.expiresAt) : null;
    if (expiresAt !== null && !(expiresAt > now())) throw new HttpError(400, 'La date de fin doit être dans le futur.');
    const token = crypto.randomBytes(12).toString('base64url');
    run(`INSERT INTO sound_links (token, user_id, project_id, track_id, label, password_hash, expires_at, download, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      token, req.user.id, projectId, trackId, str(req.body.label, 80), password ? hashPassword(password) : null, expiresAt, req.body.download ? 1 : 0, now());
    res.status(201).json({ url: `${config.siteUrl}/ecoute?t=${token}` });
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
  function openLink(req) {
    const link = get(`SELECT l.*, u.name AS owner_name, u.email AS owner_email FROM sound_links l JOIN users u ON u.id = l.user_id
      WHERE l.token = ? AND u.role IN (${MEMBERS.map(() => '?').join(', ')})`, str(req.params.token, 40), ...MEMBERS);
    if (!link || (link.expires_at && link.expires_at < now())) throw new HttpError(404, "Ce lien d'écoute n'existe pas ou n'est plus valable.");
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
      owner: link.owner_name || 'ONIRIQUE', title: link.track_id ? tracks[0]?.title : p.title, project: p.title, cover: media(p.cover),
      download: !!link.download,
      tracks: tracks.map((t) => ({
        id: t.id, title: t.title,
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
