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
  console.log(`films : ${passed} vérifications passées`);
} finally {
  server.close();
  fake.close();
}
process.exit(0);
