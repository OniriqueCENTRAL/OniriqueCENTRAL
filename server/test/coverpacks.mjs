// Les packs de pochettes de CLOUD sur une base jetable : node test/coverpacks.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-coverpacks-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: 'test',
  MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test', FOUNDER_EMAILS: '' });

const { createApp } = await import('../src/app.js');
const { get, run, now } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { seal } = await import('../src/payments.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
async function call(method, route, { token, body, raw, type, expect = 200 } = {}) {
  const r = await fetch(base + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { 'Content-Type': type } : body ? { 'Content-Type': 'application/json' } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined) });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  assert.equal(r.status, expect, `${method} ${route} → ${r.status} ${JSON.stringify(data).slice(0, 200)}`);
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
  const artist = await account('Dias'), other = await account('Lou');
  const cover = await sharp({ create: { width: 1600, height: 1600, channels: 3, background: '#203040' } }).png().toBuffer();
  await call('PUT', '/api/me/profile/page', { token: artist.token, body: { handle: 'dias7am' } });
  await call('PUT', '/api/me/profile/page', { token: other.token, body: { handle: 'lou' } });
  const v1 = await call('POST', '/api/me/vitrine?title=Nuit&price=4999', { token: artist.token, raw: cover, type: 'image/png', expect: 201 });
  const v2 = await call('POST', '/api/me/vitrine?title=Aube', { token: artist.token, raw: cover, type: 'image/png', expect: 201 });
  const foreign = await call('POST', '/api/me/vitrine?title=Pas%20a%20moi', { token: other.token, raw: cover, type: 'image/png', expect: 201 });
  let pack;

  await step('créer un pack : ses propres visuels seulement, dans l\'ordre choisi', async () => {
    await call('POST', '/api/me/cover-packs', { token: artist.token, body: { title: ' ' }, expect: 400 });
    pack = await call('POST', '/api/me/cover-packs', { token: artist.token, body: { title: 'Covers drill' }, expect: 201 });
    pack = await call('PATCH', `/api/me/cover-packs/${pack.id}`, { token: artist.token, body: { message: 'Salut {nom}, voici mes covers.', visualIds: [v2.id, foreign.id, v1.id] } });
    assert.deepEqual(pack.visualIds, [v2.id, v1.id]);
    await call('PATCH', `/api/me/cover-packs/${pack.id}`, { token: other.token, body: { title: 'Volé' }, expect: 404 });
    const panel = await call('GET', '/api/me/cover-packs', { token: artist.token });
    assert.deepEqual([panel.handle, panel.visuals.length, panel.packs.length, panel.mailer.connected], ['dias7am', 2, 1, false]);
  });

  await step('la page publique : copies filigranées seulement, jamais l\'original', async () => {
    const page = await call('GET', `/api/cover-packs/${new URL(pack.url).searchParams.get('t')}`);
    assert.deepEqual([page.title, page.author.handle, page.visuals.map((v) => v.id)], ['Covers drill', 'dias7am', [v2.id, v1.id]]);
    for (const v of [v1, v2]) assert.equal(JSON.stringify(page).includes(get('SELECT original FROM vitrine_visuals WHERE id = ?', v.id).original), false);
    assert.ok(page.visuals.every((v) => v.image.startsWith(`/api/vitrine/${v.id}/image`)));
    await call('GET', '/api/cover-packs/inconnu', { expect: 404 });
  });

  await step('envoyer : boîte mail exigée, liste et adresses collées, doublons et désinscrits retirés', async () => {
    await call('POST', `/api/me/cover-packs/${pack.id}/send`, { token: artist.token, body: { emails: 'a@test.fr' }, expect: 400 });
    run(`INSERT INTO sound_mailers (user_id, host, port, login, secret, from_name, from_email, updated_at) VALUES (?, 'smtp.test', 465, 'dias', ?, 'Dias', 'dias@boite.fr', ?)`, artist.id, seal('motdepasse'), now());
    const list = run('INSERT INTO sound_mail_lists (user_id, name, emails, created_at) VALUES (?, ?, ?, ?)', artist.id, 'Rappeurs',
      JSON.stringify([{ email: 'zed@test.fr', name: 'Zed' }, { email: 'a@test.fr', name: '' }]), now()).lastInsertRowid;
    run('INSERT INTO sound_mail_unsubs (user_id, email, at) VALUES (?, ?, ?)', artist.id, 'parti@test.fr', now());
    const before = outbox.length;
    const sent = await call('POST', `/api/me/cover-packs/${pack.id}/send`, { token: artist.token, body: { emails: 'a@test.fr, parti@test.fr\nNino <nino@test.fr>', listId: list }, expect: 202 });
    assert.equal(sent.total, 3);
    const mails = outbox.slice(before);
    assert.deepEqual(mails.map((m) => m.subject), ['Covers drill', 'Covers drill', 'Covers drill']);
    const zed = mails.find((m) => m.to.includes('zed@test.fr'));
    assert.ok(zed.html.includes('Salut Zed, voici mes covers.') && zed.html.includes('/api/vitrine/') && zed.from.includes('dias@boite.fr'));
    assert.deepEqual(sent.pack.mails.map((m) => m.status), ['sent', 'sent', 'sent']);
    // Renvoyer à la même liste n'envoie rien de nouveau.
    await call('POST', `/api/me/cover-packs/${pack.id}/send`, { token: artist.token, body: { listId: list }, expect: 400 });
    await call('POST', `/api/me/cover-packs/${pack.id}/send`, { token: other.token, body: { emails: 'x@test.fr' }, expect: 404 });
  });

  await step('ouverture du lien suivie, désinscription', async () => {
    const r = get(`SELECT * FROM cover_pack_mails WHERE email = 'nino@test.fr'`);
    await call('GET', `/api/cover-packs/${new URL(pack.url).searchParams.get('t')}?r=${r.token}`);
    assert.ok(get('SELECT clicked_at FROM cover_pack_mails WHERE id = ?', r.id).clicked_at);
    assert.ok((await call('GET', `/api/cover-packs/m/${r.token}/desinscription`)).includes('nino@test.fr'));
    await call('POST', `/api/cover-packs/m/${r.token}/desinscription`);
    assert.ok(get(`SELECT 1 AS x FROM sound_mail_unsubs WHERE user_id = ? AND email = 'nino@test.fr'`, artist.id));
    await call('DELETE', `/api/me/cover-packs/${pack.id}`, { token: artist.token });
    assert.equal((await call('GET', '/api/me/cover-packs', { token: artist.token })).packs.length, 0);
  });

  console.log(`packs de pochettes : ${passed} étapes réussies`);
} finally {
  server.close();
}
process.exit(0);
