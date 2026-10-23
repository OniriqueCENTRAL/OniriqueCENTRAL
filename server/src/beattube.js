// Les prods d'un pack publiées sur YouTube : pour chacune, une vidéo fabriquée ici (la pochette du pack sur son propre
// fond flouté, le son de la version en avant), puis mise dans la file des vidéos programmées de la chaîne du beatmaker
// (youtube.js), à l'heure choisie ou une par une, à quelques jours d'écart.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, get, all, run, now } from './db.js';
import { HttpError } from './auth.js';
import { testing } from './mail.js';
import { openListenLink } from './packsend.js';
import { videoFile, videoView } from './youtube.js';

// Le profil ou tableau Pinterest qu'un membre a relié, pour choisir l'image de ses vidéos parmi ses épingles.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('users') WHERE name = 'pinterest'`).get()) db.exec(`ALTER TABLE users ADD COLUMN pinterest TEXT NOT NULL DEFAULT ''`);

// Ce qu'une vidéo de prod ajoute aux Shorts : ses tags, sa visibilité, la prod d'où elle vient ; « beat » la distingue.
for (const [column, type] of [['tags', `TEXT NOT NULL DEFAULT ''`], ['privacy', `TEXT NOT NULL DEFAULT 'public'`], ['kind', `TEXT NOT NULL DEFAULT 'short'`], ['track_id', 'INTEGER']]) {
  if (!db.prepare(`SELECT 1 FROM pragma_table_info('youtube_videos') WHERE name = ?`).get(column)) db.exec(`ALTER TABLE youtube_videos ADD COLUMN ${column} ${type}`);
}

const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const clean = (text) => text.replace(/[<>]/g, ''); // YouTube refuse < et > dans un titre ou une description
/** Le modèle rempli pour une prod : {titre}, {bpm}, {cle}, {artiste}, {lien} ; une variable vide disparaît proprement. */
export function fillTemplate(template, values) {
  return template.replace(/\{(titre|bpm|cle|artiste|lien)\}/gi, (_, k) => values[k.toLowerCase()] ?? '')
    .replace(/\(\s*\)|\[\s*\]/g, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([,.)\]])/g, '$1').trim();
}

// La vidéo : 1920 × 1080, deux images par seconde (une image fixe n'a pas besoin de plus), le son en AAC 320 kb/s.
const FILTER = '[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=40:2,eq=brightness=-0.25[bg];'
  + '[0:v]scale=880:880:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]';
function render(cover, audio, out, seconds) {
  if (testing) { fs.copyFileSync(audio, out); return Promise.resolve(); } // pas de ffmpeg pendant les tests
  const image = cover ? ['-loop', '1', '-framerate', '2', '-i', cover] : ['-f', 'lavfi', '-i', 'color=c=0x0D0809:s=1920x1080:r=2'];
  const args = ['-y', '-hide_banner', '-loglevel', 'error', ...image, '-i', audio, '-filter_complex', cover ? FILTER : '[0:v]format=yuv420p[v]',
    '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-r', '2',
    // La durée du son, quand elle est connue : sinon l'image fixe dépasse la fin de quelques secondes.
    '-c:a', 'aac', '-b:a', '320k', '-shortest', ...(seconds > 0 ? ['-t', seconds.toFixed(2)] : []), '-movflags', '+faststart', out];
  return new Promise((resolve, reject) => execFile('ffmpeg', args, { timeout: 15 * 60_000 }, (error, _out, stderr) =>
    (error ? reject(new Error(String(stderr || error.message).trim().split('\n').pop().slice(0, 200) || 'ffmpeg a échoué.')) : resolve())));
}

// Les vidéos se fabriquent une par une (le serveur n'a qu'un processeur) ; celles coupées par un redémarrage reprennent.
let rendering = false;
async function renderQueue(soundsDir) {
  if (rendering) return;
  rendering = true;
  try {
    for (let v; (v = get(`SELECT * FROM youtube_videos WHERE status = 'rendering' ORDER BY id LIMIT 1`));) {
      const row = get(`SELECT t.id, COALESCE(t.video_cover, p.cover) AS cover, ver.stored_as, ver.duration FROM sound_tracks t JOIN sound_projects p ON p.id = t.project_id
        JOIN sound_versions ver ON ver.id = t.current_id WHERE t.id = ?`, v.track_id);
      try {
        if (!row) throw new Error('La prod a été supprimée.');
        const cover = row.cover ? path.join(config.mediaDir, path.basename(row.cover)) : null;
        await render(cover && fs.existsSync(cover) ? cover : null, path.join(soundsDir, row.stored_as), videoFile(v), row.duration);
        run(`UPDATE youtube_videos SET status = ?, size = ? WHERE id = ?`, v.publish_at ? 'scheduled' : 'draft', fs.statSync(videoFile(v)).size, v.id);
      } catch (error) {
        run(`UPDATE youtube_videos SET status = 'failed', error = ? WHERE id = ?`, `Vidéo non fabriquée : ${error.message}`.slice(0, 300), v.id);
      }
    }
  } finally {
    rendering = false;
  }
}

//------------------------------------------------------------------------------ Pinterest
// Sans compte développeur : les flux publics d'un profil (feed.rss) ou d'un tableau (<tableau>.rss), et la page d'une
// épingle pour son image en grand. Les images viennent toujours de i.pinimg.com.
const PIN_IMAGE = /^https:\/\/i\.pinimg\.com\/[\w/.-]+\.(jpg|jpeg|png|webp)$/i;
const pinterestGet = (url) => fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ONIRIQUE)' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
/** Un lien Pinterest (profil, tableau, épingle, pin.it) ou un nom de compte → son flux RSS, ou l'épingle seule. */
export function pinterestSource(value) {
  const text = String(value || '').trim();
  if (/^@?[\w.-]{1,40}$/.test(text)) return { feed: `https://www.pinterest.com/${text.replace(/^@/, '')}/feed.rss` };
  let u;
  try { u = new URL(/^https?:\/\//.test(text) ? text : `https://${text}`); } catch { return null; }
  if (u.hostname === 'pin.it') return { pin: u.href };
  if (!/(^|\.)pinterest\.[a-z.]+$/.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] === 'pin' && /^\d+$/.test(parts[1] || '')) return { pin: `https://www.pinterest.com/pin/${parts[1]}/` };
  if (parts.length === 1) return { feed: `https://www.pinterest.com/${parts[0]}/feed.rss` };
  if (parts.length >= 2) return { feed: `https://www.pinterest.com/${parts[0]}/${parts[1].replace(/\.rss$/, '')}.rss` };
  return null;
}
async function pinterestImages(source) {
  if (source.pin) {
    const html = await (await pinterestGet(source.pin)).text();
    const og = html.match(/<meta[^>]+content="(https:\/\/i\.pinimg\.com\/[^"]+)"[^>]*property="og:image"/)?.[1]
      || html.match(/property="og:image"[^>]*content="(https:\/\/i\.pinimg\.com\/[^"]+)"/)?.[1];
    return og ? [{ url: og, thumb: og.replace(/\/(originals|\d+x)\//, '/236x/'), link: source.pin }] : [];
  }
  const response = await pinterestGet(source.feed);
  if (!response.ok) throw new HttpError(404, "Pinterest ne trouve pas ce profil ou ce tableau : vérifie qu'il est public.");
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const thumb = item.match(/https:\/\/i\.pinimg\.com\/[\w/.-]+\.(?:jpg|jpeg|png|webp)/i)?.[0];
    return thumb && { url: thumb.replace(/\/\d+x\//, '/736x/'), thumb, link: item.match(/<link>([^<]+)<\/link>/)?.[1] || '' };
  }).filter(Boolean).slice(0, 60);
}
/** Une image téléchargée (Pinterest) gardée comme une image envoyée : PNG, JPEG ou WebP vérifié, 8 Mo au plus. */
async function saveImage(url) {
  const response = await pinterestGet(url);
  const data = Buffer.from(await response.arrayBuffer());
  if (!response.ok || data.length > 8 * 1024 * 1024) throw new HttpError(400, "Cette image n'a pas pu être récupérée.");
  const ext = data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png' : data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? 'jpg'
    : data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : null;
  if (!ext) throw new HttpError(400, "Ce n'est pas une image PNG, JPEG ou WebP.");
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(config.mediaDir, name), data);
  return name;
}

export function mountBeatTube(app, { me, track, soundsDir, wrap, receiveImage, removeMedia }) {
  // L'image de la vidéo d'une prod : envoyée, prise sur Pinterest, ou retirée (la pochette du pack reprend sa place).
  const setCover = (t, name) => {
    run('UPDATE sound_tracks SET video_cover = ? WHERE id = ?', name, t.id);
    if (t.video_cover && t.video_cover !== name) removeMedia(t.video_cover);
    return { videoCover: name ? `/api/media/${name}` : null };
  };
  const ownTrack = (req) => {
    const t = track(req, req.params.id);
    if (t.owner_id !== req.user.id) throw new HttpError(403, "Seul l'auteur du pack choisit l'image de ses vidéos.");
    return t;
  };
  app.put('/api/me/sounds/tracks/:id/video-cover', ...me, wrap(async (req, res) => {
    const t = ownTrack(req);
    res.json(setCover(t, await receiveImage(req, 8 * 1024 * 1024)));
  }));
  app.post('/api/me/sounds/tracks/:id/video-cover', ...me, wrap(async (req, res) => {
    const t = ownTrack(req), url = String(req.body?.url || '');
    if (!PIN_IMAGE.test(url)) throw new HttpError(400, 'Image Pinterest attendue.');
    res.json(setCover(t, await saveImage(url)));
  }));
  app.delete('/api/me/sounds/tracks/:id/video-cover', ...me, (req, res) => res.json(setCover(ownTrack(req), null)));
  // Pinterest : le profil ou tableau relié (gardé sur le compte) et ses dernières épingles ; un lien d'épingle donne son image.
  app.get('/api/me/sounds/pinterest', ...me, wrap(async (req, res) => {
    const saved = get('SELECT pinterest FROM users WHERE id = ?', req.user.id).pinterest;
    const source = saved && pinterestSource(saved);
    res.json({ source: saved, images: source ? await pinterestImages(source).catch(() => []) : [] });
  }));
  app.post('/api/me/sounds/pinterest', ...me, wrap(async (req, res) => {
    const text = str(req.body?.source, 300), source = pinterestSource(text);
    if (!source) throw new HttpError(400, 'Colle le lien de ton profil, d\'un tableau ou d\'une épingle Pinterest.');
    const images = await pinterestImages(source);
    if (!images.length) throw new HttpError(404, 'Aucune image trouvée : le profil ou le tableau est-il public ?');
    if (source.feed) run('UPDATE users SET pinterest = ? WHERE id = ?', text, req.user.id);
    res.json({ source: source.feed ? text : get('SELECT pinterest FROM users WHERE id = ?', req.user.id).pinterest, images, pin: !!source.pin });
  }));

  const kick = () => { const job = renderQueue(soundsDir).catch((error) => console.error('[youtube] vidéos :', error.message)); return testing ? job : null; };
  if (!testing) setTimeout(kick, 5000).unref();
  const mine = (userId) => all(`SELECT * FROM youtube_videos WHERE user_id = ? AND kind = 'beat' ORDER BY COALESCE(publish_at, created_at) DESC, id DESC LIMIT 100`, userId)
    .map((v) => ({ ...videoView(v), trackId: v.track_id, privacy: v.privacy }));

  app.get('/api/me/sounds/youtube', ...me, (req, res) => {
    const account = get('SELECT channel_title FROM youtube_accounts WHERE user_id = ?', req.user.id);
    res.json({ configured: !!(config.googleClientId && config.googleClientSecret), channel: account?.channel_title || null, videos: mine(req.user.id) });
  });

  // Programmer des prods : une vidéo par prod, le modèle de titre et de description rempli pour chacune, la première à
  // publishAt (ou dès qu'elle est prête), les suivantes tous les « every » jours.
  app.post('/api/me/sounds/youtube', ...me, wrap(async (req, res) => {
    if (!get('SELECT 1 FROM youtube_accounts WHERE user_id = ?', req.user.id)) throw new HttpError(400, "Connecte d'abord ta chaîne YouTube.");
    const ids = Array.isArray(req.body.trackIds) ? [...new Set(req.body.trackIds.map(Number).filter(Number.isInteger))] : [];
    if (!ids.length || ids.length > 30) throw new HttpError(400, 'Choisis de 1 à 30 prods.');
    const waiting = get(`SELECT COUNT(*) AS n FROM youtube_videos WHERE user_id = ? AND status NOT IN ('published', 'failed')`, req.user.id).n;
    if (waiting + ids.length > 30) throw new HttpError(400, `Trente vidéos au plus en attente : il en reste ${Math.max(0, 30 - waiting)} à programmer.`);
    const titleTemplate = str(req.body.title, 200), descTemplate = str(req.body.description, 5000);
    if (!titleTemplate) throw new HttpError(400, 'Écris le modèle du titre.');
    const tags = str(req.body.tags, 500).split(',').map((t) => clean(t).trim()).filter(Boolean).join(',');
    const privacy = req.body.privacy === 'unlisted' ? 'unlisted' : 'public';
    const every = Math.max(0, Math.min(30, Math.round(Number(req.body.every) || 0)));
    const start = req.body.publishAt ? Number(req.body.publishAt) : null;
    if (start !== null && !(start > now() - 60_000 && start < now() + 366 * 86_400_000)) throw new HttpError(400, "Choisis une date à venir, dans l'année.");
    const rows = ids.map((tid) => track(req, tid));
    if (rows.some((t) => t.owner_id !== req.user.id)) throw new HttpError(403, "Seul l'auteur du pack publie ses prods sur sa chaîne.");
    const created = rows.map((t, i) => {
      const p = get('SELECT * FROM sound_projects WHERE id = ?', t.project_id);
      const link = openListenLink(p, 'YouTube');
      const values = { titre: t.title, bpm: t.bpm ? String(t.bpm) : '', cle: t.music_key || '', artiste: p.artist || req.user.name || '', lien: `${config.siteUrl}/ecoute?t=${link.token}` };
      // Un titre propre à la prod (gardé pour la suite) passe avant le modèle ; il peut lui aussi contenir {titre}, {bpm}…
      const own = typeof req.body.titles?.[t.id] === 'string' ? str(req.body.titles[t.id], 200) : t.video_title;
      if (own !== t.video_title) run('UPDATE sound_tracks SET video_title = ? WHERE id = ?', own, t.id);
      const title = clean(fillTemplate(own || titleTemplate, values)).slice(0, 100);
      if (!title) throw new HttpError(400, `Le titre de « ${t.title} » serait vide.`);
      const publishAt = start === null ? (every ? now() + i * every * 86_400_000 : now()) : start + i * every * 86_400_000;
      return run(`INSERT INTO youtube_videos (user_id, stored_as, filename, mime, size, title, description, publish_at, status, tags, privacy, kind, track_id, created_at)
        VALUES (?, ?, ?, 'video/mp4', 0, ?, ?, ?, 'rendering', ?, ?, 'beat', ?, ?)`, req.user.id, `${crypto.randomBytes(16).toString('hex')}.mp4`,
        `${t.title}.mp4`, title, clean(fillTemplate(descTemplate, values)), publishAt, tags, privacy, t.id, now()).lastInsertRowid;
    });
    await kick();
    res.status(202).json({ count: created.length, videos: mine(req.user.id) });
  }));

  // Retirer une vidéo de la file (une vidéo déjà publiée reste sur YouTube : seule sa ligne disparaît).
  app.delete('/api/me/sounds/youtube/:id', ...me, (req, res) => {
    const v = get(`SELECT * FROM youtube_videos WHERE id = ? AND user_id = ? AND kind = 'beat'`, Number(req.params.id) || 0, req.user.id);
    if (!v) throw new HttpError(404, 'Vidéo introuvable.');
    if (v.status === 'uploading' || v.status === 'rendering') throw new HttpError(409, 'Cette vidéo est en cours : attends quelques instants.');
    fs.rmSync(videoFile(v), { force: true });
    run('DELETE FROM youtube_videos WHERE id = ?', v.id);
    res.json({ videos: mine(req.user.id) });
  });
}
