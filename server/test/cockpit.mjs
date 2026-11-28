// Le Cockpit (journal des publications, chiffres à 48 h, banque de phrases, régularité), sur une base jetable : node test/cockpit.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-cockpit-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test' });

const { createApp } = await import('../src/app.js');
const { run, get } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { dayStatus, cockpitOf, stockOf } = await import('../src/cockpit.js');

// ——— La couleur d'une journée ———
assert.equal(dayStatus({ tiktoks: 2, replies: true, missingStats: 0 }), 'ok');
assert.equal(dayStatus({ tiktoks: 3, replies: true, missingStats: 1 }), 'part', 'chiffres de l’avant-veille pas notés');
assert.equal(dayStatus({ tiktoks: 1, replies: false, missingStats: 0 }), 'part');
assert.equal(dayStatus({ tiktoks: 0, replies: false, missingStats: 2 }), 'none');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (token, method, url, body) => {
  const r = await fetch(base + '/api' + url, { method, body: body && JSON.stringify(body),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
async function account(name, role) {
  const email = `${name}@test.local`;
  const { token } = await (await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'motdepasse1', name }) })).json();
  const link = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await fetch(base + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: link }) });
  if (role) run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}

try {
  assert.equal((await call('', 'GET', '/cockpit')).status, 401);
  const simple = await account('simple');
  assert.equal((await call(simple.token, 'GET', '/cockpit')).status, 403, 'réservé aux membres ONIRIQUE');
  const me = await account('euhz', 'founder'), other = await account('autre', 'vip');

  // Deux vidéos dans le cloud CUT : stock de 2.
  const video = (name) => run('INSERT INTO cut_videos (user_id, name, stored_as, size, created_at) VALUES (?, ?, ?, 1, ?)', me.id, name, name, Date.now()).lastInsertRowid;
  const v1 = Number(video('MGL')), v2 = Number(video('DEAD'));
  assert.equal(stockOf(me.id), 2);

  // La banque de phrases.
  assert.equal((await call(me.token, 'POST', '/cockpit/phrases', { title: 'MGL' })).status, 400, 'phrase vide');
  const ph = (await call(me.token, 'POST', '/cockpit/phrases', { title: 'MGL', text: 'Une phrase qui se comprend seule' })).data;
  assert.equal(ph.uses, 0);
  const otherPhrase = (await call(other.token, 'POST', '/cockpit/phrases', { title: 'X', text: 'à un autre' })).data;

  // Le journal : on ne peut pas citer la vidéo ou la phrase de quelqu'un d'autre ; lien en https seulement.
  assert.equal((await call(me.token, 'POST', '/cockpit/posts', { network: 'tiktok', phraseId: otherPhrase.id })).status, 404);
  assert.equal((await call(other.token, 'POST', '/cockpit/posts', { network: 'tiktok', cutVideoId: v1 })).status, 404);
  assert.equal((await call(me.token, 'POST', '/cockpit/posts', { network: 'tiktok', url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await call(me.token, 'POST', '/cockpit/posts', { network: 'myspace' })).status, 400);
  const posted = await call(me.token, 'POST', '/cockpit/posts', { network: 'tiktok', cutVideoId: v1, phraseId: ph.id, format: 'Réplique → drop', hook: 'Spider-Man' });
  assert.equal(posted.status, 201);
  assert.equal(stockOf(me.id), 1, 'une vidéo postée sur TikTok sort du stock');
  await call(me.token, 'POST', '/cockpit/posts', { network: 'instagram', cutVideoId: v2 });
  assert.equal(stockOf(me.id), 1, 'un Reel ne compte pas comme TikTok');
  const lib = (await call(me.token, 'GET', '/cut/library')).data;
  assert.equal(lib.stock, 1);
  assert.ok(lib.videos.find((v) => v.id === v1).tiktokAt, 'la vidéo postée le montre dans Mes vidéos');
  assert.equal(lib.videos.find((v) => v.id === v2).tiktokAt, null);

  // Les chiffres à 48 h : entiers positifs ; le taux se calcule pour 1 000 vues.
  assert.equal((await call(me.token, 'PATCH', `/cockpit/posts/${posted.data.id}`, { views: -3 })).status, 400);
  assert.equal((await call(other.token, 'PATCH', `/cockpit/posts/${posted.data.id}`, { views: 3 })).status, 404, 'pas la publication d’un autre');
  const filled = (await call(me.token, 'PATCH', `/cockpit/posts/${posted.data.id}`, { views: 20000, saves: 600 })).data;
  assert.equal(filled.rate, 30);
  assert.equal(filled.hook, 'Spider-Man', 'les champs non donnés restent');

  // Le calendrier, vu depuis Paris : un jour avec 2 TikTok, les réponses faites et les chiffres de l'avant-veille notés est « ok ».
  const at = Date.parse('2026-12-02T20:00:00Z'), noon = (d) => Date.parse(d + 'T11:00:00Z');
  run('DELETE FROM cockpit_posts WHERE user_id = ?', me.id);
  const add = (day, extra = {}) => run(`INSERT INTO cockpit_posts (user_id, network, posted_at, created_at, views) VALUES (?, 'tiktok', ?, ?, ?)`, me.id, noon(day), noon(day), extra.views ?? null);
  add('2026-11-30'); add('2026-12-02', { views: 10 }); add('2026-12-02', { views: 10 }); add('2026-12-01', { views: 5 }); add('2026-12-01', { views: 5 });
  run('INSERT INTO cockpit_days (user_id, day) VALUES (?, ?), (?, ?)', me.id, '2026-12-01', me.id, '2026-12-02');
  const c = cockpitOf(me.id, 'Europe/Paris', at);
  assert.equal(c.today.day, '2026-12-02');
  assert.equal(c.today.missingStats, 1, 'la vidéo du 30/11 attend ses chiffres');
  assert.equal(c.today.status, 'part');
  assert.equal(c.calendar.find((d) => d.day === '2026-12-01').status, 'ok');
  assert.equal(c.calendar.find((d) => d.day === '2026-11-30').status, 'part');
  assert.equal(c.calendar.length, 56, '8 semaines du lundi au dimanche');
  assert.equal(c.calendar[0].day, '2026-10-12', 'commence un lundi');
  assert.equal(c.calendar.at(-1).status, 'future');
  assert.equal(c.week.tiktoks, 5, 'semaine du lundi 30/11');
  assert.equal(c.toFill.length, 1);
  assert.equal(cockpitOf(me.id, 'nimporte/quoi', at).tz, 'Europe/Paris', 'fuseau inconnu : Paris');

  // « Réponses faites » coché puis décoché ; un jour mal écrit est refusé.
  assert.equal((await call(me.token, 'PUT', '/cockpit/days/2026-13-01', { replies: true })).status, 400);
  assert.equal((await call(me.token, 'PUT', '/cockpit/days/2026-12-02', { replies: false })).data.replies, false);
  assert.equal(get('SELECT COUNT(*) AS n FROM cockpit_days WHERE user_id = ? AND day = ?', me.id, '2026-12-02').n, 0);

  // La page entière répond ; une phrase retirée laisse ses publications, sans phrase.
  const page = await call(me.token, 'GET', '/cockpit?tz=Europe/Paris');
  assert.equal(page.status, 200);
  assert.ok(Array.isArray(page.data.phrases) && page.data.phrases.length === 1);
  run('UPDATE cockpit_posts SET phrase_id = ? WHERE user_id = ?', ph.id, me.id);
  assert.equal((await call(other.token, 'DELETE', `/cockpit/phrases/${ph.id}`)).status, 404);
  assert.equal((await call(me.token, 'DELETE', `/cockpit/phrases/${ph.id}`)).status, 200);
  assert.equal(get('SELECT COUNT(*) AS n FROM cockpit_posts WHERE user_id = ? AND phrase_id IS NOT NULL', me.id).n, 0);
  console.log('Cockpit : tout va bien.');
} finally {
  server.close();
}
