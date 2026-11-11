// Ce que /play comprend : node test.mjs
import assert from 'node:assert/strict';
import { tracksOf } from './tracks.js';

const API = 'http://127.0.0.1:4850';
const reply = (status, body) => async () => ({ ok: status < 400, json: async () => body });

const share = { pass: null, owner: 'Nay', cover: '/api/media/c.png', tracks: [
  { title: 'Un', version: { url: '/api/sounds/audio/1?s=a' } },
  { title: 'Deux', version: { url: '/api/sounds/audio/2?s=b' } },
] };
const pack = await tracksOf('https://onirique.store/ecoute?t=abcdefgh1234', API, reply(200, share));
assert.deepEqual(pack.map((t) => t.url), [`${API}/api/sounds/audio/1?s=a`, `${API}/api/sounds/audio/2?s=b`]);
assert.equal(pack[0].cover, 'https://onirique.store/api/media/c.png');
assert.equal(pack[1].artist, 'Nay');

const file = await tracksOf('https://exemple.fr/sons/mon%20son.mp3', API, () => assert.fail('pas d’API pour un fichier'));
assert.equal(file[0].title, 'mon son.mp3');

await assert.rejects(tracksOf('pas un lien', API), /adresse complète/);
await assert.rejects(tracksOf('file:///etc/passwd', API), /https/);
await assert.rejects(tracksOf('https://onirique.store/ecoute?t=abcdefgh1234', API, reply(401, { error: 'Ce lien est protégé par un mot de passe.' })), /mot de passe/);
await assert.rejects(tracksOf('https://onirique.store/ecoute?t=abcdefgh1234', API, reply(200, { tracks: [] })), /Aucun titre/);
console.log('discord-bot : ok');
