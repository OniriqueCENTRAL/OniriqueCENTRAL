// Outil « Comparer à une référence » : recherche de titres et extraits de 30 s, face à un faux Deezer local.
// node test/reference.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// Le faux Deezer : /search, /track/:id, et les fichiers d'extrait.
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4000, 7)]);
const fake = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const self = `http://127.0.0.1:${fake.address().port}`;
  const json = (body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
  if (url.pathname === '/search') return json({ data: [
    { id: 11, title: 'Jefe', readable: true, duration: 177, preview: `${self}/p/11.mp3`, artist: { name: 'Ninho' }, album: { title: 'Jefe', cover_medium: 'https://e-cdns-images.dzcdn.net/images/cover/a/250x250.jpg' } },
    { id: 12, title: 'Bloqué', readable: false, preview: `${self}/p/12.mp3`, artist: { name: 'X' } },          // illisible : écarté
    { id: '13; rm', title: 'Piège', preview: `${self}/p/13.mp3`, artist: { name: 'X' } },                     // identifiant douteux : écarté
    { id: 14, title: 'Pochette ailleurs', preview: `${self}/p/14.mp3`, artist: { name: 'Y' }, album: { cover_medium: 'https://evil.example/c.jpg' } },
  ] });
  const track = /^\/track\/(\d+)$/.exec(url.pathname);
  if (track) {
    const id = track[1];
    if (id === '404') return json({ error: { message: 'no data' } });
    if (id === '500') return json({ id, title: 'Ailleurs', preview: 'https://evil.example/x.mp3' });
    return json({ id, title: 'Jefe', readable: true, preview: `${self}/p/${id}.mp3`, artist: { name: 'Ninho' } });
  }
  // Liens « Musique » des pages de liens : un album Deezer, la recherche d'albums, iTunes et les pages de Spotify.
  if (url.pathname === '/album/77') return json({ title: 'Destin', artist: { name: 'Ninho' }, cover_medium: 'https://evil.example/c.jpg' });
  if (url.pathname === '/search/album') return json({ data: [{ id: 5, title: 'Autre album', artist: { name: 'Quelqu\'un' } }] });
  if (url.pathname === '/itunes/search') return json({ results: url.searchParams.get('entity') === 'song'
    ? [{ wrapperType: 'track', trackName: 'Jefe', artistName: 'Ninho', trackViewUrl: 'https://music.apple.com/fr/album/jefe/1?i=2&uo=4' }] : [] });
  if (url.pathname === '/spotify/oembed') return json({ title: 'Jefe', thumbnail_url: 'https://i.scdn.co/image/abc' });
  if (url.pathname === '/spotify/track/0123456789abcdefghijkl') { res.setHeader('Content-Type', 'text/html'); return res.end('<meta property="og:description" content="Ninho · Jefe · Song · 2021">'); }
  if (url.pathname === '/p/11.mp3') { res.setHeader('Content-Type', 'audio/mpeg'); return res.end(mp3); }
  if (url.pathname === '/p/21.mp3') { res.setHeader('Content-Type', 'text/html'); return res.end('<html>'); }
  if (url.pathname === '/p/22.mp3') { res.setHeader('Content-Type', 'audio/mpeg'); return res.end(Buffer.alloc(4 * 1024 * 1024)); }
  res.statusCode = 404;
  res.end();
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-reference-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: 'test',
  MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', FOUNDER_EMAILS: '', DEEZER_API: `http://127.0.0.1:${fake.address().port}`,
  ITUNES_API: `http://127.0.0.1:${fake.address().port}/itunes`, SPOTIFY_WEB: `http://127.0.0.1:${fake.address().port}/spotify` });
const { alternatives } = await import('../src/music.js');
const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log(`  ok  ${name}`); };
try {
  await step('recherche : les titres lisibles, avec leur pochette Deezer seulement', async () => {
    const list = await fetch(`${base}/api/reference/search?q=ninho%20jefe`).then((r) => r.json());
    assert.deepEqual(list.map((t) => t.id), ['11', '14']);
    assert.deepEqual(list[0], { id: '11', title: 'Jefe', artist: 'Ninho', album: 'Jefe', cover: 'https://e-cdns-images.dzcdn.net/images/cover/a/250x250.jpg',
      duration: 177, url: 'https://www.deezer.com/track/11' });
    assert.equal(list[1].cover, null, 'une pochette hors de Deezer est retirée');
    assert.equal((await fetch(`${base}/api/reference/search?q=a`)).status, 400);
  });

  await step("extrait : le MP3 de 30 s relayé tel quel, sans rien garder sur le serveur", async () => {
    const response = await fetch(`${base}/api/reference/preview/11`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp3);
    assert.deepEqual(fs.readdirSync(path.join(dataDir, 'media')), [], 'aucun extrait gardé');
  });

  await step('extrait : identifiant douteux, titre sans extrait, adresse hors de Deezer, pas du son, trop lourd', async () => {
    for (const [id, status] of [['abc', 404], ['1;2', 404], ['404', 404], ['500', 404], ['21', 502], ['22', 502]])
      assert.equal((await fetch(`${base}/api/reference/preview/${encodeURIComponent(id)}`)).status, status, `extrait ${id}`);
  });

  await step('lien Musique : depuis Spotify, le lien exact sur Deezer et Apple Music, une recherche ailleurs', async () => {
    const a = await alternatives('https://open.spotify.com/intl-fr/track/0123456789abcdefghijkl');
    assert.deepEqual([a.type, a.title, a.artist, a.cover], ['track', 'Jefe', 'Ninho', 'https://i.scdn.co/image/abc']);
    const by = Object.fromEntries(a.platforms.map((p) => [p.id, p]));
    assert.deepEqual(a.platforms.map((p) => p.id), ['spotify', 'applemusic', 'deezer', 'youtubemusic', 'youtube', 'soundcloud', 'tidal', 'amazonmusic']);
    assert.equal(by.spotify.url, 'https://open.spotify.com/intl-fr/track/0123456789abcdefghijkl');
    assert.deepEqual([by.deezer.url, by.deezer.exact], ['https://www.deezer.com/track/11', true]);
    assert.deepEqual([by.applemusic.url, by.applemusic.exact], ['https://music.apple.com/fr/album/jefe/1?i=2', true]);
    assert.deepEqual([by.youtubemusic.url, by.youtubemusic.exact], ['https://music.youtube.com/search?q=Ninho%20Jefe', false]);
  });
  await step('lien Musique : rien de ressemblant, une recherche ; pochette hors des plateformes écartée ; lien inconnu ignoré', async () => {
    const a = await alternatives('https://www.deezer.com/fr/album/77');
    const by = Object.fromEntries(a.platforms.map((p) => [p.id, p]));
    assert.deepEqual([a.type, a.title, a.cover], ['album', 'Destin', null]);
    assert.deepEqual([by.deezer.url, by.deezer.exact], ['https://www.deezer.com/fr/album/77', true]);
    assert.deepEqual([by.applemusic.url, by.applemusic.exact], ['https://music.apple.com/fr/search?term=Ninho%20Destin', false]);
    assert.equal(await alternatives('https://exemple.fr/musique'), null);
  });
  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  fake.close();
  db.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows garde parfois la base ouverte un instant */ }
}
process.exit(0);
