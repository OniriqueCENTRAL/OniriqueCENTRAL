// WATCHPARTY : droits, synchronisation et flux en direct (présents, chat, signal WebRTC), sur une base jetable : node test/watchparty.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-watchparty-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test' });

const { createApp } = await import('../src/app.js');
const { get, run } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { act, newRoom, youtubeId, cleanSource, positionOf, isMember } = await import('../src/watchparty.js');

let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }
const throws = (fn, status) => assert.throws(fn, (e) => e.status === status);

await step('réservée aux membres ONIRIQUE, beta-testeurs, équipe et fondateurs', () => {
  for (const role of ['vip', 'beta', 'betaf', 'admin', 'founder']) assert.equal(isMember({ role }), true, role);
  for (const role of ['user', 'abrasion', 'relic']) assert.equal(isMember({ role }), false, role);
});

await step('sources : YouTube sous toutes ses formes, vidéo en https ; le reste refusé', () => {
  for (const u of ['dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=4', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ'])
    assert.equal(youtubeId(u), 'dQw4w9WgXcQ', u);
  assert.equal(youtubeId('https://evil.test/watch?v=dQw4w9WgXcQ'), null);
  assert.deepEqual(cleanSource('https://cdn.test/films/mon%20film.mp4'), { kind: 'url', url: 'https://cdn.test/films/mon%20film.mp4', title: 'mon film.mp4' });
  const src = (u) => { const { title, ...x } = cleanSource(u); return x; };
  assert.deepEqual(src('https://www.twitch.tv/Kameto'), { kind: 'twitch', channel: 'kameto', live: true });
  assert.deepEqual(src('https://www.twitch.tv/videos/2290876543'), { kind: 'twitch', video: '2290876543' });
  assert.deepEqual(src('https://www.twitch.tv/kameto/clip/FunnyClipSlug-abc'), { kind: 'twitch', clip: 'FunnyClipSlug-abc', nosync: true });
  assert.deepEqual(src('https://clips.twitch.tv/FunnyClipSlug'), { kind: 'twitch', clip: 'FunnyClipSlug', nosync: true });
  assert.equal(src('https://www.twitch.tv/directory').kind, 'url'); // une page de Twitch, pas une chaîne
  assert.deepEqual(src('https://vimeo.com/76979871'), { kind: 'vimeo', id: '76979871' });
  assert.deepEqual(src('https://vimeo.com/76979871/abc123def0'), { kind: 'vimeo', id: '76979871', hash: 'abc123def0' });
  assert.deepEqual(src('https://kick.com/xqc'), { kind: 'kick', channel: 'xqc', live: true });
  throws(() => cleanSource('http://cdn.test/a.mp4'), 400);
  throws(() => cleanSource('javascript:alert(1)'), 400);
});

await step('droits : changer la vidéo au créateur, la lecture à tous, réglables ; un expulsé ne peut plus rien', () => {
  const r = newRoom({ id: 1, name: 'Kay' });
  throws(() => act(r, { id: 2 }, 'source', { source: 'dQw4w9WgXcQ' }), 403);
  act(r, { id: 1 }, 'source', { source: 'dQw4w9WgXcQ' }, 0);
  act(r, { id: 2 }, 'pause', {}, 5000);
  act(r, { id: 1 }, 'perms', { perms: { control: 'cohosts', source: 'n importe' } });
  assert.equal(r.perms.source, 'host');
  throws(() => act(r, { id: 2 }, 'play', {}), 403);
  act(r, { id: 1 }, 'cohost', { userId: 2, on: true });
  act(r, { id: 2 }, 'play', {}, 6000);
  throws(() => act(r, { id: 2 }, 'perms', { perms: { control: 'all' } }), 403);
  act(r, { id: 1 }, 'kick', { userId: 3 });
  throws(() => act(r, { id: 3, name: 'Bob' }, 'chat', { text: 'coucou' }), 403);
});

await step('synchronisation : pause, avance et reprise donnent la même position à tous', () => {
  const r = newRoom({ id: 1, name: 'Kay' });
  act(r, { id: 1 }, 'source', { source: 'https://cdn.test/a.mp4' }, 1000);
  assert.equal(positionOf(r, 11_000), 10);
  act(r, { id: 2 }, 'pause', {}, 11_000);
  assert.deepEqual([r.pos, r.playing, positionOf(r, 99_000)], [10, false, 10]);
  act(r, { id: 2 }, 'seek', { pos: 120 }, 12_000);
  assert.deepEqual([r.pos, r.playing], [120, false]);
  act(r, { id: 2 }, 'play', {}, 20_000);
  assert.equal(positionOf(r, 25_000), 125);
  act(r, { id: 2 }, 'seek', { pos: -5 }, 25_000);
  assert.equal(r.pos, 0);
});

await step('partage : seulement depuis un flux ouvert, et seul celui qui partage (ou le créateur) l’arrête', () => {
  const r = newRoom({ id: 1, name: 'Kay' });
  act(r, { id: 1 }, 'perms', { perms: { source: 'all' } });
  throws(() => act(r, { id: 2, name: 'Lou' }, 'share', { what: 'screen' }), 400);
  act(r, { id: 2, name: 'Lou' }, 'share', { what: 'camera' }, 0, 'peerLou');
  assert.deepEqual([r.media.kind, r.media.peer, r.media.what], ['share', 'peerLou', 'camera']);
  act(r, { id: 1 }, 'perms', { perms: { source: 'host' } });
  throws(() => act(r, { id: 3 }, 'unshare'), 403);
  act(r, { id: 1 }, 'unshare');
  assert.equal(r.media, null);
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
async function account(name, role) {
  const email = `${name}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  const link = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await call('POST', '/api/auth/verify', { body: { token: link } });
  run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}
async function live(code, token) {
  const response = await fetch(`${base}/api/watchparty/${code}/live`, { headers: { Authorization: `Bearer ${token}` } });
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
  const kay = await account('kay', 'vip'), lou = await account('lou', 'beta'), max = await account('max', 'user');
  await step('par HTTP : ouvrir, rejoindre par le lien, présents, chat, lecture synchronisée, signal WebRTC, expulsion', async () => {
    await call('POST', '/api/watchparty', { token: max.token, expect: 403 });
    const created = await call('POST', '/api/watchparty', { token: kay.token, body: { name: 'Ciné du soir', source: 'https://youtu.be/dQw4w9WgXcQ' }, expect: 201 });
    const { code } = created;
    assert.equal(created.url, `https://site.test/watchparty#${code}`);
    assert.deepEqual([created.media.kind, created.media.id, created.playing], ['youtube', 'dQw4w9WgXcQ', false]);
    await call('GET', `/api/watchparty/${code}`, { token: max.token, expect: 403 });
    const k = await live(code, kay.token);
    const kState = await k.until((m) => m.members?.length === 1);
    const l = await live(code, lou.token);
    const seen = await k.until((m) => m.members?.length === 2);
    assert.deepEqual(seen.members.map((m) => [m.id, m.host]), [[kay.id, true], [lou.id, false]]);
    const lState = await l.until((m) => m.you?.peer);

    await call('POST', `/api/watchparty/${code}/play`, { token: lou.token });
    const playing = await k.until((m) => m.playing);
    assert.equal(playing.pos, 0);
    await call('POST', `/api/watchparty/${code}/seek`, { token: lou.token, body: { pos: 63 } });
    assert.equal((await k.until((m) => m.pos === 63)).playing, true);
    await call('POST', `/api/watchparty/${code}/source`, { token: lou.token, body: { source: 'dQw4w9WgXcQ' }, expect: 403 });

    await call('POST', `/api/watchparty/${code}/chat`, { token: lou.token, body: { text: '  salut   tout le monde ' } });
    assert.deepEqual((await k.until((m) => m.chat?.length)).chat.map((c) => [c.name, c.text]), [['lou', 'salut tout le monde']]);

    // Kay partage son écran depuis son flux ; Lou reçoit l'offre de ce flux-là, et personne ne parle à la place d'un autre.
    await call('POST', `/api/watchparty/${code}/share`, { token: kay.token, body: { what: 'screen', peer: kState.you.peer } });
    assert.equal((await l.until((m) => m.media?.kind === 'share')).media.peer, kState.you.peer);
    await call('POST', `/api/watchparty/${code}/signal`, { token: kay.token, body: { from: kState.you.peer, to: lState.you.peer, data: { sdp: { type: 'offer', sdp: 'v=0' } } } });
    assert.deepEqual((await l.until((m) => m.signal)).signal, { from: kState.you.peer, data: { sdp: { type: 'offer', sdp: 'v=0' } } });
    await call('POST', `/api/watchparty/${code}/signal`, { token: lou.token, body: { from: kState.you.peer, to: lState.you.peer, data: {} }, expect: 403 });

    await call('POST', `/api/watchparty/${code}/kick`, { token: kay.token, body: { userId: lou.id } });
    assert.deepEqual(await l.until((m) => m.kicked), { kicked: true });
    await call('GET', `/api/watchparty/${code}`, { token: lou.token, expect: 403 });
    k.close();
    // Celui qui partageait est parti : le partage s'arrête pour tous.
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await call('GET', `/api/watchparty/${code}`, { token: kay.token })).media, null);
    assert.deepEqual(await call('GET', '/api/watchparty/mine', { token: kay.token }), { code });
    await call('DELETE', `/api/watchparty/${code}`, { token: kay.token });
    await call('GET', `/api/watchparty/${code}`, { token: kay.token, expect: 404 });
  });
  await step('inviter ses amis (abonnements réciproques, ayant accès) : une fois, dans l’Activité et en pop-up', async () => {
    const zoe = await account('zoe', 'betaf');
    const { code } = await call('POST', '/api/watchparty', { token: kay.token, expect: 201 });
    // zoe et max suivent kay en retour ; lou est suivie sans réciprocité ; max n'a pas accès à la WATCHPARTY.
    run('INSERT INTO user_follows (follower_id, followed_id, created_at) VALUES (?, ?, 0), (?, ?, 0), (?, ?, 0), (?, ?, 0), (?, ?, 0)',
      kay.id, zoe.id, zoe.id, kay.id, kay.id, max.id, max.id, kay.id, kay.id, lou.id);
    assert.deepEqual((await call('GET', `/api/watchparty/${code}/friends`, { token: kay.token })).map((f) => [f.id, f.invited]), [[zoe.id, false]]);
    await call('POST', `/api/watchparty/${code}/invite`, { token: kay.token, body: { userId: max.id }, expect: 403 });
    await call('POST', `/api/watchparty/${code}/invite`, { token: kay.token, body: { userId: lou.id }, expect: 403 });
    await call('POST', `/api/watchparty/${code}/invite`, { token: kay.token, body: { userId: zoe.id } });
    await call('POST', `/api/watchparty/${code}/invite`, { token: kay.token, body: { userId: zoe.id } });
    assert.equal((await call('GET', `/api/watchparty/${code}/friends`, { token: kay.token }))[0].invited, true);
    const activity = await call('GET', '/api/me/activity', { token: zoe.token });
    assert.deepEqual(activity.filter((n) => n.kind === 'watchparty').map((n) => n.page), [code]);
    // Le HM et la WATCHPARTY ont chacun leurs invitations.
    assert.equal((await call('GET', '/api/hm/invites', { token: zoe.token })).length, 0);
    const invites = await call('GET', '/api/watchparty/invites', { token: zoe.token });
    assert.deepEqual(invites.map((i) => [i.code, i.from.name]), [[code, 'kay']]);
    await call('POST', `/api/watchparty/invites/${invites[0].id}/seen`, { token: zoe.token });
    assert.equal((await call('GET', '/api/watchparty/invites', { token: zoe.token })).length, 0);
    await call('GET', '/api/watchparty/invites', { token: max.token, expect: 403 });
  });
  console.log(`watchparty : ${passed} étapes ok`);
} finally {
  server.closeAllConnections?.();
  server.close();
}
