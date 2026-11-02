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

  await step('sans compte 401 ; un compte hors équipe voit la tier list sans les membres ni les photos des autres', async () => {
    await call('GET', '/api/tierlist', { expect: 401 });
    const r = await call('GET', '/api/tierlist', { token: bob.token });
    assert.equal(r.members, undefined);
    assert.deepEqual(r.placement.rows.map((x) => x.label), ['S', 'A', 'B', 'C', 'D', 'F']);
  });

  let photo, bobPhoto;
  await step("l'équipe peut importer ses membres et voit ses photos, pas celles des autres comptes", async () => {
    const r = await call('GET', '/api/tierlist', { token: kay.token });
    assert.deepEqual(r.members.map((m) => m.id).sort(), [`u${kay.id}`, `u${lou.id}`].sort());
    assert.equal((await upload(kay.token, Buffer.from('pas une image'))).status, 400);
    const up = await upload(kay.token, png);
    assert.equal(up.status, 201);
    photo = (await up.json()).id;
    bobPhoto = (await (await upload(bob.token, png)).json()).id;
    assert.deepEqual((await call('GET', '/api/tierlist', { token: lou.token })).photos.map((p) => [p.id, p.mine]), [[photo, false]]);
    assert.deepEqual((await call('GET', '/api/tierlist', { token: bob.token })).photos.map((p) => [p.id, p.mine]), [[bobPhoto, true]]);
  });

  await step("chacun garde ses rangées, ses textes sous les images ; refusé s'il est illisible", async () => {
    await call('PUT', '/api/tierlist', { token: kay.token, body: { rows: [{ label: '  Mieux  en  clash royale ', items: [photo, `u${lou.id}`, photo] }, { label: 'Nouvelle', items: [] }],
      captions: { [photo]: '  le boss ', '<x>': 'non', [`u${lou.id}`]: '  ' }, withMembers: true } });
    await call('PUT', '/api/tierlist', { token: kay.token, body: { rows: [{ label: 'A', items: ['<script>'] }] }, expect: 400 });
    await call('PUT', '/api/tierlist', { token: kay.token, body: { S: [] }, expect: 400 });
    assert.deepEqual((await call('GET', '/api/tierlist', { token: kay.token })).placement, {
      rows: [{ label: 'Mieux en clash royale', items: [photo, `u${lou.id}`] }, { label: 'Nouvelle', items: [] }], captions: { [photo]: 'le boss' }, withMembers: true });
    assert.equal((await call('GET', '/api/tierlist', { token: lou.token })).placement.rows[0].items.length, 0);
    await call('PUT', '/api/tierlist', { token: bob.token, body: { rows: [], withMembers: true } });
    assert.equal((await call('GET', '/api/tierlist', { token: bob.token })).placement.withMembers, false);
  });

  await step('un ancien classement S/A/… est relu en rangées', async () => {
    run('INSERT INTO tier_lists (user_id, data, updated_at) VALUES (?, ?, 0) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data', lou.id,
      JSON.stringify({ S: [`u${kay.id}`], labels: { S: 'Top' } }));
    const { placement } = await call('GET', '/api/tierlist', { token: lou.token });
    assert.deepEqual(placement.rows[0], { label: 'Top', items: [`u${kay.id}`] });
    assert.equal(placement.withMembers, true);
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
