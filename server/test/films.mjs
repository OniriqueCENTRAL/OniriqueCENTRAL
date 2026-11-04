// Page Films des fondateurs : refus à tout autre compte, et listes, recherche et fiche face à un faux TMDB local.
// node test/films.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const seen = [];
const fake = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  seen.push(url);
  const json = (body, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
  if (url.searchParams.get('api_key') !== 'cle-test') return json({ status_message: 'Invalid API key' }, 401);
  if (url.pathname === '/movie/now_playing' || url.pathname === '/search/movie') return json({ page: 1, total_pages: 900, results: [
    { id: 1, title: 'Dune', original_title: 'Dune', release_date: '2026-10-01', vote_average: 8.1, vote_count: 10, poster_path: '/abc.jpg' },
    { id: 2, title: 'Piège', poster_path: 'javascript:alert(1)' },   // image douteuse : retirée
    { id: 3, title: 'Série', media_type: 'tv' },                      // pas un film : écarté
  ] });
  if (url.pathname === '/movie/1') return json({ id: 1, title: 'Dune', imdb_id: 'tt1', runtime: 155, genres: [{ name: 'Science-Fiction' }],
    videos: { results: [{ site: 'YouTube', type: 'Trailer', iso_639_1: 'fr', key: 'abcdefghijk' }, { site: 'YouTube', key: 'x"><script>' }] },
    credits: { crew: [{ job: 'Director', name: 'Denis Villeneuve' }], cast: [{ name: 'Zendaya', character: 'Chani' }] },
    'watch/providers': { results: { FR: { link: 'https://www.themoviedb.org/movie/1/watch?locale=FR', flatrate: [{ provider_name: 'Canal+', logo_path: '/c.png' }] } } } });
  json({ status_message: 'not found' }, 404);
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-films-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: 'test',
  MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', FOUNDER_EMAILS: '', TMDB_API: `http://127.0.0.1:${fake.address().port}`, TMDB_API_KEY: '' });
const { createApp } = await import('../src/app.js');
const { run, get } = await import('../src/db.js');
const { config } = await import('../src/config.js');
const { outbox } = await import('../src/mail.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(route, { token, expect = 200 } = {}) {
  const response = await fetch(base + route, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json() : { html: await response.text() };
  assert.equal(response.status, expect, `${route} → ${response.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}
async function account(name, role) {
  const email = `${name}@test.local`;
  const r = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'motdepasse1', name }) });
  const { token } = await r.json();
  const link = outbox.filter((m) => m.to === email).at(-1)?.text.match(/\?verify=([\w-]+)/)?.[1];
  if (link) await fetch(base + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: link }) });
  if (role) run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return token;
}
let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }

const routes = ['/api/films/page', '/api/films/list/now_playing', '/api/films/search?q=dune', '/api/films/movie/1', '/api/films/autre'];
try {
  const founder = await account('fondateur', 'founder');
  await step('sans compte : 401 partout, page comprise', async () => {
    for (const r of routes) await call(r, { expect: 401 });
  });
  await step('compte non fondateur (membre, vip, admin) : 403 partout, et TMDB jamais appelé', async () => {
    for (const role of [null, 'vip', 'admin']) {
      const token = await account(`compte-${role || 'membre'}`, role);
      for (const r of routes) assert.match((await call(r, { token, expect: 403 })).error, /fondateurs/);
    }
    assert.equal(seen.length, 0);
  });
  await step('fondateur : la page est servie, sans cache', async () => {
    const { html } = await call('/api/films/page', { token: founder });
    assert.match(html, /Les <em>films<\/em>/);
  });
  await step('fondateur sans clé réglée : message clair', async () => {
    assert.match((await call('/api/films/list/now_playing', { token: founder, expect: 503 })).error, /clé TMDB/);
  });
  await step('mauvaise clé : refus de TMDB traduit', async () => {
    config.tmdbKey = 'mauvaise';
    assert.match((await call('/api/films/list/now_playing', { token: founder, expect: 502 })).error, /refuse la clé/);
  });
  await step('liste et recherche : films seulement, images vérifiées, pages bornées, en français pour la France', async () => {
    config.tmdbKey = 'cle-test';
    const list = await call('/api/films/list/now_playing?page=9999', { token: founder });
    assert.deepEqual(list.results.map((m) => [m.id, m.poster]), [[1, 'https://image.tmdb.org/t/p/w342/abc.jpg'], [2, null]]);
    assert.equal(list.pages, 500);
    const last = seen.at(-1);
    assert.deepEqual([last.searchParams.get('page'), last.searchParams.get('language'), last.searchParams.get('region')], ['500', 'fr-FR', 'FR']);
    await call('/api/films/list/inconnue', { token: founder, expect: 400 });
    await call('/api/films/search?q=d', { token: founder, expect: 400 });
    assert.equal((await call('/api/films/search?q=dune', { token: founder })).results.length, 2);
    assert.equal(seen.at(-1).searchParams.get('query'), 'dune');
  });
  await step('fiche : bande-annonce, où regarder en France, liens sûrs', async () => {
    const m = await call('/api/films/movie/1', { token: founder });
    assert.equal(m.trailer, 'https://www.youtube-nocookie.com/embed/abcdefghijk');
    assert.deepEqual(m.watch.stream, [{ name: 'Canal+', logo: 'https://image.tmdb.org/t/p/w92/c.png' }]);
    assert.equal(m.watch.link, 'https://www.themoviedb.org/movie/1/watch?locale=FR');
    assert.deepEqual([m.directors, m.imdb, m.runtime], [['Denis Villeneuve'], 'https://www.imdb.com/title/tt1/', 155]);
    await call('/api/films/movie/404', { token: founder, expect: 404 });
    await call('/api/films/movie/1;rm', { token: founder, expect: 404 });
  });
  const send = (method, route, { token, body, expect = 200 } = {}) => fetch(base + route, { method, body,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/octet-stream' } })
    .then(async (r) => { const data = await r.json().catch(() => ({})); assert.equal(r.status, expect, `${method} ${route} → ${r.status} ${JSON.stringify(data)}`); return data; });
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(5000, 1)]);
  let video, subs;
  await step('lecteur : dépôt, sources et suppression refusés à qui n\'est pas fondateur', async () => {
    const member = await account('membre-lecteur', 'vip');
    for (const token of [undefined, member]) {
      const expect = token ? 403 : 401;
      await call('/api/films/movie/1/sources', { token, expect });
      await send('POST', '/api/films/movie/1/videos', { token, body: mp4, expect });
      await send('POST', '/api/films/movie/1/subtitles', { token, body: 'x', expect });
      await send('DELETE', '/api/films/files/1', { token, expect });
    }
    assert.equal(get('SELECT COUNT(*) AS n FROM film_files').n, 0);
  });
  await step('lecteur : une vidéo MP4 et des sous-titres SRT déposés deviennent des sources signées', async () => {
    await send('POST', '/api/films/movie/1/videos', { token: founder, body: Buffer.from('pas une vidéo, du texte'), expect: 400 });
    await send('POST', '/api/films/movie/1/subtitles', { token: founder, body: 'pas des sous-titres', expect: 400 });
    await send('POST', '/api/films/movie/1/videos?label=VF%201080p&lang=fr', { token: founder, body: mp4, expect: 201 });
    await send('POST', '/api/films/movie/1/subtitles?label=Fran%C3%A7ais&lang=fr', { token: founder, body: '﻿1\r\n00:00:01,500 --> 00:00:03,000\r\nBonjour\r\n', expect: 201 });
    ({ sources: [video], subtitles: [subs] } = await call('/api/films/movie/1/sources', { token: founder }));
    assert.deepEqual([video.label, video.lang, video.type, video.from, video.size], ['VF 1080p', 'fr', 'mp4', 'Mes vidéos', mp4.length]);
    assert.equal((await call('/api/films/movie/2/sources', { token: founder })).sources.length, 0);
    // Le lecteur lit sans jeton, par l'adresse signée, et peut sauter dans le fichier.
    const part = await fetch(base + video.url, { headers: { Range: 'bytes=4-11' } });
    assert.deepEqual([part.status, part.headers.get('content-type'), await part.text()], [206, 'video/mp4', 'ftypisom']);
    const vtt = await fetch(base + subs.url);
    assert.equal(await vtt.text(), 'WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\nBonjour\n');
  });
  await step('lecteur : une adresse modifiée ou expirée est refusée', async () => {
    assert.equal((await fetch(base + video.url.replace(/s=./, 's=A'))).status, 403);
    assert.equal((await fetch(base + `/api/film-file/${video.id}?e=1&s=x`)).status, 403);
    assert.equal((await fetch(base + video.url.replace(`/film-file/${video.id}?`, `/film-file/${subs.id}?`))).status, 403);
  });
  await step('lecteur : un fondateur supprime le fichier, du disque aussi', async () => {
    const stored = get('SELECT stored_as FROM film_files WHERE id = ?', video.id).stored_as;
    await send('DELETE', `/api/films/files/${video.id}`, { token: founder });
    assert.equal(fs.existsSync(path.join(dataDir, 'films', stored)), false);
    assert.equal((await call('/api/films/movie/1/sources', { token: founder })).sources.length, 0);
  });
  console.log(`films : ${passed} vérifications passées`);
} finally {
  server.close();
  fake.close();
}
process.exit(0);
