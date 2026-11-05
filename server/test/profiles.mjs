// Pages de profil, abonnements, commentaires et messages privés, sur une base jetable : node test/profiles.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-profiles-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: 'test',
  MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test', FOUNDER_EMAILS: '' });
const { createApp } = await import('../src/app.js');
const { db, get } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
async function call(method, route, { token, body, expect = 200 } = {}) {
  const r = await fetch(base + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : {};
  assert.equal(r.status, expect, `${method} ${route} → ${r.status} ${JSON.stringify(data)}`);
  return data;
}
let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }
async function account(name) {
  const email = `${name.toLowerCase()}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  await call('POST', '/api/auth/verify', { body: { token: outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1] } });
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}
try {
  const a = await account('Nov'), b = await account('Lou');
  await step('créer sa page : adresse valide et libre, réglages', async () => {
    assert.equal(await call('GET', '/api/me/profile/page', { token: a.token }), null);
    await call('PUT', '/api/me/profile/page', { token: a.token, body: { handle: 'A!' }, expect: 400 });
    await call('PUT', '/api/me/profile/page', { token: a.token, body: { handle: 'Nov.music', bio: 'Beatmaker', color: '#3d7bff' } });
    await call('PUT', '/api/me/profile/page', { token: b.token, body: { handle: 'nov.music' }, expect: 409 });
    await call('PUT', '/api/me/profile/page', { token: b.token, body: { handle: 'lou' } });
    const p = await call('GET', '/api/profiles/nov.music');
    assert.deepEqual([p.name, p.bio, p.color, p.mine, p.followers], ['Nov', 'Beatmaker', '#3d7bff', false, 0]);
    await call('GET', '/api/profiles/personne', { expect: 404 });
  });
  await step('s’abonner, commenter, retirer un commentaire', async () => {
    await call('POST', '/api/profiles/nov.music/follow', { token: b.token });
    await call('POST', '/api/profiles/nov.music/follow', { token: a.token, expect: 400 });
    let p = await call('GET', '/api/profiles/nov.music', { token: b.token });
    assert.deepEqual([p.followers, p.followed, p.canMessage], [1, true, true]);
    const { id } = await call('POST', '/api/profiles/nov.music/comments', { token: b.token, body: { body: 'Trop lourd' }, expect: 201 });
    p = await call('GET', '/api/profiles/nov.music', { token: a.token });
    assert.deepEqual([p.comments[0].body, p.comments[0].author.handle, p.comments[0].canDelete], ['Trop lourd', 'lou', true]);
    await call('PUT', '/api/me/profile/page', { token: a.token, body: { handle: 'nov.music', comments: false } });
    await call('POST', '/api/profiles/nov.music/comments', { token: b.token, body: { body: 'Encore' }, expect: 403 });
    await call('DELETE', `/api/profiles/comments/${id}`, { token: a.token });
    await call('DELETE', '/api/profiles/nov.music/follow', { token: b.token });
    assert.equal((await call('GET', '/api/profiles/nov.music')).followers, 0);
  });
  await step('messages privés : envoyer, lire, non lus', async () => {
    await call('POST', '/api/me/messages/nov.music', { token: b.token, body: { body: 'Salut' }, expect: 201 });
    await call('POST', '/api/me/messages/nov.music', { token: b.token, body: { body: '  ' }, expect: 400 });
    await call('POST', '/api/me/messages/lou', { token: b.token, body: { body: 'moi' }, expect: 400 });
    let list = await call('GET', '/api/me/messages', { token: a.token });
    assert.deepEqual([list[0].with.handle, list[0].unread, list[0].last], ['lou', 1, 'Salut']);
    const thread = await call('GET', '/api/me/messages/lou', { token: a.token });
    assert.deepEqual(thread.messages.map((m) => [m.body, m.mine]), [['Salut', false]]);
    list = await call('GET', '/api/me/messages', { token: a.token });
    assert.equal(list[0].unread, 0);
    await call('GET', '/api/me/messages', { expect: 401 });
  });
  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  db.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
process.exit(0);
