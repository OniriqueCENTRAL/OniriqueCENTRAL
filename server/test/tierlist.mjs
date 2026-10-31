// Tier list réservée aux comptes ONIRIQUE, sur une base jetable : node test/tierlist.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-tierlist-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test',
  GOOGLE_CLIENT_ID: 'client-google', GOOGLE_CLIENT_SECRET: 'secret-google' });

const { createApp } = await import('../src/app.js');
const { run, get } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, route, { token, body, expect = 200, redirect = 'follow', headers = {} } = {}) {
  const response = await fetch(base + route, {
    method, redirect, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : {};
  assert.equal(response.status, expect, `${method} ${route} → ${response.status} ${JSON.stringify(data)}`);
  return Object.assign(data, { headers: response.headers });
}
let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }
async function account(name) {
  const email = `${name}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  const link = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await call('POST', '/api/auth/verify', { body: { token: link } });
  return { token, email, id: get('SELECT id FROM users WHERE email = ?', email).id };
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const upload = (token, body, type = 'image/png') => fetch(base + '/api/tierlist/photos', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': type }, body });

try {
  const kay = await account('kay'), lou = await account('lou'), bob = await account('bob');
  run("UPDATE users SET role = 'vip' WHERE id IN (?, ?)", kay.id, lou.id);

  await step('réservée : sans compte 401, compte non ONIRIQUE 403', async () => {
    await call('GET', '/api/tierlist', { expect: 401 });
    await call('GET', '/api/tierlist', { token: bob.token, expect: 403 });
    assert.equal((await upload(bob.token, png)).status, 403);
  });

  let photo;
  await step('les comptes ONIRIQUE sont classables, une photo ajoutée est visible par les autres membres', async () => {
    const r = await call('GET', '/api/tierlist', { token: kay.token });
    assert.deepEqual(r.members.map((m) => m.id).sort(), [`u${kay.id}`, `u${lou.id}`].sort());
    assert.equal((await upload(kay.token, Buffer.from('pas une image'))).status, 400);
    const up = await upload(kay.token, png);
    assert.equal(up.status, 201);
    photo = (await up.json()).id;
    const seen = await call('GET', '/api/tierlist', { token: lou.token });
    assert.deepEqual(seen.photos.map((p) => [p.id, p.mine]), [[photo, false]]);
  });

  await step('chacun garde son classement, refusé s\'il est illisible', async () => {
    await call('PUT', '/api/tierlist', { token: kay.token, body: { S: [photo, `u${lou.id}`, photo], Z: ['u1'] } });
    await call('PUT', '/api/tierlist', { token: kay.token, body: { A: ['<script>'] }, expect: 400 });
    assert.deepEqual((await call('GET', '/api/tierlist', { token: kay.token })).placement, { S: [photo, `u${lou.id}`] });
    assert.deepEqual((await call('GET', '/api/tierlist', { token: lou.token })).placement, {});
  });

  await step('seul celui qui a ajouté la photo la retire', async () => {
    await call('DELETE', `/api/tierlist/photos/${photo}`, { token: lou.token, expect: 403 });
    await call('DELETE', `/api/tierlist/photos/${photo}`, { token: kay.token });
    assert.equal((await call('GET', '/api/tierlist', { token: kay.token })).photos.length, 0);
  });
  console.log(`tierlist : ${passed} étapes ok`);
} finally {
  server.close();
}
