// Spotify, Deezer et Apple Music dans ONIRIQUE CLOUD : des playlists mi-CLOUD mi-plateformes.
//
// Sans clé ni compte développeur, seulement ce que les plateformes publient pour tout le monde :
//   - Deezer : son API publique (recherche, titres, albums, playlists, profils et leurs playlists publiques) ;
//   - Apple Music : l'API de recherche d'iTunes, et la description d'une playlist dans sa page publique ;
//   - Spotify : la page publique d'un titre, d'un album ou d'une playlist (les 30 premiers titres en détail, les
//     suivants par leur lien). Spotify ne laisse ni chercher ni lister les playlists d'un compte sans son API, réservée
//     à quelques comptes autorisés à la main : on colle le lien de la playlist.
// Un titre d'une plateforme ne se télécharge jamais : on garde son nom, son lien et son extrait officiel de 30 s,
// relayé tel quel au lecteur (même adresse que la page, pour que le lecteur puisse l'analyser). L'écoute entière se
// fait sur la plateforme.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, get, all, run, now, transaction, setting, setSetting } from './db.js';
import { HttpError, rateLimit, can } from './auth.js';
import { identify } from './music.js';
import { seal, unseal } from './payments.js';
import { ONIRIQUE } from './docs.js';

db.exec(`
CREATE TABLE IF NOT EXISTS sound_platform_accounts (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform   TEXT NOT NULL,
  url        TEXT NOT NULL,
  name       TEXT NOT NULL,
  ext_id     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, platform)
);
CREATE TABLE IF NOT EXISTS sound_platform_items (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES sound_projects(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  platform   TEXT NOT NULL,
  ext_id     TEXT NOT NULL,
  title      TEXT NOT NULL,
  artist     TEXT NOT NULL DEFAULT '',
  cover      TEXT,
  duration   INTEGER,
  url        TEXT NOT NULL,
  preview    TEXT,
  added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sound_platform_items_project ON sound_platform_items(project_id, position);
`);

export const PLATFORMS = ['spotify', 'deezer', 'apple'];
/** La place après le dernier titre d'un projet, sons du CLOUD et titres des plateformes confondus. */
export const nextPosition = (projectId) => get(`SELECT COALESCE(MAX(n), -1) + 1 AS n FROM (SELECT MAX(position) AS n FROM sound_tracks WHERE project_id = ?
  UNION ALL SELECT MAX(position) FROM sound_platform_items WHERE project_id = ?)`, projectId, projectId).n;
const MAX_ITEMS = 1000;       // titres de plateformes par playlist
const MAX_IMPORT = 200;       // titres lus dans une playlist collée
const PREVIEW_BYTES = 3 * 1024 * 1024;

const text = (value, max = 200) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const seconds = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.min(7200, Math.round(Number(value))) : null);

// Les pochettes et les extraits viennent des plateformes elles-mêmes : seules ces adresses sont gardées.
const COVER_HOSTS = /(^|\.)(scdn\.co|spotifycdn\.com|dzcdn\.net|mzstatic\.com)$/;
const PREVIEW_HOSTS = /^(p\.scdn\.co|cdns?-preview-[a-z0-9]\.dzcdn\.net|cdnt-preview\.dzcdn\.net|audio-ssl\.itunes\.apple\.com)$/;
function allowed(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && hosts.test(url.hostname) ? url.href : null;
  } catch { return null; }
}
const coverUrl = (v) => allowed(v, COVER_HOSTS);
export const previewUrl = (v) => allowed(v, PREVIEW_HOSTS);

// Le lien d'un titre sur sa plateforme, refait à partir de son identifiant (rien d'autre n'est jamais ouvert).
const ID = { spotify: /^[A-Za-z0-9]{22}$/, deezer: /^\d{1,15}$/, apple: /^\d{1,15}$/ };
const trackLink = (platform, id) => ({
  spotify: `https://open.spotify.com/track/${id}`, deezer: `https://www.deezer.com/track/${id}`, apple: `https://music.apple.com/fr/song/${id}`,
}[platform]);

/** Un titre de plateforme propre : { platform, id, title, artist, cover, duration, url, preview }, ou null. */
export function cleanItem(x) {
  if (!x || typeof x !== 'object' || !PLATFORMS.includes(x.platform) || !ID[x.platform].test(String(x.id || ''))) return null;
  const title = text(x.title);
  if (!title) return null;
  return {
    platform: x.platform, id: String(x.id), title, artist: text(x.artist), cover: coverUrl(x.cover),
    duration: seconds(x.duration), url: trackLink(x.platform, String(x.id)), preview: previewUrl(x.preview),
  };
}

// Les adresses d'extrait sont signées et valables quelques heures, comme celles des sons du CLOUD : un lecteur <audio>
// n'envoie pas de jeton. Même clé que sounds.js (réglage sounds_key), autre préfixe.
function signKey() {
  let key = setting('sounds_key', null);
  if (!key) { key = crypto.randomBytes(32).toString('hex'); setSetting('sounds_key', key); }
  return key;
}
const sign = (value) => crypto.createHmac('sha256', signKey()).update(`platform.${value}`).digest('base64url');
const fresh = (e, s, value) => Number(e) > now() && typeof s === 'string' && s.length === 43
  && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(`${value}.${e}`)));
const expiry = () => now() + 6 * 3600_000;
/** L'adresse d'écoute d'un extrait de résultat de recherche, ou null. */
const listenUrl = (preview) => { const u = previewUrl(preview); if (!u) return null; const e = expiry(); return `/api/platforms/preview?u=${encodeURIComponent(u)}&e=${e}&s=${sign(`${u}.${e}`)}`; };
/** L'adresse d'écoute d'un titre de playlist (son extrait, ou celui trouvé sur Deezer). */
const itemListenUrl = (id) => { const e = expiry(); return `/api/sounds/platform-items/${id}/preview?e=${e}&s=${sign(`item${id}.${e}`)}`; };
/** Un résultat montré au membre : le titre, et de quoi écouter son extrait. */
const shown = (x) => ({ ...x, listen: listenUrl(x.preview) });

//------------------------------------------------------------------------------ Ce que publient les plateformes
async function fetchOk(url, accept) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { Accept: accept, 'User-Agent': 'Mozilla/5.0 (compatible; ONIRIQUE)' } });
  } catch {
    throw new HttpError(502, 'La plateforme ne répond pas, réessaie dans un instant.');
  }
  if (response.status === 404) throw new HttpError(404, 'Introuvable sur la plateforme : vérifie le lien.');
  if (!response.ok) throw new HttpError(502, 'La plateforme ne répond pas, réessaie dans un instant.');
  return response;
}
const getJson = async (url) => (await fetchOk(url, 'application/json')).json().catch(() => { throw new HttpError(502, 'Réponse illisible de la plateforme.'); });
const getHtml = async (url) => (await fetchOk(url, 'text/html')).text();
const meta = (html, property) => (new RegExp(`<meta (?:property|name)="${property}" content="([^"]*)"`).exec(html) || [])[1] || '';
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Deezer
const deezerTrack = (t) => cleanItem({ platform: 'deezer', id: t?.id, title: t?.title, artist: t?.artist?.name,
  cover: t?.album?.cover_medium, duration: t?.duration, preview: t?.preview });
function deezerList(data) {
  if (data?.error) throw new HttpError(404, 'Introuvable sur Deezer : la playlist est peut-être privée.');
  return (Array.isArray(data?.data) ? data.data : []).filter((t) => t && t.readable !== false);
}

// Apple Music : les titres par lots, avec leur extrait.
const appleTrack = (r) => cleanItem({ platform: 'apple', id: r?.trackId, title: r?.trackName, artist: r?.artistName,
  cover: r?.artworkUrl100?.replace('100x100', '600x600'), duration: r?.trackTimeMillis / 1000, preview: r?.previewUrl });
async function appleLookup(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const found = (await getJson(`${config.itunesApi}/lookup?id=${ids.slice(i, i + 100).join(',')}&country=FR`))?.results || [];
    const byId = new Map(found.filter((r) => r.wrapperType === 'track').map((r) => [String(r.trackId), r]));
    out.push(...ids.slice(i, i + 100).map((id) => appleTrack(byId.get(String(id)))).filter(Boolean));
  }
  return out;
}

// Spotify : l'état initial de sa page publique (base64 de JSON), où chaque titre est un objet « Track ».
function spotifyState(html) {
  const m = /<script id="initialState" type="text\/plain">([^<]+)<\/script>/.exec(html);
  try { return m ? JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) : null; } catch { return null; }
}
// Le nombre de titres annoncé par la page d'une playlist ou d'un album (la page n'en détaille que les 30 premiers).
function spotifyTotal(state) {
  let total = 0;
  (function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > 12 || total) return;
    if (Number.isInteger(o.totalCount) && o.totalCount > 0) { total = o.totalCount; return; }
    for (const v of Object.values(o)) walk(v, depth + 1);
  })(state, 0);
  return total;
}
function spotifyTracks(state) {
  if (!state) return [];
  const found = new Map();
  (function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > 40) return;
    if (o.__typename === 'Track' && typeof o.uri === 'string' && o.uri.startsWith('spotify:track:') && !found.has(o.uri)) {
      found.set(o.uri, cleanItem({
        platform: 'spotify', id: o.uri.slice(14), title: o.name,
        // Une page d'album ou de playlist donne « artists » ; celle d'un titre, « firstArtist » puis « otherArtists ».
        artist: [...(o.artists?.items || []), ...(o.firstArtist?.items || []), ...(o.otherArtists?.items || [])].map((a) => a?.profile?.name).filter(Boolean).join(', '),
        cover: (o.albumOfTrack?.coverArt?.sources || []).find((s) => s?.width === 300)?.url || o.albumOfTrack?.coverArt?.sources?.[0]?.url,
        duration: o.duration?.totalMilliseconds / 1000, preview: o.previews?.audioPreviews?.items?.[0]?.url,
      }));
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  })(state, 0);
  return [...found.values()].filter(Boolean);
}
// Les titres de la page qui ne sont pas détaillés (au-delà des 30 premiers) : lus un par un, quatre à la fois.
async function spotifyByLinks(ids, cover) {
  const out = [];
  for (let i = 0; i < ids.length; i += 4) {
    const batch = await Promise.all(ids.slice(i, i + 4).map((id) => identify(`https://open.spotify.com/track/${id}`).catch(() => null)));
    batch.forEach((x, k) => { const item = x && cleanItem({ platform: 'spotify', id: ids[i + k], title: x.title, artist: x.artist, cover: x.cover || cover }); if (item) out.push(item); });
  }
  return out;
}

/**
 * Ce que désigne un lien de Spotify, Deezer ou Apple Music : un titre, un album ou une playlist.
 * → { kind: 'track' | 'album' | 'playlist', platform, title, cover, items: [titre propre] }
 */
export async function resolveLink(link) {
  let url;
  try { url = new URL(text(link, 500)); } catch { throw new HttpError(400, 'Colle un lien Spotify, Deezer ou Apple Music.'); }
  if (url.protocol !== 'https:') throw new HttpError(400, 'Colle un lien Spotify, Deezer ou Apple Music.');
  const host = url.hostname.replace(/^www\.|^m\./, '');
  const parts = url.pathname.split('/').filter(Boolean).filter((p) => !/^intl-/.test(p));

  // Deezer (les liens courts deezer.page.link et link.deezer.com mènent à la page : on suit la redirection).
  if (/^(deezer\.page\.link|link\.deezer\.com)$/.test(host)) {
    const final = (await fetchOk(url.href, 'text/html')).url;
    if (!/^https:\/\/(www\.)?deezer\.com\//.test(final)) throw new HttpError(400, "Ce lien Deezer ne mène pas à un titre, un album ou une playlist.");
    return resolveLink(final);
  }
  if (host === 'deezer.com') {
    const [kind, id] = parts.slice(-2);
    if (!/^\d{1,15}$/.test(id || '')) throw new HttpError(400, "Ce lien Deezer ne mène pas à un titre, un album ou une playlist.");
    if (kind === 'track') {
      const item = deezerTrack(await getJson(`${config.deezerApi}/track/${id}`));
      if (!item) throw new HttpError(404, 'Ce titre est introuvable sur Deezer.');
      return { kind: 'track', platform: 'deezer', title: item.title, cover: item.cover, items: [item] };
    }
    if (kind === 'album' || kind === 'playlist') {
      const info = await getJson(`${config.deezerApi}/${kind}/${id}`);
      if (info?.error) throw new HttpError(404, kind === 'playlist' ? 'Introuvable sur Deezer : la playlist est peut-être privée.' : 'Cet album est introuvable sur Deezer.');
      const tracks = deezerList(await getJson(`${config.deezerApi}/${kind}/${id}/tracks?limit=${MAX_IMPORT}`));
      const cover = coverUrl(kind === 'album' ? info.cover_medium : info.picture_medium);
      return { kind, platform: 'deezer', title: text(info.title), cover,
        items: tracks.map((t) => deezerTrack({ ...t, album: t.album?.cover_medium ? t.album : { cover_medium: info.cover_medium } })).filter(Boolean) };
    }
    throw new HttpError(400, "Ce lien Deezer ne mène pas à un titre, un album ou une playlist.");
  }

  // Apple Music : /fr/song/nom/ID, /fr/album/nom/ID (?i=ID : un titre de l'album), /fr/playlist/nom/pl.xxx
  if (host === 'music.apple.com') {
    const kind = parts[1], song = url.searchParams.get('i');
    if (kind === 'song' || (kind === 'album' && song)) {
      const id = song || parts.at(-1);
      if (!/^\d{1,15}$/.test(id)) throw new HttpError(400, "Ce lien Apple Music ne mène pas à un titre, un album ou une playlist.");
      const [item] = await appleLookup([id]);
      if (!item) throw new HttpError(404, 'Ce titre est introuvable sur Apple Music.');
      return { kind: 'track', platform: 'apple', title: item.title, cover: item.cover, items: [item] };
    }
    if (kind === 'album' && /^\d{1,15}$/.test(parts.at(-1))) {
      const found = (await getJson(`${config.itunesApi}/lookup?id=${parts.at(-1)}&entity=song&limit=${MAX_IMPORT}&country=FR`))?.results || [];
      const album = found.find((r) => r.wrapperType === 'collection');
      if (!album) throw new HttpError(404, 'Cet album est introuvable sur Apple Music.');
      return { kind: 'album', platform: 'apple', title: text(album.collectionName), cover: coverUrl(album.artworkUrl100?.replace('100x100', '600x600')),
        items: found.filter((r) => r.wrapperType === 'track').map(appleTrack).filter(Boolean) };
    }
    if (kind === 'playlist' && /^pl\.[A-Za-z0-9-]{5,80}$/.test(parts.at(-1))) {
      const html = await getHtml(`https://music.apple.com/${encodeURIComponent(parts[0])}/playlist/${encodeURIComponent(parts[2] || 'playlist')}/${parts.at(-1)}`);
      let ld = null;
      for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
        try { const j = JSON.parse(m[1]); if (j['@type'] === 'MusicPlaylist') { ld = j; break; } } catch { /* un autre bloc */ }
      }
      if (!ld) throw new HttpError(404, 'Cette playlist Apple Music est introuvable ou privée.');
      const ids = [...new Set((ld.track || []).map((t) => /\/(\d{1,15})(?:\?|$)/.exec(t?.url || '')?.[1]).filter(Boolean))].slice(0, MAX_IMPORT);
      const items = await appleLookup(ids);
      return { kind: 'playlist', platform: 'apple', title: text(decode(ld.name || '')), cover: items[0]?.cover || null, items };
    }
    throw new HttpError(400, "Ce lien Apple Music ne mène pas à un titre, un album ou une playlist.");
  }

  // Spotify : /track/ID, /album/ID, /playlist/ID (les liens courts spotify.link mènent à la page).
  if (host === 'spotify.link') {
    const final = (await fetchOk(url.href, 'text/html')).url;
    if (!final.startsWith('https://open.spotify.com/')) throw new HttpError(400, 'Ce lien Spotify ne mène pas à un titre, un album ou une playlist.');
    return resolveLink(final);
  }
  if (host === 'open.spotify.com') {
    const [kind, id] = parts;
    if (!/^(track|album|playlist)$/.test(kind || '') || !/^[A-Za-z0-9]{22}$/.test(id || '')) throw new HttpError(400, 'Ce lien Spotify ne mène pas à un titre, un album ou une playlist.');
    const html = await getHtml(`${config.spotifyWeb}/${kind}/${id}`);
    const cover = coverUrl(meta(html, 'og:image'));
    const title = text(decode(meta(html, 'og:title')));
    const state = spotifyState(html);
    const detailed = spotifyTracks(state);
    if (kind === 'track') {
      const item = detailed.find((t) => t.id === id) || (await spotifyByLinks([id], cover))[0];
      if (!item) throw new HttpError(404, 'Ce titre est introuvable sur Spotify.');
      return { kind, platform: 'spotify', title: item.title, cover: item.cover || cover, items: [{ ...item, cover: item.cover || cover }] };
    }
    // Un album ou une playlist : les titres listés dans la page (music:song), dans l'ordre, détaillés quand c'est possible.
    const listed = [...new Set([...html.matchAll(/<meta (?:property|name)="music:song" content="https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})"/g)].map((m) => m[1]))];
    const byId = new Map(detailed.map((t) => [t.id, t]));
    const order = (listed.length ? listed : detailed.map((t) => t.id)).slice(0, MAX_IMPORT);
    const missing = await spotifyByLinks(order.filter((x) => !byId.has(x)).slice(0, 60), cover);
    for (const t of missing) byId.set(t.id, t);
    const items = order.map((x) => byId.get(x)).filter(Boolean).map((t) => ({ ...t, cover: t.cover || cover }));
    if (!items.length) throw new HttpError(404, kind === 'playlist' ? 'Cette playlist Spotify est introuvable ou privée.' : 'Cet album est introuvable sur Spotify.');
    // total : ce que compte la playlist ; Spotify ne montre que ses 30 premiers titres à qui n'a pas son API.
    return { kind, platform: 'spotify', title, cover, items, total: Math.max(items.length, spotifyTotal(state)) };
  }
  throw new HttpError(400, 'Colle un lien Spotify, Deezer ou Apple Music.');
}

/** Chercher un titre sur Deezer ou Apple Music (Spotify ne se cherche pas sans son API : on colle son lien). */
export async function searchPlatform(source, query) {
  const q = text(query, 120);
  if (q.length < 2) throw new HttpError(400, 'Tape au moins deux lettres.');
  if (source === 'apple') {
    const found = (await getJson(`${config.itunesApi}/search?term=${encodeURIComponent(q)}&entity=song&limit=20&country=FR`))?.results || [];
    return found.map(appleTrack).filter(Boolean);
  }
  if (source === 'deezer') return deezerList(await getJson(`${config.deezerApi}/search?q=${encodeURIComponent(q)}&limit=20`)).map(deezerTrack).filter(Boolean);
  throw new HttpError(400, 'Recherche possible sur Deezer et Apple Music. Pour Spotify, colle le lien du titre ou de la playlist.');
}

/** Un extrait qui manque (un titre Spotify lu par son seul lien) : celui du même titre sur Deezer. */
async function deezerPreviewFor(item) {
  const fold = (s) => text(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, ' ').trim();
  const main = (s) => text(s).split(/\s*(?:,|&|\bfeat\.?\s|\bft\.?\s)\s*/i)[0];
  const found = deezerList(await getJson(`${config.deezerApi}/search?q=${encodeURIComponent(`${main(item.artist)} ${item.title}`)}&limit=8`));
  const hit = found.find((t) => fold(t.title).startsWith(fold(item.title).slice(0, 20)) && fold(t.artist?.name).includes(fold(main(item.artist)))) || null;
  return previewUrl(hit?.preview);
}

/** L'extrait de 30 s, relayé au lecteur sans être gardé. */
async function fetchPreview(source) {
  const url = previewUrl(source);
  if (!url) throw new HttpError(404, "Ce titre n'a pas d'extrait à écouter.");
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  } catch {
    throw new HttpError(502, "L'extrait ne répond pas, réessaie dans un instant.");
  }
  const type = response.headers.get('content-type') || '';
  if (!response.ok || !/^audio\/|^application\/octet-stream/.test(type)) throw new HttpError(502, "L'extrait n'a pas pu être chargé.");
  if (Number(response.headers.get('content-length') || 0) > PREVIEW_BYTES) throw new HttpError(502, "L'extrait est trop lourd.");
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length || audio.length > PREVIEW_BYTES) throw new HttpError(502, "L'extrait n'a pas pu être chargé.");
  return { audio, type: /^audio\//.test(type) ? type : 'audio/mpeg' };
}

//------------------------------------------------------------------------------ Comptes liés
// Le profil public de chacun sur sa plateforme. Deezer liste ses playlists publiques ; Spotify et Apple Music ne
// publient pas celles d'un compte : le profil sert d'accès direct, et on colle le lien de la playlist à importer.
async function profileOf(platform, link) {
  let url;
  try { url = new URL(text(link, 300)); } catch { url = null; }
  const parts = url ? url.pathname.split('/').filter(Boolean) : [];
  const host = url ? url.hostname.replace(/^www\./, '') : '';
  if (platform === 'deezer') {
    if (url && /^(deezer\.page\.link|link\.deezer\.com)$/.test(host)) return profileOf(platform, (await fetchOk(url.href, 'text/html')).url);
    const id = host === 'deezer.com' && parts.at(-2) === 'profile' ? parts.at(-1) : null;
    if (!/^\d{1,15}$/.test(id || '')) throw new HttpError(400, 'Colle le lien de ton profil Deezer (deezer.com/fr/profile/…).');
    const u = await getJson(`${config.deezerApi}/user/${id}`);
    if (u?.error) throw new HttpError(404, 'Ce profil Deezer est introuvable.');
    return { url: `https://www.deezer.com/profile/${id}`, name: text(u.name, 80) || 'Deezer', extId: id };
  }
  if (platform === 'spotify') {
    const id = host === 'open.spotify.com' && parts[0] === 'user' ? parts[1] : null;
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(id || '')) throw new HttpError(400, 'Colle le lien de ton profil Spotify (open.spotify.com/user/…).');
    const name = text(decode(meta(await getHtml(`${config.spotifyWeb}/user/${encodeURIComponent(id)}`).catch(() => ''), 'og:title')), 80);
    return { url: `https://open.spotify.com/user/${id}`, name: name || id, extId: id };
  }
  if (platform === 'apple') {
    const handle = host === 'music.apple.com' && parts.includes('profile') ? parts[parts.indexOf('profile') + 1] : null;
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(handle || '')) throw new HttpError(400, 'Colle le lien de ton profil Apple Music (music.apple.com/profile/…).');
    return { url: `https://music.apple.com/profile/${handle}`, name: handle, extId: handle };
  }
  throw new HttpError(404, 'Plateforme inconnue.');
}

//------------------------------------------------------------------------------ Comptes connectés : Spotify et Apple Music
// Avec un compte connecté, un titre se joue en entier dans le lecteur du CLOUD (abonnés Spotify Premium, abonnés Apple
// Music). Spotify : connexion PKCE (sans secret), le jeton de renouvellement chiffré dans la base (comme les clés
// Stripe), un jeton d'accès d'une heure rendu au lecteur. Apple Music : le jeton développeur signé ici avec la clé
// MusicKit de l'équipe ; la connexion de l'abonné, elle, reste dans son navigateur (MusicKit).
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_platform_accounts') WHERE name = 'token'`).get()) {
  db.exec('ALTER TABLE sound_platform_accounts ADD COLUMN token TEXT');
  db.exec('ALTER TABLE sound_platform_accounts ADD COLUMN premium INTEGER NOT NULL DEFAULT 0');
}
export const SPOTIFY_SCOPES = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state playlist-read-private playlist-read-collaborative';
/** L'adresse de retour déclarée chez Spotify : la page ONIRIQUE CLOUD. */
export const spotifyRedirect = () => `${config.siteUrl}/mes-sons`;
const appleKeyPath = () => path.join(config.keysDir, 'apple-music.p8');
export const appleReady = () => !!(config.appleTeamId && config.appleMusicKeyId && fs.existsSync(appleKeyPath()));

async function spotifyForm(body) {
  let r;
  try {
    r = await fetch(`${config.spotifyAccounts}/api/token`, { method: 'POST', signal: AbortSignal.timeout(9000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.spotifyClientId, ...body }) });
  } catch {
    throw new HttpError(502, 'Spotify ne répond pas, réessaie dans un instant.');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new HttpError(400, data.error === 'invalid_grant' ? 'La connexion à Spotify a expiré : reconnecte ton compte.' : 'Spotify a refusé la connexion.');
  return data;
}
async function spotifyGet(token, route) {
  let r;
  try {
    r = await fetch(`${config.spotifyApi}/v1${route}`, { signal: AbortSignal.timeout(9000), headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new HttpError(502, 'Spotify ne répond pas, réessaie dans un instant.');
  }
  if (r.status === 401) throw new HttpError(401, 'La connexion à Spotify a expiré : reconnecte ton compte.');
  if (r.status === 403) throw new HttpError(403, "Spotify refuse ce compte : il doit être ajouté aux utilisateurs de l'application ONIRIQUE sur developer.spotify.com.");
  if (r.status === 404) throw new HttpError(404, 'Introuvable sur Spotify.');
  if (r.status === 400 || r.status === 429) {
    const why = (await r.json().catch(() => ({})))?.error?.message;
    throw new HttpError(r.status, r.status === 429 ? 'Spotify demande de ralentir : réessaie dans une minute.' : `Spotify refuse la demande${why ? ` : ${text(why, 120)}` : '.'}`);
  }
  if (!r.ok) throw new HttpError(502, 'Spotify ne répond pas, réessaie dans un instant.');
  return r.json();
}
/** Le jeton d'accès Spotify d'un membre, renouvelé s'il expire dans la minute. */
async function spotifyToken(userId) {
  const row = get(`SELECT token FROM sound_platform_accounts WHERE user_id = ? AND platform = 'spotify'`, userId);
  if (!row?.token) throw new HttpError(404, "Connecte d'abord ton compte Spotify.");
  const t = JSON.parse(unseal(row.token));
  if (t.expiresAt > now() + 60_000) return t;
  const data = await spotifyForm({ grant_type: 'refresh_token', refresh_token: t.refresh });
  const next = { access: data.access_token, refresh: data.refresh_token || t.refresh, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 };
  run(`UPDATE sound_platform_accounts SET token = ? WHERE user_id = ? AND platform = 'spotify'`, seal(JSON.stringify(next)), userId);
  return next;
}
const spotifyTrack = (t, album) => cleanItem({ platform: 'spotify', id: t?.id, title: t?.name, artist: (t?.artists || []).map((a) => a?.name).filter(Boolean).join(', '),
  cover: ((album || t?.album)?.images || []).find((i) => i?.width && i.width <= 320)?.url || (album || t?.album)?.images?.[0]?.url,
  duration: t?.duration_ms / 1000, preview: t?.preview_url });
/** Une playlist ou un album Spotify par le compte connecté : tous ses titres (jusqu'à MAX_IMPORT), privée comprise. */
async function spotifyFull(userId, kind, id) {
  const { access } = await spotifyToken(userId);
  const info = await spotifyGet(access, `/${kind}s/${id}`);
  const items = [];
  // Depuis 2026, Spotify sert les titres d'une playlist sous /items (l'ancienne adresse /tracks reste pour les albums).
  let next = kind === 'album' ? `/albums/${id}/tracks?limit=50` : `/playlists/${id}/items?limit=100`;
  while (next && items.length < MAX_IMPORT) {
    const page = await spotifyGet(access, next);
    for (const it of page.items || []) {
      const t = kind === 'album' ? it : it?.item || it?.track;
      const x = t && t.type !== 'episode' && spotifyTrack(t, kind === 'album' ? info : null);
      if (x) items.push(x);
    }
    // La page suivante, sur la même API (son adresse absolue n'est jamais suivie telle quelle).
    next = null;
    try { if (page.next) { const u = new URL(page.next); next = u.pathname.replace(/^\/v1/, '') + u.search; } } catch { /* fin */ }
  }
  return { kind, platform: 'spotify', title: text(info.name), cover: coverUrl(info.images?.[0]?.url), items: items.slice(0, MAX_IMPORT) };
}
let appleCache = null;
/** Le jeton développeur d'Apple Music (MusicKit), signé avec la clé de l'équipe, valable douze heures. */
export function appleDeveloperToken() {
  if (!appleReady()) throw new HttpError(404, "Apple Music n'est pas encore branché sur ONIRIQUE.");
  if (appleCache && appleCache.exp > now() + 3600_000) return appleCache.token;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(now() / 1000), exp = iat + 12 * 3600;
  const head = `${b64({ alg: 'ES256', kid: config.appleMusicKeyId })}.${b64({ iss: config.appleTeamId, iat, exp })}`;
  const sig = crypto.sign('sha256', Buffer.from(head), { key: fs.readFileSync(appleKeyPath(), 'utf8'), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  appleCache = { token: `${head}.${sig}`, exp: exp * 1000 };
  return appleCache.token;
}

//------------------------------------------------------------------------------ Routes
// Les projets qu'on peut toucher : les siens et ceux où l'on collabore (comme dans sounds.js), hors corbeille.
const ACCESS = `(p.kind != 'trash' AND p.trashed_at IS NULL AND (p.user_id = ? OR p.id IN (SELECT project_id FROM sound_collabs WHERE user_id = ?)))`;
const view = (r) => ({ id: r.id, projectId: r.project_id, position: r.position, platform: r.platform, extId: r.ext_id, title: r.title, artist: r.artist,
  cover: r.cover, duration: r.duration, url: r.url, listen: itemListenUrl(r.id) });

export function mountPlatforms(app, { requireUser, wrap }) {
  // Réservé pour l'instant aux membres ONIRIQUE (et à l'équipe), dans l'application ONIRIQUE CENTRAL.
  const member = (req, _res, next) => (can(req.user, 'sounds') && ONIRIQUE.includes(req.user.role) ? next()
    : next(new HttpError(403, 'Spotify dans ONIRIQUE CLOUD est réservé aux membres ONIRIQUE.')));
  const me = [requireUser, member];
  const playlist = (req, pid) => {
    const p = get(`SELECT p.* FROM sound_projects p WHERE p.id = ? AND ${ACCESS}`, Number(pid) || 0, req.user.id, req.user.id);
    if (!p) throw new HttpError(404, 'Playlist introuvable.');
    if (p.kind !== 'playlist') throw new HttpError(400, "Les titres des plateformes s'ajoutent à une playlist.");
    return p;
  };
  const itemOf = (req, iid) => {
    const r = get(`SELECT i.* FROM sound_platform_items i JOIN sound_projects p ON p.id = i.project_id WHERE i.id = ? AND ${ACCESS}`, Number(iid) || 0, req.user.id, req.user.id);
    if (!r) throw new HttpError(404, 'Titre introuvable.');
    return r;
  };

  // Les comptes liés, et les titres de plateformes de toutes les playlists qu'on voit, en une fois.
  app.get('/api/me/platforms', ...me, (req, res) => {
    const accounts = all('SELECT platform, url, name, token IS NOT NULL AS connected, premium FROM sound_platform_accounts WHERE user_id = ? ORDER BY created_at', req.user.id)
      .map((a) => ({ platform: a.platform, url: a.url, name: a.name, connected: !!a.connected, premium: !!a.premium }));
    const items = all(`SELECT i.* FROM sound_platform_items i JOIN sound_projects p ON p.id = i.project_id WHERE ${ACCESS} ORDER BY i.project_id, i.position, i.id`,
      req.user.id, req.user.id).map(view);
    // La place des sons du CLOUD dans les playlists, pour les mêler aux titres des plateformes dans le bon ordre.
    const positions = Object.fromEntries(all(`SELECT t.id, t.position FROM sound_tracks t JOIN sound_projects p ON p.id = t.project_id
      WHERE p.kind = 'playlist' AND ${ACCESS}`, req.user.id, req.user.id).map((r) => [r.id, r.position]));
    res.set('Cache-Control', 'no-store').json({ accounts, items, positions });
  });
  app.put('/api/me/platforms/:platform', ...me, wrap(async (req, res) => {
    rateLimit(`platform-link:${req.user.id}`, 30, 3600_000);
    const p = await profileOf(req.params.platform, req.body?.url);
    run(`INSERT INTO sound_platform_accounts (user_id, platform, url, name, ext_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, platform) DO UPDATE SET url = excluded.url, name = excluded.name, ext_id = excluded.ext_id`, req.user.id, req.params.platform, p.url, p.name, p.extId, now());
    res.json({ platform: req.params.platform, url: p.url, name: p.name });
  }));
  app.delete('/api/me/platforms/:platform', ...me, (req, res) => {
    run('DELETE FROM sound_platform_accounts WHERE user_id = ? AND platform = ?', req.user.id, req.params.platform);
    res.json({ ok: true });
  });
  // Les playlists publiques du compte Deezer lié.
  app.get('/api/me/platforms/deezer/playlists', ...me, wrap(async (req, res) => {
    rateLimit(`platform-read:${req.user.id}`, 120, 3600_000);
    const a = get(`SELECT ext_id FROM sound_platform_accounts WHERE user_id = ? AND platform = 'deezer'`, req.user.id);
    if (!a) throw new HttpError(404, "Lie d'abord ton profil Deezer.");
    const lists = deezerList(await getJson(`${config.deezerApi}/user/${a.ext_id}/playlists?limit=100`));
    res.json(lists.filter((l) => /^\d{1,15}$/.test(String(l.id))).map((l) => ({ title: text(l.title), count: Number(l.nb_tracks) || 0, cover: coverUrl(l.picture_medium),
      url: `https://www.deezer.com/playlist/${l.id}`, loved: !!l.is_loved_track })));
  }));

  // Ce qui est branché sur ONIRIQUE : l'application Spotify (connexion des comptes) et la clé MusicKit d'Apple.
  app.get('/api/platforms/config', ...me, (req, res) => res.json({
    spotify: config.spotifyClientId ? { clientId: config.spotifyClientId, redirectUri: spotifyRedirect(), scopes: SPOTIFY_SCOPES } : null,
    apple: appleReady(),
  }));
  // Le retour de Spotify (code et vérificateur PKCE) : le compte du membre est connecté.
  app.post('/api/me/platforms/spotify/connect', ...me, wrap(async (req, res) => {
    if (!config.spotifyClientId) throw new HttpError(404, "Spotify n'est pas encore branché sur ONIRIQUE.");
    rateLimit(`spotify-connect:${req.user.id}`, 20, 3600_000);
    const code = text(req.body?.code, 1000), verifier = String(req.body?.verifier || '');
    if (!code || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new HttpError(400, 'Connexion Spotify illisible : recommence.');
    const data = await spotifyForm({ grant_type: 'authorization_code', code, redirect_uri: spotifyRedirect(), code_verifier: verifier });
    if (!data.refresh_token) throw new HttpError(502, 'Spotify a refusé la connexion.');
    const token = { access: data.access_token, refresh: data.refresh_token, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 };
    const profile = await spotifyGet(token.access, '/me');
    const id = String(profile.id || '');
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) throw new HttpError(502, 'Réponse illisible de Spotify.');
    const name = text(profile.display_name, 80) || id, premium = profile.product === 'premium' ? 1 : 0;
    run(`INSERT INTO sound_platform_accounts (user_id, platform, url, name, ext_id, token, premium, created_at) VALUES (?, 'spotify', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, platform) DO UPDATE SET url = excluded.url, name = excluded.name, ext_id = excluded.ext_id, token = excluded.token, premium = excluded.premium`,
      req.user.id, `https://open.spotify.com/user/${id}`, name, id, seal(JSON.stringify(token)), premium, now());
    res.json({ platform: 'spotify', name, connected: true, premium: !!premium });
  }));
  // Le jeton d'accès du lecteur Spotify (une heure) : il ne quitte que vers le navigateur du membre lui-même.
  app.get('/api/me/platforms/spotify/token', ...me, wrap(async (req, res) => {
    rateLimit(`spotify-token:${req.user.id}`, 600, 3600_000);
    const t = await spotifyToken(req.user.id);
    res.set('Cache-Control', 'no-store').json({ accessToken: t.access, expiresAt: t.expiresAt });
  }));
  // Les playlists du compte Spotify connecté (privées comprises).
  app.get('/api/me/platforms/spotify/playlists', ...me, wrap(async (req, res) => {
    rateLimit(`platform-read:${req.user.id}`, 120, 3600_000);
    const { access } = await spotifyToken(req.user.id);
    const page = await spotifyGet(access, '/me/playlists?limit=50');
    res.json((page.items || []).filter((l) => l && ID.spotify.test(String(l.id))).map((l) => ({ title: text(l.name), count: Number(l.items?.total ?? l.tracks?.total) || 0,
      cover: coverUrl(l.images?.[0]?.url), url: `https://open.spotify.com/playlist/${l.id}` })));
  }));
  app.get('/api/platforms/apple/token', ...me, (req, res) => res.set('Cache-Control', 'no-store').json({ token: appleDeveloperToken() }));

  app.get('/api/platforms/search', ...me, wrap(async (req, res) => {
    rateLimit(`platform-read:${req.user.id}`, 300, 3600_000);
    const source = String(req.query.source || '');
    // Spotify : sa recherche officielle, par le compte connecté du membre.
    if (source === 'spotify') {
      const q = text(req.query.q, 120);
      if (q.length < 2) throw new HttpError(400, 'Tape au moins deux lettres.');
      const { access } = await spotifyToken(req.user.id);
      const found = await spotifyGet(access, `/search?type=track&limit=10&market=from_token&q=${encodeURIComponent(q)}`);
      return res.json((found.tracks?.items || []).map((t) => spotifyTrack(t)).filter(Boolean).map(shown));
    }
    res.json((await searchPlatform(source, req.query.q)).map(shown));
  }));
  app.post('/api/platforms/resolve', ...me, wrap(async (req, res) => {
    rateLimit(`platform-read:${req.user.id}`, 120, 3600_000);
    // Un compte Spotify connecté lit la playlist ou l'album en entier par l'API (la page publique s'arrête à 30 titres).
    const link = text(req.body?.url, 500);
    const sp = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album)\/([A-Za-z0-9]{22})/.exec(link);
    const connected = sp && get(`SELECT token FROM sound_platform_accounts WHERE user_id = ? AND platform = 'spotify'`, req.user.id)?.token;
    // Si le compte n'y arrive pas, la page publique est tentée ; si elle échoue aussi (playlist privée), c'est l'erreur
    // de Spotify qui est montrée, pas celle de la page.
    const found = connected ? await spotifyFull(req.user.id, sp[1], sp[2]).catch((error) => resolveLink(link).catch(() => { throw error; })) : await resolveLink(link);
    res.json({ ...found, items: found.items.map(shown) });
  }));
  // L'extrait d'un résultat de recherche (avant de l'ajouter) : une adresse signée par la recherche elle-même.
  app.get('/api/platforms/preview', wrap(async (req, res) => {
    rateLimit(`platform-audio:${req.ip}`, 600, 3600_000);
    const u = String(req.query.u || '');
    if (!previewUrl(u) || !fresh(req.query.e, req.query.s, u)) throw new HttpError(403, 'Extrait expiré : recharge la page.');
    const { audio, type } = await fetchPreview(u);
    res.set({ 'Content-Type': type, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' }).send(audio);
  }));

  // La pochette d'une playlist importée : celle de la playlist Spotify, téléchargée chez Spotify (ses seules adresses
  // d'images), vérifiée comme une image envoyée. Une playlist qui a déjà sa pochette la garde.
  app.post('/api/me/sounds/projects/:id/platform-cover', ...me, wrap(async (req, res) => {
    const p = playlist(req, req.params.id);
    if (p.cover) return res.json({ cover: `/api/media/${p.cover}` });
    const url = coverUrl(req.body?.url);
    if (!url) throw new HttpError(400, 'Pochette introuvable.');
    rateLimit(`platform-cover:${req.user.id}`, 60, 3600_000);
    let r;
    try { r = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' }); } catch { throw new HttpError(502, "La pochette n'a pas pu être récupérée."); }
    const data = Buffer.from(await r.arrayBuffer());
    if (!r.ok || !data.length || data.length > 8 * 1024 * 1024) throw new HttpError(502, "La pochette n'a pas pu être récupérée.");
    const ext = data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png' : data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? 'jpg'
      : data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : null;
    if (!ext) throw new HttpError(502, "La pochette n'est pas une image.");
    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(config.mediaDir, name), data);
    run('UPDATE sound_projects SET cover = ? WHERE id = ?', name, p.id);
    res.json({ cover: `/api/media/${name}` });
  }));

  // Ajouter des titres à la fin d'une playlist (après les sons du CLOUD et les titres déjà là).
  app.post('/api/me/sounds/projects/:id/platform-items', ...me, (req, res) => {
    const p = playlist(req, req.params.id);
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, MAX_IMPORT).map(cleanItem).filter(Boolean);
    if (!items.length) throw new HttpError(400, 'Aucun titre à ajouter.');
    const already = get('SELECT COUNT(*) AS n FROM sound_platform_items WHERE project_id = ?', p.id).n;
    if (already + items.length > MAX_ITEMS) throw new HttpError(400, `Une playlist garde au plus ${MAX_ITEMS} titres des plateformes.`);
    const ids = transaction(() => {
      let at = nextPosition(p.id);
      return items.map((x) => run(`INSERT INTO sound_platform_items (project_id, position, platform, ext_id, title, artist, cover, duration, url, preview, added_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, p.id, at++, x.platform, x.id, x.title, x.artist, x.cover, x.duration, x.url, x.preview, req.user.id, now()).lastInsertRowid);
    });
    res.status(201).json({ ids, items: ids.map((iid) => view(get('SELECT * FROM sound_platform_items WHERE id = ?', iid))) });
  });
  app.delete('/api/me/sounds/platform-items/:id', ...me, (req, res) => {
    run('DELETE FROM sound_platform_items WHERE id = ?', itemOf(req, req.params.id).id);
    res.json({ ok: true });
  });
  // L'ordre d'une playlist mêlée : ["t12", "x5", …] (t : un son du CLOUD, x : un titre de plateforme).
  app.put('/api/me/sounds/projects/:id/mixed-order', ...me, (req, res) => {
    const p = playlist(req, req.params.id);
    const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
    const tracks = new Set(all('SELECT id FROM sound_tracks WHERE project_id = ?', p.id).map((r) => `t${r.id}`));
    const items = new Set(all('SELECT id FROM sound_platform_items WHERE project_id = ?', p.id).map((r) => `x${r.id}`));
    if (keys.length !== tracks.size + items.size || new Set(keys).size !== keys.length || !keys.every((k) => tracks.has(k) || items.has(k))) {
      throw new HttpError(400, 'Ordre illisible : recharge la page.');
    }
    transaction(() => keys.forEach((k, i) => run(k[0] === 't' ? 'UPDATE sound_tracks SET position = ? WHERE id = ?' : 'UPDATE sound_platform_items SET position = ? WHERE id = ?', i, Number(k.slice(1)))));
    res.json({ ok: true });
  });
  // L'extrait d'un titre de playlist ; s'il n'en a pas (Spotify lu par son seul lien), celui du même titre sur Deezer.
  app.get('/api/sounds/platform-items/:id/preview', wrap(async (req, res) => {
    rateLimit(`platform-audio:${req.ip}`, 600, 3600_000);
    const id = Number(req.params.id) || 0;
    if (!fresh(req.query.e, req.query.s, `item${id}`)) throw new HttpError(403, 'Extrait expiré : recharge la page.');
    const r = get('SELECT * FROM sound_platform_items WHERE id = ?', id);
    if (!r) throw new HttpError(404, 'Titre introuvable.');
    // Les extraits de Deezer sont des adresses signées qui expirent en quelques heures : une fraîche à chaque écoute.
    let source = r.platform === 'deezer' ? previewUrl((await getJson(`${config.deezerApi}/track/${r.ext_id}`).catch(() => null))?.preview) || r.preview : r.preview;
    if (!source) {
      source = await deezerPreviewFor(r).catch(() => null);
      if (!source) throw new HttpError(404, "Pas d'extrait pour ce titre : écoute-le sur sa plateforme.");
      run('UPDATE sound_platform_items SET preview = ? WHERE id = ?', source, r.id);
    }
    const { audio, type } = await fetchPreview(source);
    res.set({ 'Content-Type': type, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' }).send(audio);
  }));
}
