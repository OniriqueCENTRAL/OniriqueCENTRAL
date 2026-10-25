// Scan des prods volées, sur une base jetable et sans jamais joindre ACRCloud : node test/beatscan.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-scan-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'off', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: 'test', MAIL_FROM: 'support@test.local',
  SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test', FOUNDER_EMAILS: '', ACRCLOUD_HOST: 'https://acr.test/', ACRCLOUD_KEY: 'cle', ACRCLOUD_SECRET: 'secret' });

// ACRCloud simulé : la signature est vérifiée ; le 2e extrait de chaque prod est reconnu dans un titre sorti.
const acr = { calls: 0, down: false };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url) !== 'https://acr.test/v1/identify') return realFetch(url, init);
  const f = init.body, reply = (json) => Response.json(json);
  const expected = crypto.createHmac('sha1', 'secret').update(['POST', '/v1/identify', 'cle', 'audio', '1', f.get('timestamp')].join('\n')).digest('base64');
  assert.equal(f.get('signature'), expected);
  acr.calls++;
  if (acr.down) return reply({ status: { code: 3003, msg: 'limit exceeded' } });
  if (acr.calls % 4 === 1) return reply({ status: { code: 2004, msg: "Can't generate fingerprint" } }); // intro silencieuse
  if (acr.calls % 4 !== 2) return reply({ status: { code: 1001, msg: 'No result' } });
  return reply({ status: { code: 0, msg: 'Success' }, metadata: { music: [{ acrid: 'a1', title: 'Volé', artists: [{ name: 'Rappeur' }], album: { name: 'Album' }, release_date: '2026-01-02',
    external_metadata: { spotify: { track: { id: 'sp1' } }, deezer: [{ track: { id: 42 } }], youtube: { vid: 'yt1' } } }] } });
};

const { createApp } = await import('../src/app.js');
const { run, get, setSetting } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { scanQueue } = await import('../src/beatscan.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, route, { token, body, raw, expect = 200 } = {}) {
  const response = await fetch(base + route, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = await response.json();
  assert.equal(response.status, expect, `${method} ${route} → ${response.status} ${JSON.stringify(data)}`);
  return data;
}
let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }
const wav = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.alloc(2000)]);
setSetting('sounds_disk_max', 1);
const prodsOf = async (token) => (await call('GET', '/api/me/sounds', { token })).projects.flatMap((p) => p.tracks);

try {
  const email = 'kay@test.local';
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name: 'Kay' }, expect: 201 });
  await call('POST', '/api/auth/verify', { body: { token: outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1] } });
  run('UPDATE users SET role = ? WHERE email = ?', 'vip', email);
  let pack, album;

  await step('prod déposée dans un pack : scannée tout de suite, titre trouvé avec ses liens', async () => {
    pack = (await call('POST', '/api/me/sounds/projects', { token, body: { title: 'Pack', kind: 'pack' }, expect: 201 })).id;
    album = (await call('POST', '/api/me/sounds/projects', { token, body: { title: 'Album' }, expect: 201 })).id;
    await call('POST', `/api/me/sounds/projects/${pack}/tracks?filename=Ghost.wav`, { token, raw: wav, expect: 201 });
    await call('POST', `/api/me/sounds/projects/${album}/tracks?filename=Son.wav`, { token, raw: wav, expect: 201 });
    await scanQueue();
    const data = await call('GET', '/api/me/sounds', { token });
    assert.equal(data.scanReady, true);
    const [ghost] = data.projects.find((p) => p.id === pack).tracks;
    assert.equal(ghost.scan.status, 'done');
    assert.deepEqual(ghost.scan.matches, [{ id: 'a1', title: 'Volé', artists: 'Rappeur', album: 'Album', released: '2026-01-02', hits: 1, links: [
      { name: 'Spotify', url: 'https://open.spotify.com/track/sp1' }, { name: 'Deezer', url: 'https://www.deezer.com/track/42' }, { name: 'YouTube', url: 'https://www.youtube.com/watch?v=yt1' }] }]);
    assert.equal(data.projects.find((p) => p.id === album).tracks[0].scan, undefined); // hors pack : pas de scan
    assert.equal(acr.calls, 4); // quatre extraits par prod
  });

  await step('SCAN : toutes les prods des packs ; une panne garde les résultats d\'avant', async () => {
    await call('POST', `/api/me/sounds/projects/${pack}/tracks?filename=Ghost2.wav`, { token, raw: wav, expect: 201 });
    await scanQueue();
    acr.down = true;
    assert.deepEqual(await call('POST', '/api/me/sounds/scan', { token }), { queued: 2 });
    await scanQueue();
    const prods = await prodsOf(token);
    assert.ok(prods.filter((t) => t.scan).every((t) => t.scan.status === 'error' && /limit exceeded/.test(t.scan.error)));
    assert.equal(prods.find((t) => t.title === 'Ghost').scan.matches[0].title, 'Volé');
    assert.equal(get(`SELECT COUNT(*) AS n FROM sound_scans WHERE status = 'wait'`).n, 0);
  });

  await step('SCAN sans prod de pack : refusé', async () => {
    const other = 'vide@test.local';
    const { token: t2 } = await call('POST', '/api/auth/register', { body: { email: other, password: 'motdepasse1', name: 'Vide' }, expect: 201 });
    await call('POST', '/api/auth/verify', { body: { token: outbox.filter((m) => m.to === other).at(-1).text.match(/\?verify=([\w-]+)/)[1] } });
    run('UPDATE users SET role = ? WHERE email = ?', 'vip', other);
    await call('POST', '/api/me/sounds/scan', { token: t2, expect: 400 });
  });

  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
