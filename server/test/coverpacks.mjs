// Les packs de pochettes de CLOUD (projets de type « covers ») sur une base jetable : node test/coverpacks.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-coverpacks-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: 'test',
  MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test', FOUNDER_EMAILS: '' });

// Un pack de la première version (table cover_packs), qui doit devenir un projet CLOUD au démarrage.
const { db, get, run, now } = await import('../src/db.js');
const oldOwner = run(`INSERT INTO users (email, password_hash, name, role, email_verified, created_at) VALUES ('ancien@test.local', 'x', 'Ancien', 'vip', 1, ?)`, now()).lastInsertRowid;
db.exec(`CREATE TABLE cover_packs (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, message TEXT, token TEXT, created_at INTEGER);
  CREATE TABLE cover_pack_items (pack_id INTEGER, visual_id INTEGER, position INTEGER);
  CREATE TABLE cover_pack_mails (id INTEGER PRIMARY KEY, pack_id INTEGER, user_id INTEGER, token TEXT, email TEXT, name TEXT, status TEXT, error TEXT, sent_at INTEGER, clicked_at INTEGER, created_at INTEGER);`);
run(`INSERT INTO cover_packs (id, user_id, title, message, token, created_at) VALUES (1, ?, 'Ancien pack', 'Salut', 'tok', ?)`, oldOwner, now());
run(`INSERT INTO cover_pack_mails (pack_id, user_id, token, email, name, status, error, created_at) VALUES (1, ?, 'r-ancien', 'vu@test.fr', '', 'sent', '', ?)`, oldOwner, now());

const { createApp } = await import('../src/app.js');
const { outbox } = await import('../src/mail.js');
const { seal } = await import('../src/payments.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
async function call(method, route, { token, body, raw, type, expect = 200 } = {}) {
  const r = await fetch(base + route, { method, redirect: 'manual', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { 'Content-Type': type } : body ? { 'Content-Type': 'application/json' } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined) });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : r.status === 302 ? r.headers.get('location') : await r.text();
  assert.equal(r.status, expect, `${method} ${route} → ${r.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}
let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }
async function account(name, role) {
  const email = `${name.toLowerCase()}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  await call('POST', '/api/auth/verify', { body: { token: outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1] } });
  if (role) run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}

try {
  await new Promise((resolve) => setTimeout(resolve, 200)); // coverpacks.js chargé par sounds.js
  const artist = await account('Dias', 'vip'), other = await account('Lou');
  const cover = await sharp({ create: { width: 1600, height: 1600, channels: 3, background: '#203040' } }).png().toBuffer();
  await call('PUT', '/api/me/profile/page', { token: artist.token, body: { handle: 'dias7am' } });
  await call('PUT', '/api/me/profile/page', { token: other.token, body: { handle: 'lou' } });
  const v1 = await call('POST', '/api/me/vitrine?title=Nuit&price=4999', { token: artist.token, raw: cover, type: 'image/png', expect: 201 });
  const v2 = await call('POST', '/api/me/vitrine?title=Aube', { token: artist.token, raw: cover, type: 'image/png', expect: 201 });
  const foreign = await call('POST', '/api/me/vitrine?title=Pas%20a%20moi', { token: other.token, raw: cover, type: 'image/png', expect: 201 });
  let pid;

  await step('les packs de la première version deviennent des projets CLOUD', async () => {
    const moved = get(`SELECT * FROM sound_projects WHERE user_id = ? AND kind = 'covers'`, oldOwner);
    assert.deepEqual([moved.title, JSON.parse(moved.mail).message], ['Ancien pack', 'Salut']);
    assert.equal(get('SELECT COUNT(*) AS n FROM cover_packs').n, 0);
    assert.equal(get('SELECT project_id FROM cover_mails WHERE token = ?', 'r-ancien').project_id, moved.id);
  });

  await step('un projet « covers » : ses propres visuels seulement, dans l\'ordre, ni sons ni changement de type', async () => {
    pid = (await call('POST', '/api/me/sounds/projects', { token: artist.token, body: { title: 'Covers drill', kind: 'covers' }, expect: 201 })).id;
    const set = await call('PATCH', `/api/me/sounds/projects/${pid}/covers`, { token: artist.token, body: { message: 'Salut {nom}, voici mes covers.', visualIds: [v2.id, foreign.id, v1.id] } });
    assert.deepEqual(set.visualIds, [v2.id, v1.id]);
    await call('PATCH', `/api/me/sounds/projects/${pid}/covers`, { token: other.token, body: { visualIds: [] }, expect: 404 });
    await call('PATCH', `/api/me/sounds/projects/${pid}`, { token: artist.token, body: { kind: 'pack' }, expect: 400 });
    await call('POST', `/api/me/sounds/projects/${pid}/tracks?filename=a.wav`, { token: artist.token, raw: Buffer.from('RIFF'), type: 'application/octet-stream', expect: 400 });
    const cloud = await call('GET', '/api/me/sounds', { token: artist.token });
    const p = cloud.projects.find((x) => x.id === pid);
    assert.deepEqual([p.kind, p.visuals.map((v) => v.id)], ['covers', [v2.id, v1.id]]);
    const panel = await call('GET', '/api/me/cover-packs', { token: artist.token });
    assert.deepEqual([panel.handle, panel.visuals.length, panel.packs[pid].message, panel.subscribed], ['dias7am', 2, 'Salut {nom}, voici mes covers.', true]);
  });

  await step('le lien de partage : copies filigranées seulement, jamais l\'original', async () => {
    const link = await call('POST', '/api/me/sounds/links', { token: artist.token, body: { projectId: pid }, expect: 201 });
    const page = await call('POST', `/api/sounds/share/${new URL(link.url).searchParams.get('t')}`, { body: {} });
    assert.deepEqual([page.kind, page.tracks.length, page.visuals.map((v) => v.id)], ['covers', 0, [v2.id, v1.id]]);
    for (const v of [v1, v2]) assert.equal(JSON.stringify(page).includes(get('SELECT original FROM vitrine_visuals WHERE id = ?', v.id).original), false);
    // L'aperçu du lien (Discord, messageries) : un pack de covers, son nombre de covers et ses prix, pas « 0 titre ».
    assert.ok(link.url.includes('/covers?t='), link.url);
    const token = new URL(link.url).searchParams.get('t');
    const html = (await (await fetch(`${base}/covers?t=${token}`)).text()).replace(/\s/g, ' ');
    assert.ok(html.includes(`og:url" content="https://site.test/covers?t=${token}"`));
    assert.ok(html.includes('2 covers · prix : 49,99 € · Pack de covers sur ONIRIQUE'), html.match(/og:description" content="([^"]*)"/)?.[1]);
    assert.ok(!html.includes('0 titre'));
    const image = await fetch(`${base}/api/sounds/share/${token}/apercu.png`);
    assert.equal(image.status, 200);
    fs.writeFileSync(path.join(dataDir, 'apercu.png'), Buffer.from(await image.arrayBuffer()));
    console.log(`     aperçu : ${path.join(dataDir, 'apercu.png')}`);
  });

  await step('envoyer : abonnement et boîte mail exigés, liste et adresses collées, doublons et désinscrits retirés', async () => {
    run(`INSERT INTO sound_mailers (user_id, host, port, login, secret, from_name, from_email, updated_at) VALUES (?, 'smtp.test', 465, 'lou', ?, 'Lou', 'lou@boite.fr', ?)`, other.id, seal('x'), now());
    const otherPack = (await call('POST', '/api/me/sounds/projects', { token: other.token, body: { title: 'Lou', kind: 'covers' }, expect: 201 })).id;
    await call('POST', `/api/me/sounds/projects/${otherPack}/covers/send`, { token: other.token, body: { emails: 'a@test.fr' }, expect: 402 });
    await call('POST', `/api/me/sounds/projects/${pid}/covers/send`, { token: artist.token, body: { emails: 'a@test.fr' }, expect: 400 });
    run(`INSERT INTO sound_mailers (user_id, host, port, login, secret, from_name, from_email, updated_at) VALUES (?, 'smtp.test', 465, 'dias', ?, 'Dias', 'dias@boite.fr', ?)`, artist.id, seal('motdepasse'), now());
    const list = run('INSERT INTO sound_mail_lists (user_id, name, emails, created_at) VALUES (?, ?, ?, ?)', artist.id, 'Rappeurs',
      JSON.stringify([{ email: 'zed@test.fr', name: 'Zed' }, { email: 'a@test.fr', name: '' }]), now()).lastInsertRowid;
    run('INSERT INTO sound_mail_unsubs (user_id, email, at) VALUES (?, ?, ?)', artist.id, 'parti@test.fr', now());
    const before = outbox.length;
    const sent = await call('POST', `/api/me/sounds/projects/${pid}/covers/send`, { token: artist.token, body: { emails: 'a@test.fr, parti@test.fr\nNino <nino@test.fr>', listId: list }, expect: 202 });
    assert.equal(sent.total, 3);
    const mails = outbox.slice(before);
    assert.deepEqual(mails.map((m) => m.subject), ['Covers drill', 'Covers drill', 'Covers drill']);
    const zed = mails.find((m) => m.to.includes('zed@test.fr'));
    assert.ok(zed.html.includes('Salut Zed, voici mes covers.') && zed.html.includes('/api/vitrine/') && zed.from.includes('dias@boite.fr'));
    assert.deepEqual(sent.mails.map((m) => m.status), ['sent', 'sent', 'sent']);
    await call('POST', `/api/me/sounds/projects/${pid}/covers/send`, { token: artist.token, body: { listId: list }, expect: 400 });
  });

  await step('le lien du mail compte l\'ouverture et mène à la page de partage ; désinscription', async () => {
    const r = get(`SELECT * FROM cover_mails WHERE email = 'nino@test.fr'`);
    const to = await call('GET', `/api/cover-packs/m/${r.token}/ouvrir`, { expect: 302 });
    assert.ok(to.startsWith('https://site.test/covers?t='));
    assert.ok(get('SELECT clicked_at FROM cover_mails WHERE id = ?', r.id).clicked_at);
    assert.ok((await call('GET', `/api/cover-packs/m/${r.token}/desinscription`)).includes('nino@test.fr'));
    await call('POST', `/api/cover-packs/m/${r.token}/desinscription`);
    assert.ok(get(`SELECT 1 AS x FROM sound_mail_unsubs WHERE user_id = ? AND email = 'nino@test.fr'`, artist.id));
  });

  console.log(`packs de pochettes : ${passed} étapes réussies`);
} finally {
  server.close();
}
process.exit(0);
