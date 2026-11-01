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
import { platformConfigured, instagramAccess, instagramName } from './social.js';

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
// Les Reels Instagram programmés depuis le cloud CUT (fondateurs) : la vidéo est copiée ici et part à l'heure dite.
// trial : '' (Reel normal), 'MANUAL' (Reel d'essai, montré d'abord aux non-abonnés ; on le partage à ses abonnés dans
// l'appli) ou 'SS_PERFORMANCE' (Reel d'essai partagé tout seul à ses abonnés s'il marche bien).
db.exec(`CREATE TABLE IF NOT EXISTS cut_reels (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cut_video_id INTEGER,
  name         TEXT NOT NULL,
  stored_as    TEXT NOT NULL,
  size         INTEGER NOT NULL,
  caption      TEXT NOT NULL DEFAULT '',
  trial        TEXT NOT NULL DEFAULT '',
  publish_at   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'scheduled',
  media_id     TEXT,
  permalink    TEXT,
  error        TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
)`);
const reelsDir = path.join(config.dataDir, 'cut-reels');
fs.mkdirSync(reelsDir, { recursive: true });
const TRIALS = ['', 'MANUAL', 'SS_PERFORMANCE'];
// Un envoi coupé par un redémarrage a peut-être abouti : il n'est pas refait tout seul, pour ne pas publier deux fois.
run(`UPDATE cut_reels SET status = 'failed', error = 'Envoi interrompu par un redémarrage du serveur : regarde sur Instagram avant de reprogrammer.' WHERE status = 'uploading'`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, testing ? 0 : ms));
/** Un Reel publié en trois temps : Instagram va chercher la vidéo ici (lien signé), la prépare, puis on la publie. */
async function publishReel(reel, { igId, token, call, graph }) {
  const videoUrl = config.publicUrl + reelUrl(reel.id, 3);
  const body = new URLSearchParams({ media_type: 'REELS', video_url: videoUrl, caption: reel.caption, access_token: token });
  if (reel.trial) body.set('trial_params', JSON.stringify({ graduation_strategy: reel.trial }));
  else body.set('share_to_feed', 'true');
  const { id: container } = await call(`${graph}/${igId}/media`, { method: 'POST', body });
  // Instagram prépare la vidéo (quelques secondes à quelques minutes) : on regarde toutes les 15 s, 10 minutes au plus.
  for (let k = 0; ; k++) {
    const { status_code: state } = await call(`${graph}/${container}?${new URLSearchParams({ fields: 'status_code', access_token: token })}`);
    if (state === 'FINISHED') break;
    if (state === 'ERROR' || state === 'EXPIRED' || k >= 40) throw new Error(state === 'ERROR' ? 'Instagram n\'a pas accepté la vidéo (format ou durée).' : 'Instagram n\'a pas fini de préparer la vidéo à temps.');
    await pause(15_000);
  }
  const { id } = await call(`${graph}/${igId}/media_publish`, { method: 'POST', body: new URLSearchParams({ creation_id: container, access_token: token }) });
  const { permalink = null } = await call(`${graph}/${id}?${new URLSearchParams({ fields: 'permalink', access_token: token })}`).catch(() => ({}));
  return { id, permalink };
}
let reelsBusy = false;
/** Publie les Reels dont l'heure est passée, un à la fois (appelé chaque minute). Un Reel publié ne garde plus son fichier ici. */
export async function publishDueReels() {
  if (reelsBusy) return;
  reelsBusy = true;
  try {
    for (const reel of all(`SELECT * FROM cut_reels WHERE status = 'scheduled' AND publish_at <= ? ORDER BY publish_at`, now())) {
      const access = await instagramAccess(reel.user_id).catch(() => null);
      if (!access) {
        // Instagram pas encore relié : le Reel attend. Après 12 h de retard, il ne part plus tout seul (pas de rafale le jour où l'on relie).
        if (now() - reel.publish_at > 12 * 3600_000) run(`UPDATE cut_reels SET status = 'failed', error = ? WHERE id = ?`, "Instagram n'était pas relié à l'heure prévue : relie-le, puis reprogramme ce Reel.", reel.id);
        else run(`UPDATE cut_reels SET error = ? WHERE id = ?`, 'En attente : relie ton compte Instagram pour qu\'il parte.', reel.id);
        continue;
      }
      run(`UPDATE cut_reels SET status = 'uploading', error = '' WHERE id = ?`, reel.id);
      try {
        const { id, permalink } = await publishReel(reel, access);
        run(`UPDATE cut_reels SET status = 'published', media_id = ?, permalink = ?, error = '' WHERE id = ?`, id, permalink, reel.id);
        fs.rmSync(path.join(reelsDir, reel.stored_as), { force: true });
      } catch (error) {
        run(`UPDATE cut_reels SET status = 'failed', error = ? WHERE id = ?`, String(error.message).replace(/^Instagram refuse : .*permission.*/i, 'Instagram refuse la publication : reconnecte ton compte Instagram (la permission de publier a été ajoutée).').slice(0, 300), reel.id);
      }
    }
  } finally {
    reelsBusy = false;
  }
}
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
// Un Short fait depuis le cloud CUT garde la vidéo d'où il vient : elle ne peut pas partir deux fois.
if (!all('PRAGMA table_info(youtube_videos)').some((c) => c.name === 'cut_video_id')) db.exec('ALTER TABLE youtube_videos ADD COLUMN cut_video_id INTEGER');
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
const shortUrl = (id) => { const e = now() + 6 * 3600_000; return `/api/cut/short/${id}?e=${e}&s=${sign(`cutshort.${id}.${e}`)}`; };
const reelUrl = (id, hours = 6) => { const e = now() + hours * 3600_000; return `/api/cut/reel/${id}?e=${e}&s=${sign(`cutreel.${id}.${e}`)}`; };
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
    const v = ownVideo(req);
    // Le titre et la description (page « Mes vidéos CUT ») ; le jour prévu (appweb), seulement s'il est donné.
    if (typeof req.body?.name === 'string') {
      const name = req.body.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').trim().slice(0, 100);
      if (!name) throw new HttpError(400, 'Titre attendu.');
      run('UPDATE cut_videos SET name = ? WHERE id = ?', name, v.id);
    }
    if (typeof req.body?.caption === 'string') run('UPDATE cut_videos SET caption = ? WHERE id = ?', req.body.caption.replace(/[\u0000-\u0009\u000b-\u001f]+/g, '').trim().slice(0, 2200), v.id);
    if ('day' in (req.body || {})) {
      const day = req.body.day ?? null;
      if (day !== null && !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(day))) throw new HttpError(400, 'Jour invalide.');
      run('UPDATE cut_videos SET scheduled_day = ? WHERE id = ?', day, v.id);
    }
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
    // Les mots-clés cachés du Short (« lyrics video », « rap fr »…) : 500 caractères au plus, comme YouTube.
    const tags = (Array.isArray(req.body?.tags) ? req.body.tags : []).map((t) => String(t).replace(/[<>,]/g, '').trim().slice(0, 30)).filter(Boolean).join(',').slice(0, 500);
    if (!(publishAt > now() - 60_000 && publishAt < now() + 366 * 86_400_000)) throw new HttpError(400, "Choisis une date à venir, dans l'année.");
    if (get(`SELECT COUNT(*) AS n FROM youtube_videos WHERE user_id = ? AND status != 'published'`, req.user.id).n >= 30) {
      throw new HttpError(400, 'Trente Shorts attendent déjà : laisse-en partir avant d\'en programmer d\'autres.');
    }
    // Déjà en Short (programmé, en attente ou publié) : on ne la renvoie pas. Les Shorts d'avant le lien se reconnaissent à leur nom.
    if (get('SELECT 1 FROM youtube_videos WHERE user_id = ? AND (cut_video_id = ? OR (cut_video_id IS NULL AND filename = ?))', req.user.id, v.id, v.name + '.mp4')) {
      throw new HttpError(409, 'Cette vidéo est déjà en Short (programmée ou publiée) : elle ne part pas deux fois.');
    }
    const storedAs = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(config.videosDir, { recursive: true });
    fs.copyFileSync(path.join(libDir, v.stored_as), path.join(config.videosDir, storedAs));
    const id = run(`INSERT INTO youtube_videos (user_id, stored_as, filename, mime, size, title, description, publish_at, status, tags, cut_video_id, created_at)
      VALUES (?, ?, ?, 'video/mp4', ?, ?, ?, ?, 'scheduled', ?, ?, ?)`, req.user.id, storedAs, v.name + '.mp4', v.size, title, description, publishAt, tags, v.id, now()).lastInsertRowid;
    res.status(201).json({ id, title, publishAt });
  }));
  // Les Shorts déjà programmés (leurs heures), pour trouver le prochain jour libre.
  app.get('/api/cut/youtube', requireUser, member, founder, wrap(async (req, res) => {
    const allowed = can(req.user, 'youtube');
    const shorts = allowed ? all('SELECT id, stored_as, filename, status, publish_at, cut_video_id FROM youtube_videos WHERE user_id = ? AND kind != ?', req.user.id, 'beat') : [];
    const names = new Map(all('SELECT id, name FROM cut_videos WHERE user_id = ?', req.user.id).map((v) => [v.name + '.mp4', v.id]));
    res.json({ allowed, channel: allowed ? channelOf(req.user.id) : null,
      scheduled: shorts.filter((x) => x.status === 'scheduled' || x.status === 'uploading').map((x) => x.publish_at),
      // Les vidéos du cloud CUT déjà en Short, et la lecture des Shorts pas encore partis (leur fichier attend ici).
      inShorts: [...new Set(shorts.map((x) => x.cut_video_id ?? names.get(x.filename)).filter(Boolean))],
      // L’heure prévue (ou l’état) du Short de chaque vidéo du cloud CUT, affichée sur son aperçu.
      slots: Object.fromEntries(shorts.map((x) => [x.cut_video_id ?? names.get(x.filename), { at: x.publish_at, status: x.status }]).filter(([id]) => id)),
      plays: Object.fromEntries(shorts.filter((x) => x.status !== 'published' && fs.existsSync(path.join(config.videosDir, x.stored_as))).map((x) => [x.id, shortUrl(x.id)])) });
  }));
  // La lecture d'un Short qui attend son heure, par lien signé (une balise <video> n'envoie pas de jeton).
  app.get('/api/cut/short/:id', (req, res) => {
    const id = Number(req.params.id) || 0, e = Number(req.query.e), sig = String(req.query.s || '');
    if (!(e > now()) || !same(sig, sign(`cutshort.${id}.${e}`))) throw new HttpError(403, 'Ce lien a expiré : rouvre le menu Shorts.');
    const x = get('SELECT * FROM youtube_videos WHERE id = ?', id);
    if (!x || !fs.existsSync(path.join(config.videosDir, x.stored_as))) throw new HttpError(404, 'Vidéo introuvable.');
    res.sendFile(path.join(config.videosDir, x.stored_as), { headers: { 'Content-Type': x.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  });

  // ——— Les Reels Instagram programmés (fondateurs, droit « instagram ») ———
  const reelsRight = (req, _res, next) => (can(req.user, 'instagram') ? next() : next(new HttpError(403, "Les Reels Instagram ne sont pas ouverts à ce compte.")));
  const reelView = (r) => ({ id: r.id, cutVideoId: r.cut_video_id, name: r.name, caption: r.caption, trial: r.trial, publishAt: r.publish_at, status: r.status, error: r.error, url: r.permalink || null,
    play: r.status !== 'published' && fs.existsSync(path.join(reelsDir, r.stored_as)) ? reelUrl(r.id) : null });
  const ownReel = (req) => {
    const r = get('SELECT * FROM cut_reels WHERE id = ? AND user_id = ?', Number(req.params.id) || 0, req.user.id);
    if (!r) throw new HttpError(404, 'Reel introuvable.');
    if (r.status === 'uploading') throw new HttpError(409, 'Ce Reel est en train de partir sur Instagram.');
    return r;
  };
  const reelFields = (body, r = {}) => {
    const caption = typeof body?.caption === 'string' ? body.caption.trim().slice(0, 2200) : r.caption ?? '';
    if ((caption.match(/#[\p{L}\p{N}_]+/gu) || []).length > 30) throw new HttpError(400, 'Instagram accepte 30 hashtags au plus.');
    const trial = body?.trial === undefined ? r.trial ?? '' : String(body.trial || '');
    if (!TRIALS.includes(trial)) throw new HttpError(400, 'Type de Reel inconnu.');
    const publishAt = body?.publishAt === undefined ? r.publish_at : Number(body.publishAt);
    if (!(publishAt > now() - 60_000 && publishAt < now() + 366 * 86_400_000)) throw new HttpError(400, "Choisis une date à venir, dans l'année.");
    return { caption, trial, publishAt };
  };
  app.get('/api/cut/reels', requireUser, member, founder, (req, res) => {
    const allowed = can(req.user, 'instagram'), reels = allowed ? all('SELECT * FROM cut_reels WHERE user_id = ? ORDER BY publish_at', req.user.id) : [];
    res.json({ allowed, configured: platformConfigured(), account: allowed ? instagramName(req.user.id) : null, reels: reels.map(reelView),
      inReels: [...new Set(reels.map((r) => r.cut_video_id).filter(Boolean))] });
  });
  app.post('/api/cut/library/:id/reel', requireUser, member, founder, reelsRight, (req, res) => {
    const v = ownVideo(req), { caption, trial, publishAt } = reelFields({ caption: v.caption, ...req.body });
    if (get(`SELECT COUNT(*) AS n FROM cut_reels WHERE user_id = ? AND status != 'published'`, req.user.id).n >= 30) {
      throw new HttpError(400, 'Trente Reels attendent déjà : laisse-en partir avant d\'en programmer d\'autres.');
    }
    if (get('SELECT 1 FROM cut_reels WHERE user_id = ? AND cut_video_id = ?', req.user.id, v.id)) {
      throw new HttpError(409, 'Cette vidéo est déjà en Reel (programmé ou publié) : elle ne part pas deux fois.');
    }
    const storedAs = crypto.randomBytes(16).toString('hex');
    fs.copyFileSync(path.join(libDir, v.stored_as), path.join(reelsDir, storedAs));
    const id = run(`INSERT INTO cut_reels (user_id, cut_video_id, name, stored_as, size, caption, trial, publish_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.user.id, v.id, v.name, storedAs, v.size, caption, trial, publishAt, now()).lastInsertRowid;
    res.status(201).json(reelView(get('SELECT * FROM cut_reels WHERE id = ?', id)));
  });
  // La description, le type (normal ou d'essai) et l'heure ; un Reel raté repart programmé.
  app.patch('/api/cut/reels/:id', requireUser, member, founder, reelsRight, (req, res) => {
    const r = ownReel(req);
    if (r.status === 'published') throw new HttpError(409, 'Ce Reel est déjà publié.');
    if (!fs.existsSync(path.join(reelsDir, r.stored_as))) throw new HttpError(410, 'La vidéo de ce Reel n\'est plus là : retire-le et reprogramme-la depuis le cloud CUT.');
    const { caption, trial, publishAt } = reelFields(req.body, r);
    run(`UPDATE cut_reels SET caption = ?, trial = ?, publish_at = ?, status = 'scheduled', error = '' WHERE id = ?`, caption, trial, publishAt, r.id);
    res.json(reelView(get('SELECT * FROM cut_reels WHERE id = ?', r.id)));
  });
  // Retire le Reel d'ici (un Reel publié reste sur Instagram : seule sa ligne disparaît, et la vidéo pourra repartir).
  app.delete('/api/cut/reels/:id', requireUser, member, founder, reelsRight, (req, res) => {
    const r = ownReel(req);
    fs.rmSync(path.join(reelsDir, r.stored_as), { force: true });
    run('DELETE FROM cut_reels WHERE id = ?', r.id);
    res.json({ ok: true });
  });
  // La vidéo d'un Reel par lien signé : Instagram vient la chercher là à l'heure dite ; la page la lit aussi (« Lire »).
  app.get('/api/cut/reel/:id', (req, res) => {
    const id = Number(req.params.id) || 0, e = Number(req.query.e), sig = String(req.query.s || '');
    if (!(e > now()) || !same(sig, sign(`cutreel.${id}.${e}`))) throw new HttpError(403, 'Ce lien a expiré.');
    const r = get('SELECT * FROM cut_reels WHERE id = ?', id);
    if (!r || !fs.existsSync(path.join(reelsDir, r.stored_as))) throw new HttpError(404, 'Vidéo introuvable.');
    res.sendFile(path.join(reelsDir, r.stored_as), { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  });

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
