// Les chiffres Spotify d'un artiste (auditeurs mensuels, abonnés, titres les plus écoutés, villes), montrés sur sa page
// de profil et sur la carte des membres. Spotify ne donne pas ces chiffres aux applications : ils sont lus chez CaptAPI
// (clé CAPTAPI_KEY, posée sur le VPS par onirique-captapi), qui facture chaque lecture. Pour borner la facture : réservé
// à l'équipe (isStaff), et une lecture par jour au plus par artiste ; entre deux, la base garde la dernière.
import { db, get, run, now } from './db.js';
import { HttpError } from './auth.js';
import { config } from './config.js';

db.exec(`CREATE TABLE IF NOT EXISTS spotify_artists (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  artist_id  TEXT NOT NULL,
  stats      TEXT,
  fetched_at INTEGER NOT NULL DEFAULT 0
)`);

const DAY = 24 * 3600_000;
const ID = /^[A-Za-z0-9]{22}$/;
/** L'identifiant d'un artiste, lu dans son lien (open.spotify.com/…/artist/…), son URI ou l'identifiant seul ; '' si rien de tel. */
export function artistIdOf(value) {
  const v = String(value || '').trim();
  const id = v.match(/^spotify:artist:([A-Za-z0-9]{22})$/)?.[1]
    || v.match(/^(?:https?:\/\/)?open\.spotify\.com\/(?:intl-[a-z-]+\/)?artist\/([A-Za-z0-9]{22})(?:[/?#]|$)/i)?.[1]
    || (ID.test(v) ? v : '');
  return id;
}

const text = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const count = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null);
const spotifyUrl = (v) => (/^https:\/\/open\.spotify\.com\//.test(v || '') ? v : null);
const imageUrl = (v) => (/^https:\/\/[a-z0-9.-]+\.(scdn\.co|spotifycdn\.com)\//.test(v || '') ? v : null);
/** Ce qu'on garde de la réponse de CaptAPI : seulement des chiffres et des noms, jamais la réponse telle quelle. */
export function statsOf(d) {
  return {
    name: text(d?.name, 120), image: imageUrl(d?.image), verified: !!d?.verified,
    monthlyListeners: count(d?.monthlyListeners), followers: count(d?.followers), worldRank: count(d?.worldRank) || null,
    topTracks: (Array.isArray(d?.topTracks) ? d.topTracks : []).slice(0, 10)
      .map((t) => ({ name: text(t?.name, 160), plays: count(t?.playCount), image: imageUrl(t?.image), url: spotifyUrl(t?.url) })).filter((t) => t.name),
    topCities: (Array.isArray(d?.topCities) ? d.topCities : []).slice(0, 5)
      .map((c) => ({ city: text(c?.city, 80), country: text(c?.country, 4), listeners: count(c?.listeners) })).filter((c) => c.city),
  };
}

const pending = new Map();
/** Relit les chiffres de l'artiste de ce membre chez CaptAPI et les garde ; rend les chiffres, ou null si la lecture échoue. */
export function refreshSpotify(userId) {
  if (pending.has(userId)) return pending.get(userId);
  const row = get('SELECT artist_id FROM spotify_artists WHERE user_id = ?', userId);
  if (!row || !config.captapiKey) return Promise.resolve(null);
  // La date est posée avant la lecture : une source en panne n'est pas redemandée à chaque visite, mais le lendemain.
  run('UPDATE spotify_artists SET fetched_at = ? WHERE user_id = ?', now(), userId);
  const job = (async () => {
    const r = await fetch(`${config.captapiApi}/v1/spotify/artist?url=${encodeURIComponent(`spotify:artist:${row.artist_id}`)}&cache=true`,
      { headers: { 'x-api-key': config.captapiKey }, signal: AbortSignal.timeout(20000) }).catch(() => null);
    const body = r?.ok ? await r.json().catch(() => null) : null;
    if (!body?.success || !body.data) { console.warn(`[spotify] CaptAPI : réponse ${r?.status ?? 'absente'} pour ${row.artist_id}`); return null; }
    const stats = { ...statsOf(body.data), at: now() };
    run('UPDATE spotify_artists SET stats = ? WHERE user_id = ? AND artist_id = ?', JSON.stringify(stats), userId, row.artist_id);
    return stats;
  })().finally(() => pending.delete(userId));
  pending.set(userId, job);
  return job;
}

/** Les chiffres gardés pour ce membre (null s'il n'a pas lié d'artiste) ; plus vieux d'un jour, ils sont relus en fond. */
export function spotifyOf(userId) {
  const row = get('SELECT * FROM spotify_artists WHERE user_id = ?', userId);
  if (!row) return null;
  if (now() - row.fetched_at > DAY) refreshSpotify(userId).catch(() => {});
  let stats = null;
  try { stats = row.stats ? JSON.parse(row.stats) : null; } catch { /* illisible : relu au prochain passage */ }
  return { url: `https://open.spotify.com/artist/${row.artist_id}`, stats };
}

/** Lier (ou délier, lien vide) le profil d'artiste Spotify d'un membre de l'équipe ; un nouvel artiste est lu tout de suite. */
export async function setSpotifyArtist(userId, value) {
  if (!String(value || '').trim()) { run('DELETE FROM spotify_artists WHERE user_id = ?', userId); return; }
  const id = artistIdOf(value);
  if (!id) throw new HttpError(400, 'Colle le lien de ton profil d’artiste Spotify (open.spotify.com/artist/…).');
  if (get('SELECT artist_id FROM spotify_artists WHERE user_id = ?', userId)?.artist_id === id) return;
  run(`INSERT INTO spotify_artists (user_id, artist_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET artist_id = excluded.artist_id, stats = NULL, fetched_at = 0`, userId, id);
  await refreshSpotify(userId);
}
