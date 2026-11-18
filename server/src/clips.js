// CLIPS : les clips partagés depuis ONIRIQUE CENTRAL, comme sur Medal. Le clip arrive en WebM, ffmpeg en fait un MP4
// (H.264 et AAC, lu partout) et une image ; sa page onirique.store/clip?c=… porte les balises qui font jouer la vidéo
// directement dans Discord. Le lien ne s'arrête pas : seul son auteur le supprime. Réservé, comme la WATCHPARTY, aux
// membres ONIRIQUE, beta-testeurs, équipe et fondateurs (nginx envoie /clip ici, voir deploy/onirique-securite).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { config } from './config.js';
import { db, get, all, run, now, setting } from './db.js';
import { HttpError, rateLimit, requireUser, requireVerified, optionalUser } from './auth.js';
import { isMember } from './watchparty.js';
import { BOTS } from './linkpage.js';

db.exec(`
CREATE TABLE IF NOT EXISTS clips (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'wait',
  size       INTEGER NOT NULL DEFAULT 0,
  width      INTEGER NOT NULL DEFAULT 0,
  height     INTEGER NOT NULL DEFAULT 0,
  duration   REAL NOT NULL DEFAULT 0,
  views      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS clips_user ON clips(user_id, created_at);
`);

export const CLIP_MAX = 600e6; // 2 minutes en 1080p à 60 i/s font moins de 200 Mo
const dir = path.join(config.dataDir, 'clips');
fs.mkdirSync(dir, { recursive: true });
const fileOf = (id, ext) => path.join(dir, `${id}.${ext}`);
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const escapeHtml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
const pageUrl = (id) => `${config.siteUrl}/clip?c=${id}`;
const mediaUrl = (id, file) => `${config.siteUrl}/api/clips/${id}/${file}`;

const sh = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { timeout: 10 * 60_000, maxBuffer: 4e6 },
  (error, stdout, stderr) => (error ? reject(new Error(String(stderr || error.message).trim().slice(-300))) : resolve(stdout))));

/** WebM vers MP4 lisible partout (1080p au plus, 60 i/s au plus), son en AAC s'il y en a, puis l'image et les mesures. */
export async function transcode(id) {
  const src = fileOf(id, 'src'), mp4 = fileOf(id, 'mp4');
  await sh('nice', ['-n', '10', 'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', "scale=-2:'min(1080,ih)'", '-fpsmax', '60', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-threads', '4', mp4]);
  await sh('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', mp4, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', fileOf(id, 'jpg')])
    .catch(() => sh('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', mp4, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', fileOf(id, 'jpg')]));
  const probe = JSON.parse(await sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', mp4]));
  return { width: probe.streams?.[0]?.width || 0, height: probe.streams?.[0]?.height || 0, duration: Number(probe.format?.duration) || 0, size: fs.statSync(mp4).size };
}

// Une conversion à la fois : le site reste vif pendant qu'un clip se prépare.
let queue = Promise.resolve();
function prepare(id) {
  queue = queue.then(async () => {
    try {
      const m = await transcode(id);
      run("UPDATE clips SET status = 'ready', width = ?, height = ?, duration = ?, size = ? WHERE id = ?", m.width, m.height, m.duration, m.size, id);
    } catch (error) {
      console.error(`Clip ${id} :`, error.message);
      run("UPDATE clips SET status = 'failed' WHERE id = ?", id);
      for (const ext of ['mp4', 'jpg']) fs.rmSync(fileOf(id, ext), { force: true });
    }
    fs.rmSync(fileOf(id, 'src'), { force: true });
  });
  return queue;
}

const summary = (c) => ({ id: c.id, title: c.title, status: c.status, author: c.author ?? undefined, views: c.views, duration: c.duration,
  width: c.width, height: c.height, size: c.size, createdAt: c.created_at, url: pageUrl(c.id),
  video: c.status === 'ready' ? mediaUrl(c.id, 'video.mp4') : null, poster: c.status === 'ready' ? mediaUrl(c.id, 'poster.jpg') : null });
const withAuthor = (id) => get('SELECT clips.*, users.name AS author FROM clips JOIN users ON users.id = clips.user_id WHERE clips.id = ?', String(id));

function pageHtml(c) {
  const title = c ? (c.title || `Clip de ${c.author || 'ONIRIQUE'}`) : 'Clip introuvable';
  const description = c ? `Clip de ${c.author || 'ONIRIQUE'} · fait avec ONIRIQUE CENTRAL` : '';
  const video = c && mediaUrl(c.id, 'video.mp4'), poster = c && mediaUrl(c.id, 'poster.jpg');
  const date = c && new Date(c.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const meta = c ? `
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="video.other">
<meta property="og:site_name" content="ONIRIQUE CLIPS">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(pageUrl(c.id))}">
<meta property="og:image" content="${escapeHtml(poster)}">
<meta property="og:video" content="${escapeHtml(video)}">
<meta property="og:video:secure_url" content="${escapeHtml(video)}">
<meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="${c.width}">
<meta property="og:video:height" content="${c.height}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:image" content="${escapeHtml(poster)}">` : '';
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)} · ONIRIQUE</title>${meta}
<meta name="robots" content="noindex">
<meta name="theme-color" content="#e5384a">
<link rel="icon" type="image/png" href="/assets/favicon.png?v=2">
<link rel="stylesheet" href="/assets/fonts.css">
<style>
html, body { margin: 0; min-height: 100%; background: #0d0809; color: #f4ecec; font: 500 15px/1.5 'Hanken Grotesk', system-ui, sans-serif; }
body { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; background: radial-gradient(1200px 600px at 50% -10%, rgba(229, 56, 74, .18), transparent 70%), #0d0809; }
main { flex: 1; width: min(1100px, 100% - 32px); margin: 0 auto; padding: 28px 0 40px; display: flex; flex-direction: column; gap: 16px; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.brand { color: #f4ecec; text-decoration: none; font: 800 15px 'Unbounded', sans-serif; letter-spacing: .06em; }
.brand i { font-style: normal; color: #e5384a; }
video { width: 100%; max-height: 72vh; background: #000; border-radius: 12px; border: 1px solid rgba(255, 235, 238, .1); }
h1 { margin: 4px 0 0; font: 800 clamp(18px, 3vw, 26px)/1.25 'Unbounded', sans-serif; overflow-wrap: anywhere; }
.by { color: #a8939a; }
.cta { color: #f4ecec; text-decoration: none; padding: 8px 14px; border: 1px solid rgba(255, 235, 238, .18); border-radius: 999px; font-size: 13px; white-space: nowrap; }
.cta:hover { border-color: #e5384a; }
.missing { margin: auto; text-align: center; color: #a8939a; }
.missing a { color: #e5384a; }
</style>
</head>
<body>
<main>
<div class="top"><a class="brand" href="${config.siteUrl}">ONIRIQUE <i>CLIPS</i></a><a class="cta" href="${config.siteUrl}/telechargement">Clipper avec ONIRIQUE CENTRAL</a></div>
${c ? `<video src="${escapeHtml(video)}" poster="${escapeHtml(poster)}" controls playsinline preload="metadata"></video>
<div><h1>${escapeHtml(title)}</h1><div class="by">${escapeHtml(c.author || 'ONIRIQUE')} · ${escapeHtml(date)} · ${c.views} vue${c.views > 1 ? 's' : ''}</div></div>`
    : `<p class="missing">Ce clip n'existe pas, ou plus.<br><a href="${config.siteUrl}">onirique.store</a></p>`}
</main>
</body>
</html>`;
}

export function mountClips(app, { receiveFile, wrap }) {
  // Le clip envoyé tel quel (corps de la requête), avec son titre ; la réponse arrive tout de suite, la conversion suit.
  app.post('/api/clips', requireVerified, wrap(async (req, res) => {
    if (!isMember(req.user)) throw new HttpError(403, 'Les clips sont réservés aux membres ONIRIQUE, aux beta-testeurs et aux fondateurs.');
    rateLimit(`clips:${req.user.id}`, 60, 86400_000);
    const length = Number(req.headers['content-length']);
    if (!Number.isFinite(length) || length <= 0) throw new HttpError(411, 'Taille du clip inconnue.');
    if (length > CLIP_MAX) throw new HttpError(413, 'Un clip fait 600 Mo au plus.');
    const disk = fs.statfsSync(config.dataDir), total = disk.blocks * disk.bsize;
    if ((total - disk.bavail * disk.bsize + length * 2) / total > setting('sounds_disk_max', 0.8)) throw new HttpError(507, 'Le disque du serveur est presque plein : réessaie plus tard.');
    const stored = await receiveFile(req, dir, CLIP_MAX);
    const id = crypto.randomBytes(8).toString('base64url');
    fs.renameSync(path.join(dir, stored.storedAs), fileOf(id, 'src'));
    run('INSERT INTO clips (id, user_id, title, size, created_at) VALUES (?, ?, ?, ?, ?)', id, req.user.id, clean(String(req.query.title || ''), 100), stored.size, now());
    prepare(id);
    res.status(202).json(summary(withAuthor(id)));
  }));

  app.get('/api/clips', requireUser, (req, res) => {
    res.json(all('SELECT * FROM clips WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', req.user.id).map(summary));
  });

  // Prêt : visible de tous ; en préparation ou raté : seulement de son auteur (qui attend la fin de la conversion).
  app.get('/api/clips/:id', (req, res) => {
    const c = withAuthor(req.params.id);
    if (!c || (c.status !== 'ready' && optionalUser(req)?.id !== c.user_id)) throw new HttpError(404, "Ce clip n'existe pas, ou plus.");
    res.json(summary(c));
  });

  app.delete('/api/clips/:id', requireUser, (req, res) => {
    const c = get('SELECT * FROM clips WHERE id = ? AND user_id = ?', String(req.params.id), req.user.id);
    if (!c) throw new HttpError(404, "Ce clip n'existe pas, ou plus.");
    run('DELETE FROM clips WHERE id = ?', c.id);
    for (const ext of ['src', 'mp4', 'jpg']) fs.rmSync(fileOf(c.id, ext), { force: true });
    res.json({ ok: true });
  });

  // La vidéo et son image : publiques, jamais modifiées (un clip coupé à nouveau est un autre clip).
  for (const [file, ext] of [['video.mp4', 'mp4'], ['poster.jpg', 'jpg']]) {
    app.get(`/api/clips/:id/${file}`, (req, res) => {
      const c = get("SELECT id FROM clips WHERE id = ? AND status = 'ready'", String(req.params.id));
      if (!c) throw new HttpError(404, "Ce clip n'existe pas, ou plus.");
      res.sendFile(fileOf(c.id, ext), { maxAge: '365d', immutable: true });
    });
  }

  // La page du lien, avec l'aperçu qui fait jouer la vidéo dans Discord. Une vue par personne et par demi-heure, sans les robots.
  app.get(/^\/clip(\.html)?$/, (req, res) => {
    const c = withAuthor(String(req.query.c || ''));
    const ok = c && c.status === 'ready' ? c : null;
    if (ok && !BOTS.test(req.get('user-agent') || '')) {
      try { rateLimit(`clip-view:${req.ip}:${ok.id}`, 1, 30 * 60_000); run('UPDATE clips SET views = views + 1 WHERE id = ?', ok.id); ok.views += 1; } catch { /* déjà comptée */ }
    }
    res.status(ok ? 200 : 404).set('Cache-Control', 'no-cache').type('html').send(pageHtml(ok));
  });
}
