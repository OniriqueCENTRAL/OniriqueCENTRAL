// ONIRIQUE CUT (site/cut) : le montage se fait dans le navigateur, qui enregistre la vidéo en temps réel. Le serveur
// la remet au format que TikTok, Instagram et YouTube acceptent sans broncher : MP4 H.264 + AAC, 1080 × 1920, 30 images
// par seconde constantes (l'enregistrement du navigateur a un rythme d'images variable). Réservé aux comptes qui ont
// ONIRIQUE CLOUD (membres ONIRIQUE et abonnés aux outils). Rien n'est gardé : les fichiers sont effacés aussitôt.
//
// Le son : la page envoie d'abord celui du passage tel qu'il est dans le fichier (WAV, POST /api/cut/audio), puis la
// vidéo (POST /api/cut/mp4?audio=…&offset=…). Le son n'est encodé qu'une fois, en AAC 320 kb/s, à sa fréquence d'origine,
// au lieu de passer par l'enregistrement du navigateur (déjà compressé) puis par une seconde compression.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { HttpError, rateLimit, can } from './auth.js';
import { testing } from './mail.js';

const MAX_BYTES = 600 * 1024 * 1024; // une minute en 1080p tient largement dedans
const AUDIO_MAX = 300 * 1024 * 1024; // trois minutes en WAV 24 bits stéréo 48 kHz : 52 Mo
const AUDIO_TTL = 30 * 60_000; // un son envoyé sans vidéo derrière est effacé au bout d'une demi-heure

/** offset : de combien de secondes le son démarre après le début de la vidéo (négatif : avant). */
export const cutArgs = (input, output, audio = null, offset = 0) => ['-y', '-hide_banner', '-loglevel', 'error', '-i', input,
  ...(audio ? [...(offset > 0 ? ['-itsoffset', offset.toFixed(3)] : offset < 0 ? ['-ss', (-offset).toFixed(3)] : []), '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-shortest'] : []),
  '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-tune', 'film', '-c:a', 'aac', '-b:a', '320k',
  '-movflags', '+faststart', output];

function toMp4(input, output, audio, offset) {
  if (testing) { fs.copyFileSync(input, output); return Promise.resolve(); } // pas de ffmpeg pendant les tests
  return new Promise((resolve, reject) => execFile('ffmpeg', cutArgs(input, output, audio, offset), { timeout: 10 * 60_000 }, (error, _out, stderr) =>
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
    try { await toMp4(input, output, audio?.file, offset); } catch (error) { clean(); throw error; } finally { if (audio) forget(audioId); }
    res.set({ 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(output).size, 'Cache-Control': 'no-store' });
    const stream = fs.createReadStream(output);
    stream.on('close', clean);
    stream.pipe(res);
  }));
}
