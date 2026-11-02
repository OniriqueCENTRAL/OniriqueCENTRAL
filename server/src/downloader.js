// Downloader (page downloader) : l'audio d'une vidéo YouTube en MP3 ou WAV, par yt-dlp et FFmpeg installés sur le serveur.
// Réservé au droit « downloader » (fondateurs par défaut). Le fichier est fait dans un dossier jetable, envoyé, puis effacé.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './auth.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const MAX_SECONDS = 20 * 60;
const workDir = path.join(config.dataDir, 'downloader');
let running = 0; // un serveur modeste : deux extractions à la fois au plus

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

const ytdlp = (args) => new Promise((resolve, reject) => execFile('yt-dlp', args, { timeout: 8 * 60_000, maxBuffer: 4 * 1024 * 1024 },
  (error, stdout, stderr) => (error ? reject(Object.assign(error, { stderr: String(stderr) })) : resolve(String(stdout)))));

export function mountDownloader(app, { allowed, wrap }) {
  app.post('/api/downloader/youtube', allowed('downloader'), wrap(async (req, res) => {
    const id = youtubeId(req.body?.url);
    if (!id) throw new HttpError(400, 'Colle un lien youtube.com ou youtu.be valide.');
    const format = req.body?.format === 'wav' ? 'wav' : 'mp3';
    const kbps = ['128', '192', '320'].includes(String(req.body?.kbps)) ? String(req.body.kbps) : '320';
    if (running >= 2) throw new HttpError(429, 'Deux téléchargements sont déjà en cours : réessaie dans une minute.');
    running++;
    fs.mkdirSync(workDir, { recursive: true });
    const dir = fs.mkdtempSync(path.join(workDir, 'job-'));
    const clean = () => fs.rm(dir, { recursive: true, force: true }, () => {});
    try {
      try {
        await ytdlp(['--no-playlist', '--no-progress', '--quiet', '--no-warnings', '--match-filter', `duration <= ${MAX_SECONDS}`,
          '-f', 'bestaudio/best', '-x', '--audio-format', format, ...(format === 'mp3' ? ['--audio-quality', kbps + 'K'] : []),
          '-o', path.join(dir, '%(title).80B.%(ext)s'), '--', `https://www.youtube.com/watch?v=${id}`]);
      } catch (error) {
        const why = error.stderr || '';
        if (error.killed) throw new HttpError(504, "Le téléchargement a pris trop de temps.");
        if (/Sign in to confirm|bot/i.test(why)) throw new HttpError(502, 'YouTube bloque le serveur pour le moment : réessaie plus tard.');
        if (/Private|unavailable|removed/i.test(why)) throw new HttpError(404, 'Vidéo privée, supprimée ou indisponible.');
        throw new HttpError(502, "YouTube n'a pas rendu cette vidéo. Réessaie, ou mets à jour yt-dlp sur le serveur.");
      }
      const file = fs.readdirSync(dir).find((name) => name.endsWith('.' + format));
      if (!file) throw new HttpError(422, 'Vidéo trop longue (20 minutes au plus) ou sans piste audio.');
      res.set('Cache-Control', 'no-store');
      res.download(path.join(dir, file), file, () => { clean(); running--; });
    } catch (error) {
      clean(); running--;
      throw error;
    }
  }));
}
