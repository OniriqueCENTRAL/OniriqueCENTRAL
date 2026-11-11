// Ce que /play comprend : node test.mjs
import assert from 'node:assert/strict';
import { tracksOf } from './tracks.js';

const API = 'http://127.0.0.1:4850';
const reply = (status, body) => async () => ({ ok: status < 400, json: async () => body });
const noYt = () => assert.fail('pas de YouTube ici');

const share = { pass: null, owner: 'Nay', cover: '/api/media/c.png', tracks: [
  { title: 'Un', version: { url: '/api/sounds/audio/1?s=a' } },
  { title: 'Deux', version: { url: '/api/sounds/audio/2?s=b' } },
] };
const pack = await tracksOf('https://onirique.store/ecoute?t=abcdefgh1234', API, { fetch: reply(200, share), ytdlp: noYt });
assert.deepEqual(pack.map((t) => t.url), [`${API}/api/sounds/audio/1?s=a`, `${API}/api/sounds/audio/2?s=b`]);
assert.equal(pack[0].cover, 'https://onirique.store/api/media/c.png');
assert.equal(pack[1].artist, 'Nay');

const file = await tracksOf('https://exemple.fr/sons/mon%20son.mp3', API, { fetch: () => assert.fail('pas d’API'), ytdlp: noYt });
assert.equal(file[0].title, 'mon son.mp3');

// Un nom de son : cherché sur YouTube ; un lien YouTube : passé tel quel à yt-dlp.
let asked;
const yt = async (target) => { asked = target; return [{ id: 'abc', title: 'Jefe', channel: 'Ninho', webpage_url: 'https://www.youtube.com/watch?v=abc' }, { id: 'x', title: '[Deleted video]' }]; };
const search = await tracksOf('  ninho jefe ', API, { ytdlp: yt });
assert.equal(asked, 'ytsearch1:ninho jefe');
assert.deepEqual(search, [{ title: 'Jefe', artist: 'Ninho', cover: 'https://i.ytimg.com/vi/abc/hqdefault.jpg', url: 'https://www.youtube.com/watch?v=abc', yt: true }]);
await tracksOf('https://youtu.be/abc', API, { ytdlp: yt });
assert.equal(asked, 'https://youtu.be/abc');
await tracksOf('https://soundcloud.com/artiste/son', API, { ytdlp: yt });
assert.equal(asked, 'https://soundcloud.com/artiste/son');
await assert.rejects(tracksOf('https://open.spotify.com/track/xyz', API, { ytdlp: noYt }), /nom du son/);
await assert.rejects(tracksOf('introuvable', API, { ytdlp: async () => [] }), /Aucun son trouvé/);

await assert.rejects(tracksOf('   ', API), /nom d’un son/);
await assert.rejects(tracksOf('file:///etc/passwd', API), /https/);
await assert.rejects(tracksOf('https://onirique.store/ecoute?t=abcdefgh1234', API, { fetch: reply(401, { error: 'Ce lien est protégé par un mot de passe.' }) }), /mot de passe/);
await assert.rejects(tracksOf('https://onirique.store/ecoute?t=abcdefgh1234', API, { fetch: reply(200, { tracks: [] }) }), /Aucun titre/);
// Les sorties Spotify : lecture des pages publiques et message d'annonce.
const { releaseFrom, announcement, duration, albumIdsOf } = await import('./releases.js');
const albumHtml = `<meta property="og:description" content="euhZ · single · 2026 · 1 songs"/><meta property="og:image" content="https://i.scdn.co/image/abc"/>
<meta name="music:musician" content="https://open.spotify.com/artist/ART"/><meta name="music:release_date" content="2026-10-16"/>`;
const embedHtml = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: {
  name: 'PARTISANS', subtitle: 'euhZ', trackList: [{ title: 'PARTISANS', subtitle: 'euhZ, BES', duration: 103259 }] } } } } } })}</script>`;
const single = releaseFrom('ALB', 'ART', albumHtml, embedHtml);
assert.deepEqual([single.title, single.type, single.date, single.cover], ['PARTISANS', 'Single', '2026-10-16', 'https://i.scdn.co/image/abc']);
assert.equal(releaseFrom('ALB', 'AUTRE', albumHtml, embedHtml), null); // simple invité : pas annoncé
const msg = announcement(single, { id: 'ART', name: 'euhZ' });
assert.equal(msg.embeds[0].fields.find((f) => f.name === 'Durée').value, '1:43');
assert.equal(msg.embeds[0].fields.find((f) => f.name === 'Sortie').value, '16 octobre 2026');
assert.equal(msg.embeds[0].fields.find((f) => f.name === 'Avec').value, 'euhZ, BES');
assert.equal(msg.components[0].components[0].url, 'https://open.spotify.com/album/ALB');
assert.equal(duration(3_725_000), '1 h 02');
assert.deepEqual(albumIdsOf('<a href="/album/2QFhpFWnxp6hIMHowmb8VG">x</a><a href="/album/2QFhpFWnxp6hIMHowmb8VG">'), ['2QFhpFWnxp6hIMHowmb8VG']);

console.log('discord-bot : ok');
