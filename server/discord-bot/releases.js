// Les nouvelles sorties des artistes ONIRIQUE (artists.json, comptes Spotify), annoncées par le bot dans #annonces :
// pochette, titre, durée et lien d'écoute. Lit les pages publiques de Spotify (sans clé d'API).
//
//   node releases.js watch    vérifie chaque minute pendant 7 min (lancé le jeudi à 23 h 59, heure de Paris, par
//                             le minuteur onirique-releases : les sorties tombent à minuit)
//   node releases.js check    une seule vérification
//   node releases.js test     annonce la dernière sortie de chaque artiste (essai), et retient tout ce qui existe
//
// Une sortie déjà vue n'est jamais réannoncée (RELEASES_STATE). La première fois qu'un artiste est lu, ses sorties sont
// seulement retenues ; seule une sortie de moins de 7 jours est annoncée (la page Spotify peut remonter un vieux titre).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE = process.env.RELEASES_STATE || '/var/lib/onirique-discord-bot/releases.json';
const CHANNEL = process.env.ANNOUNCE_CHANNEL_ID || '1394729494740340818'; // #annonces du serveur ONIRIQUE
const WEB = 'https://open.spotify.com';
const LOGO = 'https://onirique.store/assets/logo-small.png';
const COLOR = 0xE23444;
// Spotify ne rend la page complète (sorties, balises) qu'à ce navigateur minimal ; un vrai Chrome reçoit une coquille vide.
const HEADERS = { 'User-Agent': 'Mozilla/5.0' };
const TYPES = { single: 'Single', ep: 'EP', album: 'Album', compilation: 'Compilation' };

async function page(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  return res.text();
}
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
export const metas = (html, key) => [...html.matchAll(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`, 'g'))].map((m) => decode(m[1]));
export const albumIdsOf = (html) => [...new Set([...html.matchAll(/\/album\/([A-Za-z0-9]{22})/g)].map((m) => m[1]))];
export function entityOf(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]*)<\/script>/);
  return m ? JSON.parse(m[1]).props?.pageProps?.state?.data?.entity ?? null : null;
}

// Une sortie : la page de l'album (date, pochette, artistes) et son lecteur intégré (titres et durées).
// null : l'artiste n'y est qu'invité (album d'un autre).
export function releaseFrom(id, artistId, html, embed) {
  if (!metas(html, 'music:musician').some((u) => u.endsWith(`/artist/${artistId}`))) return null;
  const e = entityOf(embed) || {};
  const kind = (metas(html, 'og:description')[0] || '').split(' · ')[1]?.toLowerCase() || '';
  return {
    id, url: `${WEB}/album/${id}`, title: e.name || e.title || metas(html, 'og:title')[0] || 'Nouvelle sortie', artists: e.subtitle || '',
    type: TYPES[kind] || 'Sortie', date: metas(html, 'music:release_date')[0] || '', cover: metas(html, 'og:image')[0] || null,
    tracks: (e.trackList || []).map((t) => ({ title: t.title, artists: t.subtitle || '', ms: t.duration || 0 })),
  };
}
const releaseOf = async (id, artistId) => releaseFrom(id, artistId, ...await Promise.all([page(`${WEB}/album/${id}`), page(`${WEB}/embed/album/${id}`)]));

export const duration = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const frenchDate = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }) : '—');

// Le message d'annonce : pochette en grand, titre (lien), type, durée, date, la liste des titres d'un projet, et un
// bouton « Écouter sur Spotify ».
export function announcement(r, artist) {
  const total = r.tracks.reduce((sum, t) => sum + t.ms, 0);
  const fields = [
    { name: 'Type', value: r.type, inline: true },
    { name: 'Durée', value: total ? duration(total) : '—', inline: true },
    { name: 'Sortie', value: frenchDate(r.date), inline: true },
  ];
  if (r.tracks.length > 1) {
    const list = r.tracks.slice(0, 15).map((t, n) => `\`${String(n + 1).padStart(2, '0')}\` ${t.title} · ${duration(t.ms)}`).join('\n');
    fields.push({ name: `${r.tracks.length} titres`, value: (list + (r.tracks.length > 15 ? `\n… et ${r.tracks.length - 15} autres` : '')).slice(0, 1024) });
  } else if (r.tracks[0]?.artists && r.tracks[0].artists !== r.artists) {
    fields.push({ name: 'Avec', value: r.tracks[0].artists.slice(0, 1024) });
  }
  return {
    embeds: [{
      color: COLOR,
      author: { name: `Nouvelle sortie · ${artist.name}`, url: `${WEB}/artist/${artist.id}`, icon_url: LOGO },
      title: r.title.slice(0, 256), url: r.url,
      description: `**${r.artists || artist.name}** sort ${r.type === 'Album' ? 'un nouvel album' : r.type === 'EP' ? 'un nouvel EP' : 'un nouveau son'}. Disponible maintenant sur Spotify.`,
      fields, image: r.cover ? { url: r.cover } : undefined,
      footer: { text: 'ONIRIQUE', icon_url: LOGO }, timestamp: new Date().toISOString(),
    }],
    components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Écouter sur Spotify', emoji: { name: '🎧' }, url: r.url }] }],
    allowed_mentions: { parse: [] },
  };
}

async function post(message) {
  if (!CHANNEL || !process.env.DISCORD_BOT_TOKEN) throw new Error('ANNOUNCE_CHANNEL_ID ou DISCORD_BOT_TOKEN manquant.');
  const res = await fetch(`https://discord.com/api/v10/channels/${CHANNEL}/messages`, {
    method: 'POST', headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`Discord : ${res.status} ${await res.text()}`);
}

const load = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { seen: {}, ready: {} }; } };
function save(state) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(`${STATE}.tmp`, JSON.stringify(state));
  fs.renameSync(`${STATE}.tmp`, STATE); // jamais un fichier à moitié écrit
}
const recent = (iso, days) => iso && Date.now() - Date.parse(`${iso}T00:00:00Z`) < days * 86400_000;

// Une vérification : les sorties pas encore vues de chaque artiste. Une sortie n'est retenue qu'une fois annoncée
// (ou écartée) : si Spotify ou Discord ne répond pas, elle est retentée à la minute suivante.
async function check(artists, state, { test = false } = {}) {
  for (const artist of artists) {
    try {
      const ids = albumIdsOf(await page(`${WEB}/artist/${artist.id}`));
      const fresh = test ? ids : ids.filter((id) => !state.seen[id]);
      const releases = [];
      for (const id of fresh) {
        const r = await releaseOf(id, artist.id);
        if (r) releases.push(r); else state.seen[id] = 1;
      }
      releases.sort((a, b) => b.date.localeCompare(a.date));
      for (const r of releases) {
        const announce = test ? r === releases[0] : state.ready[artist.id] && recent(r.date, 7);
        if (announce) { await post(announcement(r, artist)); console.log(`Annoncé : ${artist.name} · ${r.title}`); }
        state.seen[r.id] = 1;
      }
      state.ready[artist.id] = 1;
    } catch (e) {
      console.error(`${artist.name} :`, e.message);
    } finally {
      save(state);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] || 'check';
  const artists = JSON.parse(fs.readFileSync(path.join(HERE, 'artists.json'), 'utf8'));
  const state = load();
  if (mode === 'watch') {
    const end = Date.now() + 7 * 60_000;
    while (Date.now() < end) {
      await check(artists, state);
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
  } else {
    await check(artists, state, { test: mode === 'test' });
  }
}
