// Downloader (page downloader) : l'audio d'une vidéo YouTube en MP3 ou WAV, par yt-dlp et FFmpeg installés sur le serveur.
// Ouvert à tous ; sans compte ou avec un compte gratuit, un téléchargement par minute ; les rôles ONIRIQUE et au-dessus,
// sans limite. Le fichier est fait dans un dossier jetable, envoyé, puis effacé.
// Comme l'outil BPM et tonalité, le blanc du début (sous -60 dB) est retiré : le son démarre sur le premier échantillon.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './auth.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const MAX_SECONDS = 20 * 60;
const SILENCE = 0.001; // -60 dB, le seuil de l'outil BPM et tonalité
const SCAN_SECONDS = 30; // le blanc se cherche dans les 30 premières secondes
const workDir = path.join(config.dataDir, 'downloader');
const MAX_RUNNING = 3; // un serveur modeste : trois extractions à la fois au plus
const WAIT_MS = 60_000; // sans compte ou compte gratuit : un téléchargement par minute
let running = 0;
const lastStart = new Map(); // compte (u12) ou IP → heure du dernier téléchargement

/** Millisecondes à attendre avant le prochain téléchargement de cette clé ; 0 si c'est permis tout de suite. */
export function waitFor(key, t = Date.now()) {
  const last = lastStart.get(key);
  return last && t - last < WAIT_MS ? WAIT_MS - (t - last) : 0;
}
setInterval(() => { const t = Date.now(); for (const [key, last] of lastStart) if (t - last >= WAIT_MS) lastStart.delete(key); }, WAIT_MS).unref();

/** L'identifiant de la vidéo d'un lien youtube.com / youtu.be ; '' sinon. */
export function youtubeId(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { return ''; }
  if (!['http:', 'https:'].includes(url.protocol) || !HOSTS.has(url.hostname.toLowerCase())) return '';
  const id = url.hostname.toLowerCase() === 'youtu.be' ? url.pathname.split('/')[1]
    : url.pathname === '/watch' ? url.searchParams.get('v')
    : (url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/) || [])[1];
  return VIDEO_ID.test(id || '') ? id : '';
}

/** Le nombre d'images (échantillons par voie) avant le premier son au-dessus du seuil, dans du f32le entrelacé. */
export function leadIn(pcm, channels) {
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > SILENCE) return Math.floor(i / channels);
  return 0; // tout est muet au début : on ne coupe rien
}

/** Un titre de vidéo utilisable comme nom de fichier sur Windows, Mac et dans un DAW. */
export const fileTitle = (title) => String(title || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'YouTube';

const run = (bin, args, options = {}) => new Promise((resolve, reject) => execFile(bin, args,
  { timeout: 8 * 60_000, maxBuffer: 64 * 1024 * 1024, ...options },
  (error, stdout, stderr) => (error ? reject(Object.assign(error, { stderr: String(stderr) })) : resolve(stdout))));

export function mountDownloader(app, { optionalUser, wrap }) {
  app.post('/api/downloader/youtube', wrap(async (req, res) => {
    const user = optionalUser(req);
    const free = !user || user.role === 'user'; // ONIRIQUE (vip), partenaires, admins, fondateurs : sans limite
    const key = user ? 'u' + user.id : 'ip:' + req.ip;
    const id = youtubeId(req.body?.url);
    if (!id) throw new HttpError(400, 'Colle un lien youtube.com ou youtu.be valide.');
    const format = req.body?.format === 'wav' ? 'wav' : 'mp3';
    const kbps = ['128', '192', '320'].includes(String(req.body?.kbps)) ? String(req.body.kbps) : '320';
    const wait = free ? waitFor(key) : 0;
    if (wait) throw new HttpError(429, `Un téléchargement par minute sans le rôle ONIRIQUE : réessaie dans ${Math.ceil(wait / 1000)} s.`);
    if (running >= MAX_RUNNING) throw new HttpError(429, "Le serveur est occupé par d'autres téléchargements : réessaie dans une minute.");
    running++;
    if (free) lastStart.set(key, Date.now());
    fs.mkdirSync(workDir, { recursive: true });
    const dir = fs.mkdtempSync(path.join(workDir, 'job-'));
    const clean = () => fs.rm(dir, { recursive: true, force: true }, () => {});
    try {
      // 1. Le flux audio d'origine, sans conversion (un seul encodage, à la fin).
      let title;
      try {
        title = String(await run('yt-dlp', ['--no-playlist', '--no-progress', '--no-warnings', '--no-simulate', '-O', '%(title)s',
          '--match-filter', `duration <= ${MAX_SECONDS}`, '-f', 'bestaudio/best', '-o', path.join(dir, 'source.%(ext)s'),
          '--', `https://www.youtube.com/watch?v=${id}`], { encoding: 'utf8' })).trim();
      } catch (error) {
        const why = error.stderr || '';
        if (error.killed) throw new HttpError(504, 'Le téléchargement a pris trop de temps.');
        if (/Sign in to confirm|bot/i.test(why)) throw new HttpError(502, 'YouTube bloque le serveur pour le moment : réessaie plus tard.');
        if (/Private|unavailable|removed/i.test(why)) throw new HttpError(404, 'Vidéo privée, supprimée ou indisponible.');
        // La raison donnée par yt-dlp (sa ligne ERROR), pour savoir quoi corriger.
        const reason = (why.match(/ERROR:[^\n]*/) || [''])[0].replace(/^ERROR:\s*(\[[^\]]*\]\s*)*/, '').slice(0, 200);
        console.error('yt-dlp :', why.slice(-800));
        throw new HttpError(502, "YouTube n'a pas rendu cette vidéo." + (reason ? ' Raison : ' + reason : ' Réessaie dans un moment.'));
      }
      const source = fs.readdirSync(dir).find((name) => name.startsWith('source.'));
      if (!source) throw new HttpError(422, 'Vidéo trop longue (20 minutes au plus) ou sans piste audio.');
      const input = path.join(dir, source);

      // 2. Le blanc du début, mesuré à la fréquence du fichier rendu (48 kHz en WAV, 44,1 kHz en MP3).
      const rate = format === 'wav' ? 48000 : 44100, channels = 2;
      const head = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', input, '-t', String(SCAN_SECONDS), '-vn',
        '-ac', String(channels), '-ar', String(rate), '-f', 'f32le', 'pipe:1'], { encoding: 'buffer' });
      const lead = leadIn(head, channels);

      // 3. Le fichier final, coupé à l'échantillon près. Le MP3 garde l'en-tête LAME qui dit aux logiciels d'ignorer
      //    le court silence que tout encodeur MP3 ajoute : il tombe sur la grille dans un DAW.
      const output = path.join(dir, 'out.' + format);
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-ac', String(channels),
        '-af', `aresample=${rate},atrim=start_sample=${lead},asetpts=PTS-STARTPTS`, '-map_metadata', '-1',
        ...(format === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', kbps + 'k', '-id3v2_version', '3', '-metadata', `title=${title}`] : ['-c:a', 'pcm_s24le']),
        output]);

      res.set({ 'Cache-Control': 'no-store', 'X-Title': encodeURIComponent(title), 'X-Lead-Ms': String(Math.round(lead / rate * 1000)) });
      res.download(output, `${fileTitle(title)}.${format}`, () => { clean(); running--; });
    } catch (error) {
      clean(); running--;
      if (free) lastStart.delete(key); // un téléchargement raté ne compte pas
      throw error;
    }
  }));
}
