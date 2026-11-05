// Les concerts de rap de la carte (Ticketmaster simulé), sur une base jetable : node test/concerts.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const asked = [];
const fake = http.createServer((req, res) => {
  asked.push(new URL(req.url, 'http://x'));
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ _embedded: { events: [
    { name: 'Rappeur B', url: 'https://www.ticketmaster.fr/b', dates: { start: { localDate: '2026-12-02', localTime: '20:00:00' } },
      images: [{ ratio: '16_9', width: 640, url: 'https://img/b.jpg' }], _embedded: { venues: [{ id: 'v1', name: 'Zénith', city: { name: 'Paris' }, location: { latitude: '48.89', longitude: '2.39' } }] } },
    { name: 'Rappeuse A', url: 'https://www.ticketmaster.fr/a', dates: { start: { localDate: '2026-11-20', localTime: '19:30:00' } },
      _embedded: { venues: [{ id: 'v2', name: 'La Cigale', city: { name: 'Paris' } }] } },
    { name: 'Sans lien', dates: { start: { localDate: '2026-11-21' } }, _embedded: { venues: [{ id: 'v3', name: 'Ailleurs' }] } },
  ] } }));
}).listen(0);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-concerts-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: 'test', MAIL_FROM: 'support@test.local',
  SITE_URL: 'https://site.test', TICKETMASTER_API_KEY: 'cle-de-test', TICKETMASTER_API: `http://127.0.0.1:${fake.address().port}` });
const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (route) => { const r = await fetch(base + route); return [r.status, await r.json()]; };

try {
  const [status, data] = await get('/api/concerts?city=paris');
  assert.equal(status, 200);
  // Rap seulement, autour de Paris ; les salles par date du premier concert ; un concert sans billetterie est écarté.
  assert.equal(asked[0].searchParams.get('genreId'), 'KnvZfZ7vAv1');
  assert.equal(asked[0].searchParams.get('latlong'), '48.86,2.35');
  assert.deepEqual(data.venues.map((v) => [v.name, v.events[0].name, v.events[0].time]), [['La Cigale', 'Rappeuse A', '19:30'], ['Zénith', 'Rappeur B', '20:00']]);
  assert.equal(data.venues[1].events[0].image, 'https://img/b.jpg');
  await get('/api/concerts?city=paris');
  assert.equal(asked.length, 1, 'la ville est gardée en mémoire');
  assert.equal((await get('/api/concerts?city=atlantide'))[0], 404);
  console.log('  ok  concerts de rap autour d’une ville, avec la billetterie\n\n1 étape réussie.');
} finally {
  server.close(); fake.close(); db.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
process.exit(0);
