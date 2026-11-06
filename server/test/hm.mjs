// HM (écoute partagée du CLOUD) : droits, file et flux en direct, sur une base jetable : node test/hm.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-hm-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test' });

const { createApp } = await import('../src/app.js');
const { get, run } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { act, allowed, newRoom, cleanItem } = await import('../src/hm.js');

let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }
const spotify = (title, duration = 180) => ({ engine: 'spotify', extId: '4uLU6hMCjMI75M1A2tKUQC', title, duration });
const throws = (fn, status) => assert.throws(fn, (e) => e.status === status);

await step('droits : le créateur a tout, les autres selon le réglage, les co-hôtes en plus, les expulsés rien', () => {
  const r = newRoom({ id: 1, name: 'Kay' });
  assert.deepEqual(r.perms, { add: 'all', skip: 'all', control: 'host', kick: 'host' });
  assert.equal(allowed(r, 1, 'kick'), true);
  assert.equal(allowed(r, 2, 'add'), true);
  assert.equal(allowed(r, 2, 'control'), false);
  act(r, { id: 1 }, 'perms', { perms: { control: 'cohosts', add: 'nimporte' } });
  assert.equal(r.perms.add, 'all');
  act(r, { id: 1 }, 'cohost', { userId: 2, on: true });
  assert.equal(allowed(r, 2, 'control'), true);
  assert.equal(allowed(r, 3, 'control'), false);
  throws(() => act(r, { id: 2 }, 'perms', { perms: { add: 'host' } }), 403);
  throws(() => act(r, { id: 3 }, 'kick', { userId: 2 }), 403);
  act(r, { id: 1 }, 'perms', { perms: { kick: 'all' } });
  throws(() => act(r, { id: 3 }, 'kick', { userId: 2 }), 403); // un co-hôte ne se retire que par le créateur
  throws(() => act(r, { id: 2 }, 'kick', { userId: 1 }), 400);
  act(r, { id: 2 }, 'kick', { userId: 3 });
  assert.equal(allowed(r, 3, 'add'), false);
  throws(() => act(r, { id: 3, name: 'Bob' }, 'add', { item: spotify('x') }), 403);
});

await step('file : le premier son part tout de suite, les suivants attendent ; retirer, réordonner, passer, fin', () => {
  const r = newRoom({ id: 1, name: 'Kay' });
  const a = act(r, { id: 2, name: 'Lou' }, 'add', { item: spotify('A') }, 1000);
  assert.equal(r.now.qid, a);
  assert.equal(r.now.playing, true);
  const b = act(r, { id: 2, name: 'Lou' }, 'add', { item: spotify('B') }, 1000);
  const c = act(r, { id: 3, name: 'Bob' }, 'add', { item: spotify('C') }, 1000);
  const d = act(r, { id: 3, name: 'Bob' }, 'add', { item: spotify('D'), next: true }, 1000);
  assert.deepEqual(r.queue.map((x) => x.qid), [d, b, c]);
  throws(() => act(r, { id: 2 }, 'add', { item: { engine: 'spotify', extId: '<script>' } }), 400);
  throws(() => act(r, { id: 2 }, 'add', { item: { title: 'faux', url: '/api/sounds/audio/1?e=9999999999999&d=0&s=faux' } }), 400);
  act(r, { id: 1 }, 'perms', { perms: { skip: 'host' } });
  throws(() => act(r, { id: 2 }, 'remove', { qid: c }), 403); // le son d'un autre
  act(r, { id: 3 }, 'remove', { qid: c });                    // le sien
  throws(() => act(r, { id: 2 }, 'move', { qid: b, to: 0 }), 403);
  act(r, { id: 1 }, 'move', { qid: b, to: 0 });
  assert.deepEqual(r.queue.map((x) => x.qid), [b, d]);
  act(r, { id: 2 }, 'ended', { qid: a }, 1000 + 60_000);      // trop tôt : 60 s sur 180
  assert.equal(r.now.qid, a);
  act(r, { id: 2 }, 'ended', { qid: a }, 1000 + 178_000);
  assert.equal(r.now.qid, b);
  throws(() => act(r, { id: 2 }, 'skip', {}), 403);
  act(r, { id: 1 }, 'skip', { qid: b }, 200_000);
  act(r, { id: 1 }, 'skip', { qid: b }, 200_000); // deux clics : un seul saut
  assert.equal(r.now.qid, d);
  assert.equal(r.queue.length, 0);
});

await step('un titre garde ses paroles, sa forme d’onde et son extrait signé ; le reste est refusé', () => {
  const x = cleanItem({ ...spotify('A'), lyrics: '[00:01.00] salut', peaks: [0, 0.5, 1], url: '/api/sounds/platform-items/3/preview?e=1&s=abc' });
  assert.deepEqual([x.lyrics, x.peaks, x.url], ['[00:01.00] salut', [0, 0.5, 1], '/api/sounds/platform-items/3/preview?e=1&s=abc']);
  assert.equal(cleanItem({ ...spotify('E'), engine: 'spotifyEmbed' }).engine, 'spotify'); // chacun choisit son lecteur Spotify
  const y = cleanItem({ ...spotify('B'), peaks: [2], url: '/api/autre?x=1' });
  assert.deepEqual([y.peaks, y.url], [[], null]);
});

await step('lecture : pause, reprise et avance par ceux qui contrôlent', () => {
  const r = newRoom({ id: 1, name: 'Kay' });
  act(r, { id: 1 }, 'add', { item: spotify('A') }, 0);
  throws(() => act(r, { id: 2 }, 'pause', {}, 10_000), 403);
  act(r, { id: 1 }, 'pause', {}, 10_000);
  assert.deepEqual([r.now.pos, r.now.playing], [10, false]);
  act(r, { id: 1 }, 'seek', { pos: 42 }, 20_000);
  assert.deepEqual([r.now.pos, r.now.playing], [42, false]);
  act(r, { id: 1 }, 'play', {}, 30_000);
  assert.deepEqual([r.now.pos, r.now.playing, r.now.at], [42, true, 30_000]);
});

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
async function call(method, route, { token, body, expect = 200 } = {}) {
  const response = await fetch(base + route, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, expect, `${method} ${route} → ${response.status} ${JSON.stringify(data)}`);
  return data;
}
async function account(name) {
  const email = `${name}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  const link = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await call('POST', '/api/auth/verify', { body: { token: link } });
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}
// Le flux en direct : chaque message reçu, jusqu'à ce que wanted(message) soit vrai.
async function live(code, token) {
  const response = await fetch(`${base}/api/hm/${code}/live`, { headers: { Authorization: `Bearer ${token}` } });
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  return {
    status: response.status,
    async until(wanted) {
      for (;;) {
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop();
        for (const b of blocks) if (b.startsWith('data: ')) { const m = JSON.parse(b.slice(6)); if (wanted(m)) return m; }
        const { value, done } = await reader.read();
        if (done) throw new Error('flux fermé');
        buffer += decoder.decode(value, { stream: true });
      }
    },
    close: () => reader.cancel(),
  };
}

try {
  const kay = await account('kay'), lou = await account('lou');
  let code;
  await step('par HTTP : créer, rejoindre par le lien, voir les présents, partager la file, expulser', async () => {
    await call('POST', '/api/hm', { expect: 401 });
    const created = await call('POST', '/api/hm', { token: kay.token, body: { name: 'Session du soir' }, expect: 201 });
    code = created.code;
    assert.equal(created.url, `https://site.test/mes-sons#/hm/${code}`);
    assert.equal(created.you.host, true);
    const k = await live(code, kay.token);
    await k.until((m) => m.members?.length === 1);
    const l = await live(code, lou.token);
    const seen = await k.until((m) => m.members?.length === 2);
    assert.deepEqual(seen.members.map((m) => [m.id, m.host]), [[kay.id, true], [lou.id, false]]);
    await call('POST', `/api/hm/${code}/add`, { token: lou.token, body: { item: spotify('Hail Mary') } });
    const state = await k.until((m) => m.now);
    assert.equal(state.now.item.title, 'Hail Mary');
    assert.equal(state.now.by.id, lou.id);
    await call('POST', `/api/hm/${code}/pause`, { token: lou.token, expect: 403 });
    await call('POST', `/api/hm/${code}/kick`, { token: kay.token, body: { userId: lou.id } });
    assert.deepEqual(await l.until((m) => m.kicked), { kicked: true });
    await call('GET', `/api/hm/${code}`, { token: lou.token, expect: 403 });
    await k.until((m) => m.members?.length === 1);
    k.close();
    // Tout le monde parti : en pause là où il en était ; le premier revenu le relance.
    for (let i = 0; i < 50 && (await call('GET', `/api/hm/${code}`, { token: kay.token })).now.playing; i++) await new Promise((ok) => setTimeout(ok, 20));
    const paused = await call('GET', `/api/hm/${code}`, { token: kay.token });
    assert.equal(paused.now.playing, false);
    assert.equal((await call('GET', '/api/hm/mine', { token: kay.token })).code, code);
    assert.equal((await call('GET', '/api/hm/mine', { token: lou.token })).code, null);
    const back = await live(code, kay.token);
    const resumed = await back.until((m) => m.now);
    assert.equal(resumed.now.playing, true);
    assert.ok(Math.abs(resumed.now.pos - paused.now.pos) < 0.5);
    back.close();
  });

  await step('inviter ses amis (abonnements réciproques) : seulement eux, une fois, et ils le voient', async () => {
    const max = await account('max');
    run('INSERT INTO user_follows (follower_id, followed_id, created_at) VALUES (?, ?, 0), (?, ?, 0), (?, ?, 0)', kay.id, max.id, max.id, kay.id, kay.id, lou.id);
    assert.deepEqual((await call('GET', `/api/hm/${code}/friends`, { token: kay.token })).map((f) => [f.id, f.invited]), [[max.id, false]]);
    await call('POST', `/api/hm/${code}/invite`, { token: kay.token, body: { userId: lou.id }, expect: 403 });
    await call('POST', `/api/hm/${code}/invite`, { token: kay.token, body: { userId: max.id } });
    await call('POST', `/api/hm/${code}/invite`, { token: kay.token, body: { userId: max.id } });
    assert.equal((await call('GET', `/api/hm/${code}/friends`, { token: kay.token }))[0].invited, true);
    const invites = await call('GET', '/api/hm/invites', { token: max.token });
    assert.deepEqual(invites.map((i) => [i.code, i.from.name]), [[code, 'kay']]);
    await call('POST', `/api/hm/invites/${invites[0].id}/seen`, { token: max.token });
    assert.equal((await call('GET', '/api/hm/invites', { token: max.token })).length, 0);
  });

  await step('un nouveau HM ferme le précédent ; seul le créateur ferme le sien', async () => {
    const again = await call('POST', '/api/hm', { token: kay.token, expect: 201 });
    await call('GET', `/api/hm/${code}`, { token: kay.token, expect: 404 });
    await call('DELETE', `/api/hm/${again.code}`, { token: lou.token, expect: 403 });
    await call('DELETE', `/api/hm/${again.code}`, { token: kay.token });
    await call('GET', `/api/hm/${again.code}`, { token: kay.token, expect: 404 });
  });
  console.log(`hm : ${passed} étapes ok`);
} finally {
  server.closeAllConnections?.();
  server.close();
}
