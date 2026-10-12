// Score de popularité Spotify d'un artiste ou d'un titre, pour la page « Popularité » du site.
//
// L'API de Spotify ne donne plus ce score aux applications créées depuis février 2026 : il est lu auprès du service
// public de Groover (POPULARITY_SOURCE), sans clé. Ce service n'est pas documenté et peut changer ou fermer : tout ce
// qui en dépend est ici, et sa réponse n'est jamais renvoyée telle quelle au navigateur.
import { config } from './config.js';
import { HttpError } from './auth.js';

const TTL = 60 * 60_000; // le score ne bouge qu'une fois par jour : une heure de mémoire épargne la source
const MAX_ENTRIES = 2000;
const cache = new Map();

const text = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const score = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Math.round(Number(value)))) : 0);
/** Une adresse n'est gardée que si elle mène bien chez Spotify. */
const link = (value, host) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === host ? url.href : null;
  } catch { return null; }
};

function view(data) {
  const type = data?.type === 'track' ? 'track' : 'artist';
  const name = text(data?.name);
  if (!name || !/^[A-Za-z0-9]{10,40}$/.test(data?.id || '')) return null;
  return {
    type, name,
    artist: type === 'track' ? text(data.artistName) : null,
    image: link(data.image, 'i.scdn.co'),
    url: `https://open.spotify.com/${type}/${data.id}`,
    popularity: score(data.popularity),
    followers: type === 'artist' && Number.isFinite(Number(data.followers)) ? Math.max(0, Math.round(Number(data.followers))) : null,
    tracks: (Array.isArray(data.topTracks) ? data.topTracks : []).slice(0, 10)
      .map((t) => ({ name: text(t?.name), popularity: score(t?.popularity), url: link(t?.externalUrl, 'open.spotify.com') }))
      .filter((t) => t.name),
  };
}

/** Le score pour un nom d'artiste ou un lien Spotify (artiste ou titre). 404 si rien ne correspond, 502 si la source ne répond pas. */
export async function popularity(query) {
  const q = text(query, 300);
  if (q.length < 2) throw new HttpError(400, "Écris un nom d'artiste ou colle un lien Spotify.");
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let data;
  try {
    const response = await fetch(`${config.popularitySource}?q=${encodeURIComponent(q)}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000),
    });
    data = await response.json();
  } catch {
    throw new HttpError(502, 'Le score est momentanément indisponible. Réessaie dans un instant.');
  }
  const value = view(data);
  if (!value) throw new HttpError(404, 'Artiste introuvable. Vérifie le nom ou le lien, puis réessaie.');

  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + TTL });
  return value;
}
