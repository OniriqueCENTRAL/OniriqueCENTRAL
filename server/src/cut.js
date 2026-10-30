// ONIRIQUE CUT (site/cut) : le montage se fait dans le navigateur, qui enregistre la vidéo en temps réel. Le serveur
// la remet au format que TikTok, Instagram et YouTube acceptent sans broncher : MP4 H.264 + AAC, 1080 × 1920, 30 images
// par seconde constantes (l'enregistrement du navigateur a un rythme d'images variable). Réservé aux comptes qui ont
// ONIRIQUE CLOUD (membres ONIRIQUE et abonnés aux outils). Rien n'est gardé : les deux fichiers sont effacés aussitôt.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { HttpError, rateLimit, can } from './auth.js';
import { testing } from './mail.js';

const MAX_BYTES = 600 * 1024 * 1024; // une minute en 1080p tient largement dedans

export const cutArgs = (input, output) => ['-y', '-hide_banner', '-loglevel', 'error', '-i', input,
  '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-profile:v', 'high', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
  '-movflags', '+faststart', output];

function toMp4(input, output) {
  if (testing) { fs.copyFileSync(input, output); return Promise.resolve(); } // pas de ffmpeg pendant les tests
  return new Promise((resolve, reject) => execFile('ffmpeg', cutArgs(input, output), { timeout: 10 * 60_000 }, (error, _out, stderr) =>
    (error ? reject(new HttpError(500, 'La conversion en MP4 a échoué : ' + (String(stderr || error.message).trim().split('\n').pop().slice(0, 160) || 'ffmpeg'))) : resolve())));
}

export function mountCut(app, { requireUser, receiveFile, wrap }) {
  const dir = path.join(config.dataDir, 'cut');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true }); // restes d'un redémarrage

  const member = (req, _res, next) => (can(req.user, 'sounds') ? next()
    : next(new HttpError(403, 'ONIRIQUE CUT est réservé aux membres ONIRIQUE et aux abonnés CLOUD : onirique.store/cloud.')));

  app.post('/api/cut/mp4', requireUser, member, wrap(async (req, res) => {
    rateLimit(`cut:${req.user.id}`, 30, 3600_000);
    const file = await receiveFile(req, dir, MAX_BYTES);
    const input = path.join(dir, file.storedAs), output = input + '.mp4';
    const clean = () => { fs.rmSync(input, { force: true }); fs.rmSync(output, { force: true }); };
    try { await toMp4(input, output); } catch (error) { clean(); throw error; }
    res.set({ 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(output).size, 'Cache-Control': 'no-store' });
    const stream = fs.createReadStream(output);
    stream.on('close', clean);
    stream.pipe(res);
  }));
}
