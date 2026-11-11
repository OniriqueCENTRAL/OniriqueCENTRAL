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
await assert.rejects(tracksOf('introuvable', API, { ytdlp: async () => [] }), /Aucun son trouvé/);

await assert.rejects(tracksOf('   ', API), /nom d’un son/);
await assert.rejects(tracksOf('file:///etc/passwd', API), /https/);
await assert.rejects(tracksOf('https://onirique.store/ecoute?t=abcdefgh1234', API, { fetch: reply(401, { error: 'Ce lien est protégé par un mot de passe.' }) }), /mot de passe/);
await assert.rejects(tracksOf('https://onirique.store/ecoute?t=abcdefgh1234', API, { fetch: reply(200, { tracks: [] }) }), /Aucun titre/);
console.log('discord-bot : ok');
