// Transfert de playlist : le lien d'une playlist Spotify, Deezer, Apple Music, Tidal ou YouTube Music, et la plateforme
// d'arrivée ; chaque titre est retrouvé sur celle-ci. Sans compte ni clé, seulement ce que les plateformes publient :
// la playlist elle-même (resolveLink pour Spotify, Deezer et Apple Music ; la page intégrable de Tidal ; la page
// publique de YouTube), puis findOn() pour chaque titre.
import { HttpError, rateLimit } from './auth.js';
import { resolveLink } from './platforms.js';
import { findOn } from './music.js';

export const TARGETS = ['spotify', 'deezer', 'apple', 'tidal', 'youtubemusic'];
const MAX = 200;
const text = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '');
const unescape = (s) => { try { return JSON.parse(`"${s}"`); } catch { return s; } };

async function page(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'fr', Cookie: 'SOCS=CAI' } }).catch(() => null);
  if (!r || !r.ok) throw new HttpError(502, 'La plateforme ne répond pas : réessaie dans un instant.');
  return r.text();
}

/** Tidal : la page intégrable de la playlist liste ses titres ({ "id": { album, artist, artwork, title } }). */
export function tidalTracks(html) {
  return [...html.matchAll(/"\d{1,12}":\{"album":"(?:[^"\\]|\\.)*","artist":"((?:[^"\\]|\\.)*)","artwork":\[[^\]]*\],"title":"((?:[^"\\]|\\.)*)"\}/g)]
    .map((m) => ({ artist: text(unescape(m[1])), title: text(unescape(m[2])) }));
}
/** YouTube (et YouTube Music) : ytInitialData de la page de la playlist, une vidéo par lockupViewModel. */
export function youtubeTracks(html) {
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
  if (!m) return [];
  const out = [];
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    const l = o.lockupViewModel;
    if (l) {
      const md = l.metadata?.lockupMetadataViewModel;
      const channel = text(md?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content).replace(/ - Topic$/, '');
      let title = text(md?.title?.content);
      // « Artiste - Titre » ou « Titre - Artiste » : on garde la partie qui n'est pas le nom de la chaîne.
      const parts = title.split(' - ');
      if (parts.length > 1 && channel) title = parts.find((x) => !fold(x).includes(fold(channel))) || parts.at(-1);
      title = title.replace(/\s*[([]\s*(official|clip|lyrics?|audio|video|vidéo|visualizer|paroles)[^)\]]*[)\]]/gi, '').trim();
      if (title) out.push({ artist: channel, title });
      return;
    }
    for (const k in o) walk(o[k]);
  })(JSON.parse(m[1]));
  return out;
}

export async function readPlaylist(link) {
  let url;
  try { url = new URL(text(link, 500)); } catch { throw new HttpError(400, "Colle le lien d'une playlist."); }
  const host = url.hostname.replace(/^www\.|^m\.|^listen\./, '');
  if (host === 'tidal.com') {
    const id = /playlist\/([0-9a-f-]{36})/.exec(url.pathname)?.[1];
    if (!id) throw new HttpError(400, 'Ce lien Tidal ne mène pas à une playlist.');
    const [html, info] = await Promise.all([page(`https://embed.tidal.com/playlists/${id}`), page(`https://tidal.com/playlist/${id}`).catch(() => '')]);
    const title = text(unescape(/"name":"((?:[^"\\]|\\.)*)","numTracks"/.exec(info)?.[1] || '')) || 'Playlist Tidal';
    return { platform: 'tidal', title, items: tidalTracks(html) };
  }
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const list = url.searchParams.get('list');
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(list || '')) throw new HttpError(400, 'Ce lien YouTube ne mène pas à une playlist.');
    const html = await page(`https://www.youtube.com/playlist?list=${list}`);
    const title = text((/<meta property="og:title" content="([^"]*)"/.exec(html) || [])[1] || '') || 'Playlist YouTube';
    return { platform: 'youtubemusic', title, items: youtubeTracks(html) };
  }
  const found = await resolveLink(url.href);
  if (found.kind !== 'playlist' && found.kind !== 'album') throw new HttpError(400, "Colle le lien d'une playlist (ou d'un album), pas d'un titre.");
  return { platform: found.platform, title: found.title, items: found.items.map((x) => ({ title: x.title, artist: x.artist })), total: found.total };
}

export function mountTransfer(app, { wrap }) {
  // Ouvert à tous, sans compte : le lien de la playlist et la plateforme d'arrivée.
  app.post('/api/playlist-transfer', wrap(async (req, res) => {
    rateLimit(`transfer:${req.ip}`, 20, 3600_000);
    const to = String(req.body?.to || '');
    if (!TARGETS.includes(to)) throw new HttpError(400, "Choisis la plateforme d'arrivée.");
    const list = await readPlaylist(req.body?.url);
    if (!list.items.length) throw new HttpError(404, 'Aucun titre trouvé : la playlist est peut-être privée.');
    if (list.platform === to) throw new HttpError(400, 'La playlist est déjà sur cette plateforme.');
    const items = list.items.slice(0, MAX), out = [];
    for (let i = 0; i < items.length; i += 6) out.push(...await Promise.all(items.slice(i, i + 6).map(async (t) => ({ ...t, ...(await findOn(t, to)) }))));
    res.json({ from: list.platform, to, title: list.title, total: Math.max(list.total || 0, list.items.length), items: out });
  }));
}
