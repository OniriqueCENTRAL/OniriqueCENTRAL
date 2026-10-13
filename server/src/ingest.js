import { execFile } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

//==============================================================================
//  Récupère l'audio d'une adresse donnée par un utilisateur, en MP3 ou en WAV, dans un dossier
//  temporaire. Le travail est confié à un outil en ligne de commande (AUDIO_INGEST_BIN),
//  qui doit accepter les options de yt-dlp et trouver ffmpeg.
//  Ne dépend ni de la base ni de la configuration.
//==============================================================================

const run = promisify(execFile);

// yt-dlp sort du WAV en 16 bits : le codec est redonné à ffmpeg, qui retient le dernier.
const FORMATS = {
  mp3: ['--audio-format', 'mp3', '--audio-quality', '320K'],
  wav: ['--audio-format', 'wav', '--postprocessor-args', 'ExtractAudio:-acodec pcm_s24le'],
};
export const MAX_MINUTES = 15;

// Adresses que le serveur ne doit jamais aller chercher pour le compte d'un utilisateur.
const internal = new net.BlockList();
for (const [prefix, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]]) {
  internal.addSubnet(prefix, bits, 'ipv4');
}
for (const [prefix, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10]]) internal.addSubnet(prefix, bits, 'ipv6');

/** L'adresse, normalisée, ou une erreur : http(s) seulement, sans identifiants, vers une machine publique. */
export async function checkedUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Adresse invalide.');
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error('Adresse invalide.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Adresse invalide.');
  // shortcut: l'outil refait sa propre résolution et suit les redirections ; si le serveur côtoie des
  // services internes sensibles, le faire sortir par un proxy ou un réseau isolé.
  const addresses = await dns.lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true }).catch(() => []);
  if (!addresses.length || addresses.some((a) => internal.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'))) {
    throw new Error('Adresse injoignable ou interdite.');
  }
  return url.href;
}

/**
 * L'audio tiré de l'adresse, en MP3 320 kbit/s ou en WAV 24 bits : { file, meta, cleanup }. Le dossier temporaire disparaît à l'appel de
 * cleanup(), ou tout seul au bout de ttlMs. dir : où le créer (un WAV pèse lourd, et /tmp est souvent en mémoire vive).
 */
export async function ingestAudio(input, { format = 'mp3', dir: base = os.tmpdir(), ttlMs = 15 * 60_000, timeoutMs = 5 * 60_000 } = {}) {
  if (!Object.hasOwn(FORMATS, format)) throw new Error('Format inconnu.');
  const bin = process.env.AUDIO_INGEST_BIN;
  if (!bin) throw new Error('AUDIO_INGEST_BIN manque.');
  const url = await checkedUrl(input);
  await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'ingest-'));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true });
  try {
    // Pas de shell, et « -- » : l'adresse ne peut être lue ni comme une commande ni comme une option.
    const { stdout } = await run(bin, [
      '--ignore-config', '--no-playlist', '--playlist-items', '1', '--max-filesize', '200M',
      '--match-filters', `duration<=?${MAX_MINUTES * 60}`, '-x', ...FORMATS[format],
      '--print-json', '--no-progress', '-o', path.join(dir, 'audio.%(ext)s'), '--', url,
    ], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    const file = path.join(dir, `audio.${format}`);
    await fs.access(file);
    const info = JSON.parse(stdout.split('\n', 1)[0]);
    setTimeout(cleanup, ttlMs).unref();
    return {
      file,
      meta: { title: info.title ?? null, author: info.uploader ?? info.artist ?? null, duration: info.duration ?? null, source: info.webpage_url ?? url },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
