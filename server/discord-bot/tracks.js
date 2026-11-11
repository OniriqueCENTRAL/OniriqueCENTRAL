// Ce que /play reçoit, en liste de titres { title, artist, cover, url, yt } :
//  - un lien d'écoute ONIRIQUE (…/ecoute?t=<jeton>) passe par l'API, qui rend des adresses audio signées (6 h) ;
//  - un lien YouTube ou SoundCloud (titre ou playlist) ou un nom de son (cherché sur YouTube) passe par yt-dlp ; yt: true, le son
//    est tiré au moment de le jouer (les adresses de YouTube expirent) ;
//  - une autre adresse http(s) est prise telle quelle, comme un fichier audio.
import { execFile } from 'node:child_process';

export const YTDLP = process.env.YTDLP || '/opt/yt-dlp/bin/yt-dlp';
const YTDLP_SITES = /^(www\.|m\.|music\.|on\.)?(youtube\.com|youtu\.be|soundcloud\.com)$/;
// Ces plateformes ne donnent pas leur son : on demande le nom, cherché ensuite sur YouTube.
const CLOSED = /(^|\.)(spotify\.com|deezer\.com|deezer\.page\.link|music\.apple\.com|tidal\.com|music\.amazon\.[a-z.]+)$/;

// Une ligne JSON par vidéo ; --flat-playlist : la liste seule, sans ouvrir chaque vidéo (rapide).
function ytdlpList(target) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP, ['--js-runtimes', 'node', '--flat-playlist', '--playlist-end', '50', '--no-warnings', '--print', '%(.{id,title,url,webpage_url,channel,uploader})j', target],
      { timeout: 30000, maxBuffer: 4 << 20 }, (error, stdout) => {
        if (error && !stdout) return reject(new Error('YouTube ne répond pas, réessaie dans un instant.'));
        resolve(stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line)));
      });
  });
}

export async function tracksOf(input, api, { fetch: fetchFn = fetch, site = 'https://onirique.store', ytdlp = ytdlpList } = {}) {
  const text = input.trim();
  if (!text) throw new Error('Tape le nom d’un son ou colle un lien.');
  let url = null;
  try { url = new URL(text); } catch { /* un nom de son */ }
  if (url && !/^https?:$/.test(url.protocol)) throw new Error('Seules les adresses https:// sont acceptées.');

  if (url && CLOSED.test(url.hostname)) throw new Error('Ce site ne laisse pas jouer ses sons : tape plutôt le nom du son et de l’artiste.');
  if (!url || YTDLP_SITES.test(url.hostname)) {
    const found = await ytdlp(url ? url.href : `ytsearch1:${text.slice(0, 200)}`);
    const youtube = !url || !/soundcloud/.test(url.hostname);
    const tracks = found.filter((v) => v.id && v.title && (v.webpage_url || v.url || youtube) && !/^\[(Private|Deleted) video\]$/.test(v.title)).map((v) => ({
      title: v.title, artist: v.channel || v.uploader || '', cover: youtube ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : null,
      url: v.webpage_url || v.url || `https://www.youtube.com/watch?v=${v.id}`, yt: true,
    }));
    if (!tracks.length) throw new Error(url ? 'Rien à jouer dans ce lien YouTube.' : `Aucun son trouvé pour « ${text.slice(0, 80)} ».`);
    return tracks;
  }

  const token = /\/ecoute(\.html)?$/.test(url.pathname) && url.searchParams.get('t');
  if (!token) return [{ title: decodeURIComponent(url.pathname.split('/').pop() || url.hostname), artist: '', cover: null, url: url.href }];
  if (!/^[\w-]{8,64}$/.test(token)) throw new Error("Ce lien d'écoute n'est pas valide.");

  const res = await fetchFn(`${api}/api/sounds/share/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ce lien d'écoute ne s'ouvre pas.");
  // La pochette part vers Discord : elle prend l'adresse publique du site.
  const tracks = (data.tracks || []).filter((t) => t.version?.url).map((t) => ({
    title: t.title, artist: data.owner || '', cover: data.cover ? new URL(data.cover, site).href : null, url: new URL(t.version.url, api).href,
  }));
  if (!tracks.length) throw new Error("Aucun titre à jouer dans ce lien.");
  return tracks;
}
