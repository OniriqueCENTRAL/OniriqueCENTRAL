// Notes, ups et top 3 de la semaine des playlists d'ONIRIQUE CLOUD, sur une base jetable : node test/ratings.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-ratings-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: 'test',
  MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test', FOUNDER_EMAILS: '' });
const { createApp } = await import('../src/app.js');
const { db, run, get, now } = await import('../src/db.js');
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
async function account(name, role = 'vip') {
  const email = `${name}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  await call('POST', '/api/auth/verify', { body: { token: outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1] } });
  run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}

try {
  const a = await account('auteur'), b = await account('auditeur'), c = await account('inconnu');
  const pl = run(`INSERT INTO sound_projects (user_id, title, kind, created_at) VALUES (?, 'Ma playlist', 'playlist', ?)`, a.id, now()).lastInsertRowid;
  const tr = run(`INSERT INTO sound_tracks (project_id, title, position, created_at) VALUES (?, 'Un son', 0, ?)`, pl, now()).lastInsertRowid;
  const v = run(`INSERT INTO sound_versions (track_id, filename, stored_as, mime, size, created_at) VALUES (?, 's.wav', 'x', 'audio/wav', 10, ?)`, tr, now()).lastInsertRowid;
  run('UPDATE sound_tracks SET current_id = ? WHERE id = ?', v, tr);
  const link = run(`INSERT INTO sound_links (token, user_id, project_id, created_at) VALUES ('jeton-ouvert', ?, ?, ?)`, a.id, pl, now()).lastInsertRowid;

  await step('noter : sa playlist, ou par un lien ouvert ; sans lien ni enregistrement, refusé', async () => {
    assert.deepEqual(await call('POST', '/api/me/sounds/rate', { token: a.token, body: { kind: 'playlist', id: pl, stars: 4 } }), { avg: 4, count: 1, mine: 4, ups: 0, upped: false });
    assert.equal((await call('POST', '/api/me/sounds/rate', { token: b.token, body: { kind: 'playlist', id: pl, stars: 5, token: 'jeton-ouvert' } })).avg, 4.5);
    await call('POST', '/api/me/sounds/rate', { token: c.token, body: { kind: 'playlist', id: pl, stars: 1 }, expect: 404 });
    await call('POST', '/api/me/sounds/rate', { token: b.token, body: { kind: 'track', id: tr, stars: 6, token: 'jeton-ouvert' }, expect: 400 });
    assert.equal((await call('POST', '/api/me/sounds/rate', { token: b.token, body: { kind: 'track', id: tr, stars: 3, token: 'jeton-ouvert' } })).count, 1);
    assert.equal((await call('POST', '/api/me/sounds/rate', { token: b.token, body: { kind: 'track', id: tr, stars: 0, token: 'jeton-ouvert' } })).count, 0); // note retirée
  });

  await step('un up par jour, par playlist et par son', async () => {
    assert.equal((await call('POST', '/api/me/sounds/up', { token: b.token, body: { kind: 'playlist', id: pl, token: 'jeton-ouvert' } })).ups, 1);
    await call('POST', '/api/me/sounds/up', { token: b.token, body: { kind: 'playlist', id: pl, token: 'jeton-ouvert' }, expect: 409 });
    assert.equal((await call('POST', '/api/me/sounds/up', { token: a.token, body: { kind: 'playlist', id: pl } })).ups, 2);
    assert.equal((await call('POST', '/api/me/sounds/up', { token: a.token, body: { kind: 'track', id: tr } })).upped, true);
    const r = await call('GET', `/api/me/sounds/ratings?playlists=${pl}&tracks=${tr}`, { token: a.token });
    assert.deepEqual([r.playlist[pl].ups, r.playlist[pl].upped, r.track[tr].ups], [2, true, 1]);
    assert.deepEqual(await call('GET', `/api/me/sounds/ratings?playlists=${pl}`, { token: c.token }), { playlist: {}, track: {} }); // pas visible
  });

  await step('top 3 de la semaine : par ups, seulement avec un lien ouvert', async () => {
    const [top] = await call('GET', '/api/me/sounds/top-week', { token: c.token });
    assert.deepEqual([top.id, top.ups, top.avg, top.url], [pl, 2, 4.5, 'https://site.test/ecoute?t=jeton-ouvert']);
    run(`UPDATE sound_links SET password_hash = 'x' WHERE id = ?`, link);
    assert.deepEqual(await call('GET', '/api/me/sounds/top-week', { token: c.token }), []);
    run('UPDATE sound_links SET password_hash = NULL WHERE id = ?', link);
    // Privée : plus dans le top ; seul son créateur la règle.
    await call('POST', `/api/me/sounds/projects/${pl}/visibility`, { token: b.token, body: { public: false }, expect: 404 });
    await call('POST', `/api/me/sounds/projects/${pl}/visibility`, { token: a.token, body: { public: false } });
    assert.deepEqual(await call('GET', '/api/me/sounds/top-week', { token: c.token }), []);
    await call('POST', `/api/me/sounds/projects/${pl}/visibility`, { token: a.token, body: { public: true } });
    assert.equal((await call('GET', '/api/me/sounds/top-week', { token: c.token })).length, 1);
    // Une playlist créée est privée ; un projet, lui, n'est pas concerné.
    const fresh = (await call('POST', '/api/me/sounds/projects', { token: a.token, body: { title: 'Nouvelle', kind: 'playlist' }, expect: 201 })).id;
    const album = (await call('POST', '/api/me/sounds/projects', { token: a.token, body: { title: 'Album' }, expect: 201 })).id;
    const mine = (await call('GET', '/api/me/sounds', { token: a.token })).projects;
    assert.deepEqual([mine.find((x) => x.id === fresh).public, mine.find((x) => x.id === album).public], [false, true]);
  });

  await step('qui a enregistré la playlist : visible par son créateur seulement', async () => {
    run('INSERT INTO sound_saves (user_id, link_id, created_at) VALUES (?, ?, ?)', c.id, link, now());
    assert.deepEqual((await call('GET', `/api/me/sounds/projects/${pl}/savers`, { token: a.token })).map((x) => x.name), ['inconnu']);
    await call('GET', `/api/me/sounds/projects/${pl}/savers`, { token: b.token, expect: 404 });
    run('DELETE FROM sound_saves WHERE user_id = ?', c.id);
  });

  await step('ajouter un son de la playlist d’un autre : seulement si son créateur l’autorise', async () => {
    const mine = run(`INSERT INTO sound_projects (user_id, title, kind, created_at) VALUES (?, 'La mienne', 'playlist', ?)`, b.id, now()).lastInsertRowid;
    const save = run('INSERT INTO sound_saves (user_id, link_id, created_at) VALUES (?, ?, ?)', b.id, link, now()).lastInsertRowid;
    assert.equal((await call('GET', '/api/sounds/share/jeton-ouvert/members-add', { token: b.token })).open, false);
    await call('POST', `/api/me/sounds/saves/${save}/add`, { token: b.token, body: { projectId: mine, trackId: tr }, expect: 403 });
    await call('POST', `/api/me/sounds/projects/${pl}/members-add`, { token: b.token, body: { open: true }, expect: 404 }); // pas le créateur
    await call('POST', `/api/me/sounds/projects/${pl}/members-add`, { token: a.token, body: { open: true } });
    assert.equal((await call('GET', '/api/sounds/share/jeton-ouvert/members-add', { token: b.token })).open, true);
    await call('POST', `/api/me/sounds/saves/${save}/add`, { token: b.token, body: { projectId: mine, trackId: tr }, expect: 201 });
  });
  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  db.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows garde parfois la base ouverte un instant */ }
}
process.exit(0);
