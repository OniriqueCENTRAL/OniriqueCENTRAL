// Ce que /play reçoit, en liste de titres { title, artist, cover, url } que ffmpeg sait lire.
// Un lien d'écoute ONIRIQUE (…/ecoute?t=<jeton>) passe par l'API, qui rend des adresses audio signées (6 h) ;
// une autre adresse http(s) est prise telle quelle, comme un fichier audio.
// La pochette part vers Discord : elle prend l'adresse publique du site.
export async function tracksOf(input, api, fetchFn = fetch, site = 'https://onirique.store') {
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error('Colle une adresse complète (https://…).'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Seules les adresses https:// sont acceptées.');
  const token = /\/ecoute(\.html)?$/.test(url.pathname) && url.searchParams.get('t');
  if (!token) return [{ title: decodeURIComponent(url.pathname.split('/').pop() || url.hostname), artist: '', cover: null, url: url.href }];
  if (!/^[\w-]{8,64}$/.test(token)) throw new Error("Ce lien d'écoute n'est pas valide.");

  const res = await fetchFn(`${api}/api/sounds/share/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ce lien d'écoute ne s'ouvre pas.");
  const tracks = (data.tracks || []).filter((t) => t.version?.url).map((t) => ({
    title: t.title, artist: data.owner || '', cover: data.cover ? new URL(data.cover, site).href : null, url: new URL(t.version.url, api).href,
  }));
  if (!tracks.length) throw new Error("Aucun titre à jouer dans ce lien.");
  return tracks;
}
