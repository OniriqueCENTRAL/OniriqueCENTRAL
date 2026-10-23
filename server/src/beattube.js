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
      const row = get(`SELECT t.id, p.cover, ver.stored_as, ver.duration FROM sound_tracks t JOIN sound_projects p ON p.id = t.project_id
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

export function mountBeatTube(app, { me, track, soundsDir, wrap }) {
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
      const title = clean(fillTemplate(titleTemplate, values)).slice(0, 100);
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
