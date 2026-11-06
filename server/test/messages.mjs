// La messagerie privée (réponses, réactions, photos, vocaux, sons du CLOUD, modification, suppression, recherche,
// direct), sur une base jetable : node test/messages.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-messages-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: 'test',
  MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test', FOUNDER_EMAILS: '' });
const { createApp } = await import('../src/app.js');
const { db, get, run, now } = await import('../src/db.js');
const { versionAudio } = await import('../src/sounds.js');
const { outbox } = await import('../src/mail.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
async function call(method, route, { token, body, raw, type, expect = 200 } = {}) {
  const r = await fetch(base + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : type ? { 'Content-Type': type } : {}) },
    body: body ? JSON.stringify(body) : raw });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
  assert.equal(r.status, expect, `${method} ${route} → ${r.status} ${JSON.stringify(data)}`);
  return data;
}
let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }
async function account(name, handle) {
  const email = `${name.toLowerCase()}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  await call('POST', '/api/auth/verify', { body: { token: outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1] } });
  if (handle) await call('PUT', '/api/me/profile/page', { token, body: { handle } });
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}
const thread = (who, handle) => call('GET', `/api/me/messages/${handle}`, { token: who.token });
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40)]);
const WEBM = Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.alloc(40)]);

try {
  const a = await account('Nov', 'nov'), b = await account('Lou', 'lou'), c = await account('Zed', 'zed');

  await step('répondre à un message, « Vu » une fois lu', async () => {
    const { id } = await call('POST', '/api/me/messages/nov', { token: b.token, body: { body: 'Tu as le beat ?' }, expect: 201 });
    await call('POST', '/api/me/messages/lou', { token: a.token, body: { body: 'Oui', replyTo: id }, expect: 201 });
    let t = await thread(b, 'nov');
    assert.deepEqual(t.messages.map((m) => [m.body, m.mine, m.read]), [['Tu as le beat ?', true, false], ['Oui', false, true]]);
    assert.deepEqual(t.messages[1].reply, { id, mine: true, text: 'Tu as le beat ?' });
    // Une réponse ne vise qu'un message de la même conversation.
    const other = (await call('POST', '/api/me/messages/zed', { token: b.token, body: { body: 'Salut Zed' }, expect: 201 })).id;
    await call('POST', '/api/me/messages/lou', { token: a.token, body: { body: 'x', replyTo: other }, expect: 400 });
    t = await thread(a, 'lou');
    assert.equal((await thread(b, 'nov')).messages[0].read, true);
  });

  await step('réagir : une réaction par personne, la même la retire', async () => {
    const id = (await thread(a, 'lou')).messages[0].id;
    await call('POST', `/api/me/message/${id}/react`, { token: a.token, body: { emoji: '🔥' } });
    await call('POST', `/api/me/message/${id}/react`, { token: b.token, body: { emoji: '🔥' } });
    assert.deepEqual((await thread(a, 'lou')).messages[0].reactions, [{ emoji: '🔥', count: 2, mine: true }]);
    await call('POST', `/api/me/message/${id}/react`, { token: a.token, body: { emoji: '❤️' } });
    await call('POST', `/api/me/message/${id}/react`, { token: b.token, body: { emoji: '🔥' } });
    assert.deepEqual((await thread(b, 'nov')).messages[0].reactions, [{ emoji: '❤️', count: 1, mine: false }]);
    await call('POST', `/api/me/message/${id}/react`, { token: a.token, body: { emoji: '💩' }, expect: 400 });
    await call('POST', `/api/me/message/${id}/react`, { token: c.token, body: { emoji: '🔥' }, expect: 404 }); // pas sa conversation
  });

  await step('modifier et supprimer seulement ses messages', async () => {
    const [first, second] = (await thread(b, 'nov')).messages;
    await call('PUT', `/api/me/message/${second.id}`, { token: b.token, body: { body: 'Non' }, expect: 403 });
    await call('PUT', `/api/me/message/${first.id}`, { token: b.token, body: { body: 'Tu as le beat ??' } });
    let t = await thread(a, 'lou');
    assert.deepEqual([t.messages[0].body, t.messages[0].edited, t.messages[0].canEdit], ['Tu as le beat ??', true, false]);
    run('UPDATE user_messages SET created_at = ? WHERE id = ?', now() - 20 * 60_000, first.id);
    await call('PUT', `/api/me/message/${first.id}`, { token: b.token, body: { body: 'trop tard' }, expect: 403 });
    await call('DELETE', `/api/me/message/${first.id}`, { token: a.token, expect: 403 });
    await call('DELETE', `/api/me/message/${first.id}`, { token: b.token });
    t = await thread(a, 'lou');
    assert.deepEqual([t.messages[0].body, t.messages[0].deleted, t.messages[0].reactions], ['', true, []]);
    assert.equal(t.messages[1].reply.text, 'Message supprimé');
    await call('DELETE', `/api/me/message/${first.id}`, { token: b.token, expect: 410 });
  });

  await step('photo et vocal : lus seulement par les deux membres', async () => {
    const { id } = await call('POST', '/api/me/messages/nov/file', { token: b.token, raw: PNG, type: 'image/png', expect: 201 });
    const voice = (await call('POST', '/api/me/messages/nov/file?duration=12.5', { token: b.token, raw: WEBM, type: 'audio/webm', expect: 201 })).id;
    await call('POST', '/api/me/messages/nov/file', { token: b.token, raw: Buffer.from('<script>alert(1)</script>'), type: 'image/png', expect: 400 });
    const t = await thread(a, 'lou');
    assert.deepEqual(t.messages.slice(-2).map((m) => m.attach), [{ type: 'image', url: `/api/me/message/${id}/file`, duration: 0 }, { type: 'voice', url: `/api/me/message/${voice}/file`, duration: 12.5 }]);
    assert.deepEqual(await call('GET', `/api/me/message/${id}/file`, { token: a.token }), PNG);
    await call('GET', `/api/me/message/${id}/file`, { token: c.token, expect: 404 });
    assert.equal((await call('GET', '/api/me/messages', { token: a.token }))[0].last, '🎤 Vocal');
    // Supprimé, le fichier part aussi.
    await call('DELETE', `/api/me/message/${id}`, { token: b.token });
    assert.equal(fs.readdirSync(path.join(dataDir, 'messages')).length, 1);
  });

  await step('partager des sons du CLOUD : adresse vérifiée, renouvelée pour celui qui lit', async () => {
    const pl = run(`INSERT INTO sound_projects (user_id, title, kind, created_at) VALUES (?, 'Nuit', 'playlist', ?)`, a.id, now()).lastInsertRowid;
    const track = run(`INSERT INTO sound_tracks (project_id, title, position, created_at) VALUES (?, 'Un son', 0, ?)`, pl, now()).lastInsertRowid;
    const vid = run(`INSERT INTO sound_versions (track_id, filename, stored_as, mime, size, duration, created_at) VALUES (?, 'a.wav', 'x', 'audio/wav', 1, 90, ?)`, track, now()).lastInsertRowid;
    const items = [{ title: 'Un son', url: versionAudio(vid).url, duration: 90 }, { title: 'Jefe', engine: 'deezer', extId: '11', url: 'https://cdn.test/jefe.mp3' }];
    await call('POST', '/api/me/messages/lou', { token: a.token, body: { sounds: { title: 'Nuit', items }, body: 'Écoute ça' }, expect: 201 });
    await call('POST', '/api/me/messages/lou', { token: a.token, body: { sounds: { title: 'x', items: [{ title: 'Volé', url: `/api/sounds/audio/${vid}?e=9999999999999&d=0&s=faux` }] } }, expect: 400 });
    await call('POST', '/api/me/messages/lou', { token: a.token, body: { sounds: { title: 'x', items: [] } }, expect: 400 });
    const m = (await thread(b, 'nov')).messages.at(-1);
    assert.deepEqual([m.body, m.attach.type, m.attach.title, m.attach.items.map((x) => x.title)], ['Écoute ça', 'sounds', 'Nuit', ['Un son', 'Jefe']]);
    assert.match(m.attach.items[0].url, new RegExp(`^/api/sounds/audio/${vid}\\?e=\\d+&d=0&s=`));
    assert.equal(m.attach.items[0].version, undefined);
    run('DELETE FROM sound_versions WHERE id = ?', vid); // retiré du CLOUD : plus d'adresse
    assert.equal((await thread(b, 'nov')).messages.at(-1).attach.items[0].url, null);
  });

  await step('chercher dans ses messages, jamais dans ceux des autres', async () => {
    let r = await call('GET', `/api/me/messages-search?q=ecoute`, { token: b.token });
    assert.deepEqual(r.map((x) => [x.with.handle, x.mine]), [['nov', false]]);
    r = await call('GET', '/api/me/messages-search?q=nuit', { token: b.token }); // les titres partagés aussi
    assert.equal(r.length, 1);
    assert.deepEqual(await call('GET', '/api/me/messages-search?q=Salut', { token: a.token }), []);
    assert.deepEqual(await call('GET', '/api/me/messages-search?q=%25', { token: b.token, expect: 400 }), { error: 'Cherche au moins deux lettres.' });
    assert.deepEqual(await call('GET', '/api/me/messages-search?q=%25%25', { token: b.token }), []);
  });

  await step('le direct : nouveau message, « en train d’écrire », « Vu »', async () => {
    const ctrl = new AbortController();
    const r = await fetch(`${base}/api/me/messages-live`, { headers: { Authorization: `Bearer ${a.token}` }, signal: ctrl.signal });
    assert.ok(r.headers.get('content-type').startsWith('text/event-stream'));
    const reader = r.body.getReader(), events = [];
    let buffer = '';
    const until = async (n) => {
      while (events.length < n) {
        buffer += new TextDecoder().decode((await reader.read()).value);
        for (const b of buffer.split('\n\n').slice(0, -1)) if (b.startsWith('data: ')) events.push(JSON.parse(b.slice(6)));
        buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2);
      }
    };
    await call('POST', '/api/me/messages/nov/typing', { token: b.token });
    await call('POST', '/api/me/messages/nov', { token: b.token, body: { body: 'Direct' }, expect: 201 });
    await thread(b, 'nov'); // rien de neuf à lire pour Lou : pas de « Vu » envoyé
    await call('POST', '/api/me/messages/lou', { token: a.token, body: { body: 'Reçu' }, expect: 201 });
    await thread(b, 'nov');
    await until(4);
    assert.deepEqual(events, [{ type: 'typing', with: b.id }, { type: 'message', with: b.id }, { type: 'message', with: b.id }, { type: 'read', with: b.id }]);
    ctrl.abort();
    await call('POST', '/api/me/messages/nov/typing', { token: c.token });
    await call('GET', '/api/me/messages-live', { expect: 401 });
  });

  await step('notifications : le réglage « message » existe et se coupe', async () => {
    assert.equal((await call('GET', '/api/me/notifications', { token: a.token })).push.message, true);
    assert.equal((await call('PUT', '/api/me/notifications', { token: a.token, body: { push: { message: false } } })).push.message, false);
  });
  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  db.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
process.exit(0);
