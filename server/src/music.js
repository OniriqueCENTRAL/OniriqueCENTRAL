// Liens « Musique » des pages de liens : à partir d'un seul lien (Spotify, Deezer, Apple Music, YouTube, SoundCloud),
// le même titre, album ou artiste sur les autres plateformes, pour que le visiteur écoute sur la sienne.
// Seulement des services publics sans clé : la page et l'oEmbed de Spotify, les API de Deezer et d'iTunes, l'oEmbed
// de YouTube et de SoundCloud. Deezer et Apple Music reçoivent le lien exact quand il est trouvé ; les autres
// plateformes (ou un lien exact introuvable) reçoivent une recherche, qui ouvre l'application sur ce titre.
import { config } from './config.js';

const text = (value, max = 200) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const fold = (s) => text(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, ' ').trim();
const same = (a, b) => { const x = fold(a), y = fold(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
// Pour chercher : l'artiste principal (« A, B & C » → « A ») et le titre sans mentions (« (feat. …) », « - Remastered »…).
const mainArtist = (s) => text(s).split(/\s*(?:,|&|\bfeat\.?\s|\bft\.?\s|\bx\s)\s*/i)[0];
const bareTitle = (s) => text(s).replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/i, '').trim() || text(s);
const query = (item) => (item.type === 'artist' ? item.title : `${mainArtist(item.artist)} ${bareTitle(item.title)}`.trim());

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}
async function getHtml(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ONIRIQUE)' } });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.text();
}
const metaOf = (html, property) => (new RegExp(`<meta property="${property}" content="([^"]*)"`).exec(html) || [])[1] || '';
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Les pochettes viennent des plateformes elles-mêmes : seules ces adresses sont gardées.
const COVER_HOSTS = /(^|\.)(scdn\.co|spotifycdn\.com|dzcdn\.net|mzstatic\.com|ytimg\.com|sndcdn\.com)$/;
function cover(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && COVER_HOSTS.test(url.hostname) ? url.href : null;
  } catch { return null; }
}

/** Ce que désigne un lien de musique : { source, type (track, album, artist), title, artist, cover }, ou null. */
export async function identify(link) {
  let url;
  try { url = new URL(link); } catch { return null; }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  const parts = url.pathname.split('/').filter(Boolean).filter((p) => !/^intl-/.test(p));

  if (host === 'open.spotify.com' && /^(track|album|artist)$/.test(parts[0]) && /^[A-Za-z0-9]{22}$/.test(parts[1] || '')) {
    const page = `${config.spotifyWeb}/${parts[0]}/${parts[1]}`;
    const [embed, html] = await Promise.all([getJson(`${config.spotifyWeb}/oembed?url=${encodeURIComponent(page)}`).catch(() => null), getHtml(page).catch(() => '')]);
    const title = text(embed?.title) || decode(metaOf(html, 'og:title'));
    // og:description : « Artiste · Album · Song · 1987 » pour un titre, « Artiste · album · 2005 » pour un album.
    const artist = parts[0] === 'artist' ? title : decode(metaOf(html, 'og:description').split(' · ')[0] || '');
    return title ? { source: 'spotify', type: parts[0], title: text(title), artist: text(artist), cover: cover(embed?.thumbnail_url || metaOf(html, 'og:image')) } : null;
  }

  if (host === 'deezer.com' && /^(track|album|artist)$/.test(parts.at(-2)) && /^\d{1,15}$/.test(parts.at(-1))) {
    const type = parts.at(-2);
    const d = await getJson(`${config.deezerApi}/${type}/${parts.at(-1)}`);
    if (d?.error) return null;
    const title = type === 'artist' ? d.name : d.title;
    return title ? { source: 'deezer', type, title: text(title), artist: text(type === 'artist' ? d.name : d.artist?.name),
      cover: cover(type === 'artist' ? d.picture_medium : type === 'album' ? d.cover_medium : d.album?.cover_medium) } : null;
  }

  if (host === 'music.apple.com') {
    // /fr/album/nom/123?i=456 (un titre de l'album), /fr/song/nom/456, /fr/album/nom/123, /fr/artist/nom/789
    const kind = parts[1];
    const id = url.searchParams.get('i') || parts.at(-1);
    if (!/^\d{1,15}$/.test(id || '') || !/^(album|song|artist)$/.test(kind)) return null;
    const found = (await getJson(`${config.itunesApi}/lookup?id=${id}&country=FR`))?.results?.[0];
    if (!found) return null;
    const type = found.wrapperType === 'artist' ? 'artist' : found.wrapperType === 'collection' ? 'album' : 'track';
    const title = type === 'artist' ? found.artistName : type === 'album' ? found.collectionName : found.trackName;
    return title ? { source: 'applemusic', type, title: text(title), artist: text(found.artistName), cover: cover(found.artworkUrl100?.replace('100x100', '600x600')) } : null;
  }

  // YouTube, YouTube Music, SoundCloud : leur oEmbed donne le titre de la vidéo ou du son, et la chaîne.
  const oembed = /youtube\.com$|youtu\.be$/.test(host) ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link.replace('music.youtube.com', 'www.youtube.com'))}`
    : host === 'soundcloud.com' ? `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(link)}` : null;
  if (oembed) {
    const o = await getJson(oembed);
    const author = text(o?.author_name).replace(/ - Topic$/, '');
    let title = text(o?.title);
    // « Artiste - Titre (Clip officiel) » : on garde le titre, sans les mentions de vidéo.
    if (title.toLowerCase().startsWith(author.toLowerCase() + ' - ')) title = title.slice(author.length + 3);
    title = title.replace(/\s*[([](official|clip|lyrics?|audio|video|vidéo|visualizer|paroles)[^)\]]*[)\]]/gi, '').trim();
    const source = host === 'soundcloud.com' ? 'soundcloud' : host === 'music.youtube.com' ? 'youtubemusic' : 'youtube';
    return title ? { source, type: 'track', title, artist: author, cover: cover(o?.thumbnail_url) } : null;
  }
  return null;
}

// L'ordre dans lequel le visiteur voit les plateformes.
const ORDER = ['spotify', 'applemusic', 'deezer', 'youtubemusic', 'youtube', 'soundcloud', 'tidal', 'amazonmusic'];

async function deezerExact(item) {
  // La recherche avancée de Deezer (artist:"…" track:"…") ne rend rien quand on combine les deux : recherche simple.
  const path = { track: 'search', album: 'search/album', artist: 'search/artist' }[item.type];
  const hit = (await getJson(`${config.deezerApi}/${path}?q=${encodeURIComponent(query(item))}&limit=8`))?.data
    ?.find((d) => (item.type === 'artist' ? same(d.name, item.title) : same(d.title, bareTitle(item.title)) && same(d.artist?.name, mainArtist(item.artist))));
  return hit ? `https://www.deezer.com/${item.type}/${hit.id}` : null;
}
async function appleExact(item) {
  const entity = { track: 'song', album: 'album', artist: 'musicArtist' }[item.type];
  const hit = (await getJson(`${config.itunesApi}/search?term=${encodeURIComponent(query(item))}&entity=${entity}&limit=8&country=FR`))?.results
    ?.find((r) => (item.type === 'artist' ? same(r.artistName, item.title)
      : same(item.type === 'album' ? r.collectionName : r.trackName, bareTitle(item.title)) && same(r.artistName, mainArtist(item.artist))));
  const url = hit && (item.type === 'artist' ? hit.artistLinkUrl : item.type === 'album' ? hit.collectionViewUrl : hit.trackViewUrl);
  return url ? url.replace(/[?&]uo=\d+/, '').replace(/\?$/, '') : null;
}

/** Les plateformes d'un lien de musique : { type, title, artist, cover, platforms: [{ id, url, exact }] }, ou null. */
export async function alternatives(link) {
  const item = await identify(link).catch(() => null);
  if (!item) return null;
  const q = encodeURIComponent(query(item));
  const [deezer, apple] = await Promise.all([
    item.source === 'deezer' ? null : deezerExact(item).catch(() => null),
    item.source === 'applemusic' ? null : appleExact(item).catch(() => null),
  ]);
  const search = {
    spotify: `https://open.spotify.com/search/${q}`,
    applemusic: apple || `https://music.apple.com/fr/search?term=${q}`,
    deezer: deezer || `https://www.deezer.com/search/${q}`,
    youtubemusic: `https://music.youtube.com/search?q=${q}`,
    youtube: `https://www.youtube.com/results?search_query=${q}`,
    soundcloud: `https://soundcloud.com/search?q=${q}`,
    tidal: `https://listen.tidal.com/search?q=${q}`,
    amazonmusic: `https://music.amazon.fr/search/${q}`,
  };
  const platforms = ORDER.map((id) => (id === item.source ? { id, url: link, exact: true }
    : { id, url: search[id], exact: (id === 'deezer' && !!deezer) || (id === 'applemusic' && !!apple) }));
  return { type: item.type, title: item.title, artist: item.artist, cover: item.cover, platforms };
}
