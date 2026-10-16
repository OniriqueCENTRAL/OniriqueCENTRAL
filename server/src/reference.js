// Références pour l'outil « Comparer à une référence » du site : chercher un titre, et son extrait officiel de
// 30 secondes, fourni par l'API publique de Deezer (sans clé, DEEZER_API). Le morceau entier n'est jamais
// téléchargé : seul l'extrait que Deezer met à disposition des applications est relayé au navigateur (qui ne peut pas
// le lire directement chez Deezer), sans être gardé sur le serveur.
// Un lien Spotify collé dans la recherche est d'abord traduit en nom de titre (oEmbed public de Spotify).
import { config } from './config.js';
import { HttpError } from './auth.js';

const MAX_BYTES = 3 * 1024 * 1024;   // un extrait de 30 s en MP3 pèse environ 500 Ko
const text = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isDeezerCdn = (host) => /(^|\.)dzcdn\.net$/.test(host);
/** Une adresse n'est gardée que si elle mène bien chez Deezer (ou chez la source réglée, pour les essais). */
function trusted(value) {
  try {
    const url = new URL(value);
    const own = url.host === new URL(config.deezerApi).host;
    return (url.protocol === 'https:' && isDeezerCdn(url.hostname)) || own ? url : null;
  } catch { return null; }
}

async function getJson(url) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  } catch {
    throw new HttpError(502, 'La recherche ne répond pas, réessaie dans un instant.');
  }
  if (!response.ok) throw new HttpError(502, 'La recherche ne répond pas, réessaie dans un instant.');
  return response.json().catch(() => { throw new HttpError(502, 'Réponse illisible de la recherche.'); });
}

/** Les titres qui correspondent à un nom (titre, artiste) ou à un lien Spotify : ceux qui ont un extrait. */
export async function searchReferences(query) {
  let q = text(query);
  if (q.length < 2) throw new HttpError(400, 'Tape au moins deux lettres.');
  const spotify = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/.exec(q);
  if (spotify) {
    const info = await getJson(`https://open.spotify.com/oembed?url=${encodeURIComponent('https://open.spotify.com/track/' + spotify[1])}`).catch(() => null);
    q = text(info?.title);
    if (!q) throw new HttpError(404, 'Ce lien Spotify ne donne pas de titre : cherche-le par son nom.');
  }
  const data = await getJson(`${config.deezerApi}/search?q=${encodeURIComponent(q)}&limit=12`);
  return (Array.isArray(data?.data) ? data.data : [])
    .filter((t) => t && t.readable !== false && t.preview && /^\d{1,15}$/.test(String(t.id)))
    .map((t) => ({
      id: String(t.id),
      title: text(t.title),
      artist: text(t.artist?.name),
      album: text(t.album?.title),
      cover: trusted(t.album?.cover_medium)?.href || null,
      duration: Number.isFinite(Number(t.duration)) ? Math.round(Number(t.duration)) : null,
      url: `https://www.deezer.com/track/${t.id}`,
    }))
    .filter((t) => t.title)
    .slice(0, 10);
}

/** L'extrait de 30 s d'un titre Deezer, en MP3. */
export async function referencePreview(id) {
  if (!/^\d{1,15}$/.test(String(id))) throw new HttpError(404, 'Titre introuvable.');
  const track = await getJson(`${config.deezerApi}/track/${id}`);
  const source = trusted(track?.preview);
  if (!source || track?.readable === false) throw new HttpError(404, "Ce titre n'a pas d'extrait à écouter.");
  let response;
  try {
    response = await fetch(source, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new HttpError(502, "L'extrait ne répond pas, réessaie dans un instant.");
  }
  if (!response.ok || !/^audio\//.test(response.headers.get('content-type') || '')) throw new HttpError(502, "L'extrait n'a pas pu être chargé.");
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new HttpError(502, "L'extrait est trop lourd.");
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length > MAX_BYTES || audio.length === 0) throw new HttpError(502, "L'extrait n'a pas pu être chargé.");
  return { audio, title: text(track.title), artist: text(track.artist?.name) };
}
