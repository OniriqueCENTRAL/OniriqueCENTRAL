// Le son d'un titre pour le salon vocal : ffmpeg (et yt-dlp pour YouTube / SoundCloud) en Ogg Opus.
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { createAudioResource, StreamType } from '@discordjs/voice';
import { YTDLP } from './tracks.js';

// Un programme absent ou qui plante ne doit pas faire tomber le bot (un 'error' sans écouteur arrête Node).
const run = (cmd, args, stdio) => {
  const p = spawn(cmd, args, { stdio });
  p.on('error', (e) => console.error(`${cmd} :`, e.message));
  return p;
};

// ffmpeg sort de l'Ogg Opus : rien à encoder côté Node. Un son YouTube arrive par yt-dlp, au moment de le jouer.
// Les programmes sont tués à la fin du titre (passé, arrêté, fini) : sinon ils restent bloqués sur leur sortie.
const OUT = ['-vn', '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-f', 'ogg', '-loglevel', 'error', 'pipe:1'];
export function resourceOf(track) {
  let ff, yt;
  if (track.yt) {
    yt = run(YTDLP, ['--js-runtimes', 'node', '-f', 'bestaudio/best', '--no-playlist', '--no-warnings', '-q', '-o', '-', track.url], ['ignore', 'pipe', 'inherit']);
    ff = run('ffmpeg', ['-i', 'pipe:0', ...OUT], ['pipe', 'pipe', 'inherit']);
    yt.stdout.on('error', () => {});
    ff.stdin.on('error', () => {}); // ffmpeg arrêté : yt-dlp écrit dans le vide
    yt.stdout.pipe(ff.stdin);
  } else {
    // L'adresse vient d'un membre Discord : ffmpeg ne suit que du http(s), jamais un fichier du VPS (playlist piégée).
    ff = run('ffmpeg', ['-protocol_whitelist', 'http,https,tcp,tls', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-i', track.url, ...OUT],
      ['ignore', 'pipe', 'inherit']);
  }
  ff.stdout.on('error', () => {});
  // Le titre est converti d'un coup dans une réserve (1 Mo par minute, 64 Mo au plus) au lieu de suivre la lecture :
  // une connexion à YouTube laissée en attente plusieurs minutes est fermée par YouTube, et le son se coupait au milieu.
  const buffer = new PassThrough({ highWaterMark: 64 << 20 });
  ff.stdout.pipe(buffer);
  const kill = () => { buffer.destroy(); for (const p of [ff, yt]) if (p && p.exitCode === null) p.kill('SIGKILL'); };
  return createAudioResource(buffer, { inputType: StreamType.OggOpus, metadata: { track, kill } });
}
