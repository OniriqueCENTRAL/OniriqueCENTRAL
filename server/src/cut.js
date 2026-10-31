// ONIRIQUE CUT (site/cut) : le montage se fait dans le navigateur, qui encode la vidéo image par image en H.264 (ou, faute
// de WebCodecs, l'enregistre en temps réel). Le serveur en fait le MP4 que TikTok, Instagram et YouTube acceptent sans
// broncher : H.264 + AAC, 1080 × 1920, 30 images par seconde constantes. Réservé aux comptes qui ont
// ONIRIQUE CLOUD (membres ONIRIQUE et abonnés aux outils). Rien n'est gardé : les fichiers sont effacés aussitôt.
// Seule exception : le cloud CUT des fondateurs (les vidéos qu'ils choisissent de garder, dossier cut-library), qu'ils
// retrouvent aussi sur téléphone dans l'appweb ONIRIQUE CUT (site/mes-videos), pour les envoyer vers TikTok.
//
// Le son : la page envoie d'abord celui du passage tel qu'il est dans le fichier (WAV, POST /api/cut/audio), puis la
// vidéo (POST /api/cut/mp4?audio=…&offset=…). Le son n'est encodé qu'une fois, en AAC 320 kb/s, à sa fréquence d'origine,
// au lieu de passer par l'enregistrement du navigateur (déjà compressé) puis par une seconde compression.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { HttpError, rateLimit, can } from './auth.js';
import { testing } from './mail.js';
import { db, get, all, run, now, setting, setSetting } from './db.js';
import { push } from './push.js';

db.exec(`CREATE TABLE IF NOT EXISTS cut_videos (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  stored_as  TEXT NOT NULL,
  size       INTEGER NOT NULL,
  duration   REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`);
// Le rappel quotidien des fondateurs (« poste ton TikTok ») : leur heure, leur fuseau, et le dernier jour où il est parti.
db.exec(`CREATE TABLE IF NOT EXISTS cut_reminders (
  user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  time     TEXT NOT NULL,
  tz       TEXT NOT NULL,
  last_day TEXT NOT NULL DEFAULT ''
)`);
/** Le jour (AAAA-MM-JJ) et la minute de la journée à l'instant ms, dans le fuseau tz. */
export function localNow(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(ms).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const minutesOf = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
/** Vérifié chaque minute : le rappel part une fois par jour, dans l'heure qui suit l'heure choisie (un serveur redémarré ne le rate pas). */
export function remindCut(at = now()) {
  const sent = [];
  for (const r of all("SELECT r.* FROM cut_reminders r JOIN users u ON u.id = r.user_id WHERE u.role = 'founder'")) {
    const { day, minutes } = localNow(at, r.tz), late = minutes - minutesOf(r.time);
    if (r.last_day === day || late < 0 || late >= 60) continue;
    run('UPDATE cut_reminders SET last_day = ? WHERE user_id = ?', day, r.user_id);
    // La vidéo prévue pour aujourd'hui, s'il y en a une : le rappel la nomme et l'ouvre.
    const planned = get('SELECT id, name FROM cut_videos WHERE user_id = ? AND scheduled_day = ? ORDER BY created_at LIMIT 1', r.user_id, day);
    push(r.user_id, planned
      ? { title: 'ONIRIQUE CUT', body: `C'est l'heure de poster ton TikTok du jour : « ${planned.name} ».`, url: '/mes-videos?v=' + planned.id }
      : { title: 'ONIRIQUE CUT', body: "C'est l'heure de poster ton TikTok du jour : tes vidéos t'attendent.", url: '/mes-videos' });
    sent.push(r.user_id);
  }
  return sent;
}

// Le planning : le jour où une vidéo gardée doit être postée (AAAA-MM-JJ, dans le fuseau du fondateur).
if (!all('PRAGMA table_info(cut_videos)').some((c) => c.name === 'scheduled_day')) db.exec('ALTER TABLE cut_videos ADD COLUMN scheduled_day TEXT');
// La description proposée par CUT (style TikTok), reprise par l'appweb et pour YouTube.
if (!all('PRAGMA table_info(cut_videos)').some((c) => c.name === 'caption')) db.exec("ALTER TABLE cut_videos ADD COLUMN caption TEXT NOT NULL DEFAULT ''");
// La banque de fonds : les clips (vidéos, photos) qu'un fondateur garde pour les réutiliser d'un son à l'autre.
db.exec(`CREATE TABLE IF NOT EXISTS cut_backgrounds (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  stored_as  TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL
)`);
const LIBRARY_MAX = 1024 * 1024 * 1024; // une vidéo gardée : 1 Go au plus
/** Le type d'un fond d'après ses premiers octets (jamais d'après ce qu'annonce le navigateur) ; null si ce n'est ni une vidéo ni une photo. */
export function backgroundType(head) {
  if (head.toString('latin1', 4, 8) === 'ftyp') return head.toString('latin1', 8, 10) === 'qt' ? 'video/quicktime' : 'video/mp4';
  if (head.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
// Les liens de lecture et de téléchargement des vidéos gardées : signés, valables 6 heures (une balise <video> n'envoie pas de jeton).
function signKey() {
  let key = setting('cut_key', null);
  if (!key) { key = crypto.randomBytes(32).toString('hex'); setSetting('cut_key', key); }
  return key;
}
const sign = (text) => crypto.createHmac('sha256', signKey()).update(text).digest('base64url');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const videoUrl = (id, download = false) => { const e = now() + 6 * 3600_000, d = download ? 1 : 0; return `/api/cut/video/${id}?e=${e}&d=${d}&s=${sign(`cutvideo.${id}.${e}.${d}`)}`; };
// L'image d'aperçu : le lien change une fois par jour, pour que le téléphone la garde en cache d'une visite à l'autre.
const DAY = 86_400_000;
const posterUrl = (id) => { const e = (Math.floor(now() / DAY) + 2) * DAY; return `/api/cut/poster/${id}?e=${e}&s=${sign(`cutposter.${id}.${e}`)}`; };
const videoView = (v) => ({ id: v.id, name: v.name, size: v.size, duration: v.duration, createdAt: v.created_at, scheduledDay: v.scheduled_day || null, caption: v.caption || '',
  url: videoUrl(v.id), downloadUrl: videoUrl(v.id, true), poster: posterUrl(v.id) });
const backgroundUrl = (id) => { const e = now() + 6 * 3600_000; return `/api/cut/background/${id}?e=${e}&s=${sign(`cutbg.${id}.${e}`)}`; };
const backgroundView = (b) => ({ id: b.id, name: b.name, type: b.mime, size: b.size, createdAt: b.created_at, url: backgroundUrl(b.id) });
// L'aperçu (une image de la vidéo, 360 px de large) est fait par ffmpeg à sa première demande, puis gardé à côté de la
// vidéo. Un à la fois : le serveur a peu de mémoire.
let posterQueue = Promise.resolve();
const makePoster = (video, poster, duration) => (posterQueue = posterQueue.then(() => (fs.existsSync(poster) || testing ? null
  : new Promise((resolve) => execFile('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', Math.min(1, duration / 2).toFixed(2), '-i', video,
    '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', poster], { timeout: 60_000 }, () => resolve()))))); // pas de ffmpeg pendant les tests

const MAX_BYTES = 600 * 1024 * 1024; // une minute en 1080p tient largement dedans
const AUDIO_MAX = 300 * 1024 * 1024; // trois minutes en WAV 24 bits stéréo 48 kHz : 52 Mo
const AUDIO_TTL = 30 * 60_000; // un son envoyé sans vidéo derrière est effacé au bout d'une demi-heure

/** offset : de combien de secondes le son démarre après le début de la vidéo (négatif : avant). */
// raw : la vidéo arrive en H.264 brut, encodée image par image par la page : gardée telle quelle à 30 images par seconde
// exactes (aucun second encodage, donc aucune perte, et presque rien à faire pour le serveur). Sinon, l'enregistrement en
// temps réel est réencodé en x264, réglé pour tenir dans la mémoire du serveur (1 cœur, moins de 2 Go).
export const cutArgs = (input, output, audio = null, offset = 0, raw = false) => ['-y', '-hide_banner', '-loglevel', 'error',
  ...(raw ? ['-r', '30', '-f', 'h264'] : []), '-i', input,
  ...(audio ? [...(offset > 0 ? ['-itsoffset', offset.toFixed(3)] : offset < 0 ? ['-ss', (-offset).toFixed(3)] : []), '-i', audio,
    // Pas de -shortest avec le H.264 brut copié : ffmpeg y perd tout le son (le son a déjà la durée exacte de la vidéo).
    '-map', '0:v:0', '-map', '1:a:0', ...(raw ? [] : ['-shortest'])] : []),
  ...(raw ? ['-c:v', 'copy'] : ['-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-threads', '1', '-x264-params', 'rc-lookahead=20', '-profile:v', 'high', '-tune', 'film']),
  '-c:a', 'aac', '-b:a', '320k',
  '-movflags', '+faststart', output];

function toMp4(input, output, audio, offset, raw) {
  if (testing) { fs.copyFileSync(input, output); return Promise.resolve(); } // pas de ffmpeg pendant les tests
  return new Promise((resolve, reject) => execFile('ffmpeg', cutArgs(input, output, audio, offset, raw), { timeout: 10 * 60_000 }, (error, _out, stderr) =>
    (error ? reject(new HttpError(500, 'La conversion en MP4 a échoué : ' + (String(stderr || error.message).trim().split('\n').pop().slice(0, 160) || 'ffmpeg'))) : resolve())));
}

export function mountCut(app, { requireUser, receiveFile, wrap }) {
  const dir = path.join(config.dataDir, 'cut');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true }); // restes d'un redémarrage

  const member = (req, _res, next) => (can(req.user, 'sounds') ? next()
    : next(new HttpError(403, 'ONIRIQUE CUT est réservé aux membres ONIRIQUE et aux abonnés CLOUD : onirique.store/cloud.')));

  // Les sons envoyés, en attente de leur vidéo : id → { userId, file, timer }.
  const audios = new Map();
  const forget = (id) => {
    const a = audios.get(id);
    if (!a) return;
    clearTimeout(a.timer);
    fs.rmSync(a.file, { force: true });
    audios.delete(id);
  };

  // ——— Le cloud CUT des fondateurs ———
  const libDir = path.join(config.dataDir, 'cut-library');
  fs.mkdirSync(libDir, { recursive: true });
  // Les fichiers dont la vidéo n'existe plus (compte supprimé, par exemple) partent au démarrage.
  const kept = new Set(all('SELECT stored_as FROM cut_videos').map((v) => v.stored_as));
  for (const name of fs.readdirSync(libDir)) if (!kept.has(name.replace(/\.jpg$/, ''))) fs.rmSync(path.join(libDir, name), { force: true });
  const founder = (req, _res, next) => (req.user.role === 'founder' ? next() : next(new HttpError(403, 'Le cloud CUT est réservé aux fondateurs.')));
  const ownVideo = (req) => {
    const v = get('SELECT * FROM cut_videos WHERE id = ? AND user_id = ?', Number(req.params.id) || 0, req.user.id);
    if (!v) throw new HttpError(404, 'Vidéo introuvable.');
    return v;
  };

  app.post('/api/cut/library', requireUser, member, founder, wrap(async (req, res) => {
    rateLimit(`cut-library:${req.user.id}`, 120, 3600_000);
    const length = Number(req.headers['content-length']);
    if (!Number.isFinite(length) || length <= 0) throw new HttpError(411, 'Taille de la vidéo inconnue.');
    // Le même seuil que les sons de ONIRIQUE CLOUD : le disque ne se remplit jamais au-delà.
    const disk = fs.statfsSync(config.dataDir), total = disk.blocks * disk.bsize, used = total - disk.bavail * disk.bsize;
    if ((used + length) / total > setting('sounds_disk_max', 0.8)) throw new HttpError(507, "Le disque du serveur est presque plein : la vidéo n'a pas été gardée.");
    const stored = await receiveFile(req, libDir, LIBRARY_MAX), file = path.join(libDir, stored.storedAs);
    const head = Buffer.alloc(12), fd = fs.openSync(file, 'r');
    fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
    if (head.toString('latin1', 4, 8) !== 'ftyp') { fs.rmSync(file, { force: true }); throw new HttpError(400, 'Vidéo MP4 attendue.'); }
    const name = String(req.query.name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').trim().slice(0, 100) || 'Vidéo ONIRIQUE CUT';
    const duration = Math.max(0, Math.min(3600, Number(req.query.duration) || 0));
    const caption = String(req.query.caption || '').replace(/[\u0000-\u0009\u000b-\u001f]+/g, '').trim().slice(0, 2200);
    const id = run('INSERT INTO cut_videos (user_id, name, stored_as, size, duration, caption, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      req.user.id, name, stored.storedAs, stored.size, duration, caption, now()).lastInsertRowid;
    res.status(201).json(videoView(get('SELECT * FROM cut_videos WHERE id = ?', id)));
  }));
  app.get('/api/cut/library', requireUser, member, founder, (req, res) => {
    res.json({ videos: all('SELECT * FROM cut_videos WHERE user_id = ? ORDER BY created_at DESC', req.user.id).map(videoView) });
  });
  app.delete('/api/cut/library/:id', requireUser, member, founder, (req, res) => {
    const v = ownVideo(req);
    run('DELETE FROM cut_videos WHERE id = ?', v.id);
    fs.rmSync(path.join(libDir, v.stored_as), { force: true });
    fs.rmSync(path.join(libDir, v.stored_as + '.jpg'), { force: true });
    res.json({ ok: true });
  });
  // Le planning : le jour où la vidéo doit partir (null : pas de jour).
  app.patch('/api/cut/library/:id', requireUser, member, founder, (req, res) => {
    const v = ownVideo(req), day = req.body?.day ?? null;
    if (day !== null && !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(day))) throw new HttpError(400, 'Jour invalide.');
    run('UPDATE cut_videos SET scheduled_day = ? WHERE id = ?', day, v.id);
    res.json(videoView(get('SELECT * FROM cut_videos WHERE id = ?', v.id)));
  });

  const channelOf = (userId) => get('SELECT channel_title FROM youtube_accounts WHERE user_id = ?', userId)?.channel_title || null;
  // En Short YouTube programmé : la vidéo est copiée ici vers les Shorts (youtube.js), qui la publie à l'heure dite.
  app.post('/api/cut/library/:id/youtube', requireUser, member, founder, wrap(async (req, res) => {
    if (!can(req.user, 'youtube')) throw new HttpError(403, "Les Shorts YouTube ne sont pas ouverts à ce compte.");
    const v = ownVideo(req);
    if (!channelOf(req.user.id)) throw new HttpError(400, 'Relie d\'abord ta chaîne YouTube dans ton compte (Shorts YouTube).');
    const title = String(req.body?.title || v.name).replace(/[<>]/g, '').trim().slice(0, 100) || 'Short';
    const description = String(req.body?.description ?? v.caption).replace(/[<>]/g, '').trim().slice(0, 5000);
    const publishAt = Number(req.body?.publishAt);
    if (!(publishAt > now() - 60_000 && publishAt < now() + 366 * 86_400_000)) throw new HttpError(400, "Choisis une date à venir, dans l'année.");
    if (get(`SELECT COUNT(*) AS n FROM youtube_videos WHERE user_id = ? AND status != 'published'`, req.user.id).n >= 30) {
      throw new HttpError(400, 'Trente Shorts attendent déjà : laisse-en partir avant d\'en programmer d\'autres.');
    }
    const storedAs = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(config.videosDir, { recursive: true });
    fs.copyFileSync(path.join(libDir, v.stored_as), path.join(config.videosDir, storedAs));
    const id = run(`INSERT INTO youtube_videos (user_id, stored_as, filename, mime, size, title, description, publish_at, status, created_at)
      VALUES (?, ?, ?, 'video/mp4', ?, ?, ?, ?, 'scheduled', ?)`, req.user.id, storedAs, v.name + '.mp4', v.size, title, description, publishAt, now()).lastInsertRowid;
    res.status(201).json({ id, title, publishAt });
  }));
  // Les Shorts déjà programmés (leurs heures), pour trouver le prochain jour libre.
  app.get('/api/cut/youtube', requireUser, member, founder, wrap(async (req, res) => {
    const allowed = can(req.user, 'youtube');
    res.json({ allowed, channel: allowed ? channelOf(req.user.id) : null,
      scheduled: allowed ? all("SELECT publish_at FROM youtube_videos WHERE user_id = ? AND status IN ('scheduled', 'uploading')", req.user.id).map((x) => x.publish_at) : [] });
  }));

  // ——— La banque de fonds des fondateurs : des clips gardés pour les réutiliser d'un son à l'autre ———
  const bgDir = path.join(config.dataDir, 'cut-backgrounds');
  fs.mkdirSync(bgDir, { recursive: true });
  const bgKept = new Set(all('SELECT stored_as FROM cut_backgrounds').map((b) => b.stored_as));
  for (const name of fs.readdirSync(bgDir)) if (!bgKept.has(name)) fs.rmSync(path.join(bgDir, name), { force: true });
  app.post('/api/cut/backgrounds', requireUser, member, founder, wrap(async (req, res) => {
    rateLimit(`cut-bg:${req.user.id}`, 200, 3600_000);
    const length = Number(req.headers['content-length']);
    if (!Number.isFinite(length) || length <= 0) throw new HttpError(411, 'Taille du fichier inconnue.');
    const disk = fs.statfsSync(config.dataDir), total = disk.blocks * disk.bsize, used = total - disk.bavail * disk.bsize;
    if ((used + length) / total > setting('sounds_disk_max', 0.8)) throw new HttpError(507, "Le disque du serveur est presque plein : le fond n'a pas été gardé.");
    const stored = await receiveFile(req, bgDir, LIBRARY_MAX), file = path.join(bgDir, stored.storedAs);
    const head = Buffer.alloc(16), fd = fs.openSync(file, 'r');
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
    const mime = backgroundType(head);
    if (!mime) { fs.rmSync(file, { force: true }); throw new HttpError(400, 'Vidéo (MP4, MOV, WebM) ou photo (JPEG, PNG, WebP) attendue.'); }
    const name = String(req.query.name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').trim().slice(0, 100) || 'Fond';
    const id = run('INSERT INTO cut_backgrounds (user_id, name, stored_as, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      req.user.id, name, stored.storedAs, mime, stored.size, now()).lastInsertRowid;
    res.status(201).json(backgroundView(get('SELECT * FROM cut_backgrounds WHERE id = ?', id)));
  }));
  app.get('/api/cut/backgrounds', requireUser, member, founder, (req, res) => {
    res.json({ backgrounds: all('SELECT * FROM cut_backgrounds WHERE user_id = ? ORDER BY created_at DESC', req.user.id).map(backgroundView) });
  });
  app.delete('/api/cut/backgrounds/:id', requireUser, member, founder, (req, res) => {
    const b = get('SELECT * FROM cut_backgrounds WHERE id = ? AND user_id = ?', Number(req.params.id) || 0, req.user.id);
    if (!b) throw new HttpError(404, 'Fond introuvable.');
    run('DELETE FROM cut_backgrounds WHERE id = ?', b.id);
    fs.rmSync(path.join(bgDir, b.stored_as), { force: true });
    res.json({ ok: true });
  });
  app.get('/api/cut/background/:id', (req, res) => {
    const id = Number(req.params.id) || 0, e = Number(req.query.e), sig = String(req.query.s || '');
    if (!(e > now()) || !same(sig, sign(`cutbg.${id}.${e}`))) throw new HttpError(403, 'Ce lien a expiré : rouvre ta banque de fonds.');
    const b = get('SELECT * FROM cut_backgrounds WHERE id = ?', id);
    if (!b) throw new HttpError(404, 'Fond introuvable.');
    res.sendFile(path.join(bgDir, b.stored_as), { headers: { 'Content-Type': b.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  });

  // Le rappel quotidien : il arrive sur les appareils où les notifications sont activées (l'appweb sur le téléphone).
  app.get('/api/cut/reminder', requireUser, member, founder, (req, res) => {
    const r = get('SELECT time, tz FROM cut_reminders WHERE user_id = ?', req.user.id);
    res.json(r ? { on: true, time: r.time, tz: r.tz } : { on: false, time: '18:00' });
  });
  app.put('/api/cut/reminder', requireUser, member, founder, (req, res) => {
    const time = String(req.body?.time || '18:00'), tz = String(req.body?.tz || 'Europe/Paris');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'Heure invalide.');
    try { localNow(now(), tz); } catch { throw new HttpError(400, 'Fuseau horaire inconnu.'); }
    if (req.body?.on !== true) { run('DELETE FROM cut_reminders WHERE user_id = ?', req.user.id); return res.json({ on: false, time }); }
    // Réglé après l'heure du jour : le premier rappel part demain.
    const { day, minutes } = localNow(now(), tz);
    run(`INSERT INTO cut_reminders (user_id, time, tz, last_day) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET time = excluded.time, tz = excluded.tz, last_day = excluded.last_day`, req.user.id, time, tz, minutes >= minutesOf(time) ? day : '');
    res.json({ on: true, time, tz });
  });

  // La lecture (avec avance rapide) et le téléchargement, par lien signé.
  app.get('/api/cut/video/:id', (req, res) => {
    const vid = Number(req.params.id) || 0, e = Number(req.query.e), d = req.query.d === '1' ? 1 : 0, s = String(req.query.s || '');
    if (!(e > now()) || !same(s, sign(`cutvideo.${vid}.${e}.${d}`))) throw new HttpError(403, 'Ce lien a expiré : rouvre « Mes vidéos CUT ».');
    const v = get('SELECT * FROM cut_videos WHERE id = ?', vid);
    if (!v) throw new HttpError(404, 'Vidéo introuvable.');
    if (d) res.attachment(v.name + '.mp4');
    res.sendFile(path.join(libDir, v.stored_as), { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  });

  app.get('/api/cut/poster/:id', wrap(async (req, res) => {
    const vid = Number(req.params.id) || 0, e = Number(req.query.e), s = String(req.query.s || '');
    if (!(e > now()) || !same(s, sign(`cutposter.${vid}.${e}`))) throw new HttpError(403, 'Ce lien a expiré : rouvre « Mes vidéos CUT ».');
    const v = get('SELECT * FROM cut_videos WHERE id = ?', vid);
    if (!v) throw new HttpError(404, 'Vidéo introuvable.');
    const poster = path.join(libDir, v.stored_as + '.jpg');
    await makePoster(path.join(libDir, v.stored_as), poster, v.duration);
    if (!fs.existsSync(poster)) throw new HttpError(404, "Pas d'aperçu pour cette vidéo.");
    res.sendFile(poster, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
  }));

  app.post('/api/cut/audio', requireUser, member, wrap(async (req, res) => {
    rateLimit(`cut-audio:${req.user.id}`, 60, 3600_000);
    const stored = await receiveFile(req, dir, AUDIO_MAX), file = path.join(dir, stored.storedAs);
    const head = Buffer.alloc(12), fd = fs.openSync(file, 'r');
    fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
    if (head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') {
      fs.rmSync(file, { force: true });
      throw new HttpError(400, 'Son attendu au format WAV.');
    }
    const timer = setTimeout(() => forget(stored.storedAs), AUDIO_TTL);
    timer.unref?.();
    audios.set(stored.storedAs, { userId: req.user.id, file, timer });
    res.status(201).json({ id: stored.storedAs });
  }));

  app.post('/api/cut/mp4', requireUser, member, wrap(async (req, res) => {
    rateLimit(`cut:${req.user.id}`, 30, 3600_000);
    const audioId = String(req.query.audio || ''), audio = audioId ? audios.get(audioId) : null;
    if (audioId && (!audio || audio.userId !== req.user.id)) throw new HttpError(400, "Le son de l'export n'est plus disponible : relance l'export.");
    const offset = Math.max(-5, Math.min(5, Number(req.query.offset) || 0));
    const file = await receiveFile(req, dir, MAX_BYTES);
    const input = path.join(dir, file.storedAs), output = input + '.mp4';
    const clean = () => { fs.rmSync(input, { force: true }); fs.rmSync(output, { force: true }); };
    // Le son ne sert qu'une fois : effacé dès que le MP4 est fait (ou raté).
    try { await toMp4(input, output, audio?.file, offset, req.query.raw === 'h264'); } catch (error) { clean(); throw error; } finally { if (audio) forget(audioId); }
    res.set({ 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(output).size, 'Cache-Control': 'no-store' });
    const stream = fs.createReadStream(output);
    stream.on('close', clean);
    stream.pipe(res);
  }));
}
