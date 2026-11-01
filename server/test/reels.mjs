// Reels Instagram programmés depuis le cloud CUT (fondateurs), sur une base jetable et sans jamais joindre Instagram :
// node test/reels.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-reels-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: 'test',
  MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://api.test', INSTAGRAM_APP_ID: '123', INSTAGRAM_APP_SECRET: 'secret' });

const { createApp } = await import('../src/app.js');
const { run, get, setSetting } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { seal } = await import('../src/payments.js');
const { publishDueReels } = await import('../src/cut.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

// Instagram est joué ici : chaque appel est noté et reçoit la réponse que ferait l'API.
const realFetch = globalThis.fetch;
const calls = [];
let refuse = false;
globalThis.fetch = async (url, options = {}) => {
  url = String(url);
  if (url.startsWith(base)) return realFetch(url, options);
  calls.push({ url, body: options.body ? Object.fromEntries(new URLSearchParams(options.body)) : null });
  if (url.endsWith('/media') && options.method === 'POST') {
    return refuse ? Response.json({ error: { message: 'Application does not have permission for this action' } }, { status: 400 }) : Response.json({ id: 'CONTENEUR' });
  }
  if (url.includes('/CONTENEUR?')) return Response.json({ status_code: calls.filter((c) => c.url.includes('/CONTENEUR?')).length > 1 ? 'FINISHED' : 'IN_PROGRESS' });
  if (url.endsWith('/media_publish')) return Response.json({ id: 'MEDIA9' });
  if (url.includes('/MEDIA9?')) return Response.json({ permalink: 'https://www.instagram.com/reel/abc/' });
  return Response.json({}, { status: 404 });
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
const call = (token, method, route, body) => fetch(base + route, { method,
  headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

try {
  setSetting('sounds_disk_max', 1);
  const boss = await account('fondateur', 'founder'), vip = await account('membre', 'vip');
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42', 'latin1'), Buffer.alloc(3000, 7)]);
  const keep = async (name) => (await fetch(`${base}/api/cut/library?name=${encodeURIComponent(name)}&duration=9&caption=${encodeURIComponent('« Une phrase » 😔\n#rapfr')}`,
    { method: 'POST', body: mp4, headers: { 'Content-Type': 'video/mp4', Authorization: `Bearer ${boss.token}` } })).json();
  const a = await keep('Clip A'), b = await keep('Clip B');
  assert.ok(a.id && b.id, 'vidéos gardées : ' + JSON.stringify(a));
  const soon = Date.now() + 3600_000;

  // Réservé : un membre n'a pas le cloud CUT ; Instagram non relié, l'état le dit (le menu est prêt quand même).
  assert.equal((await call(vip.token, 'GET', '/api/cut/reels')).status, 403);
  const empty = await (await call(boss.token, 'GET', '/api/cut/reels')).json();
  assert.deepEqual(empty, { allowed: true, configured: true, account: null, reels: [], inReels: [] });

  // Programmer : la description de la vidéo par défaut, une date à venir, et le type de Reel vérifié.
  const reel = (id, body) => call(boss.token, 'POST', `/api/cut/library/${id}/reel`, body);
  assert.equal((await reel(a.id, { publishAt: Date.now() - 3600_000 })).status, 400, 'date passée');
  assert.equal((await reel(a.id, { publishAt: soon, trial: 'NIMPORTE' })).status, 400, 'type inconnu');
  assert.equal((await reel(a.id, { publishAt: soon, caption: Array.from({ length: 31 }, (_, i) => '#t' + i).join(' ') })).status, 400, '31 hashtags');
  const first = await reel(a.id, { publishAt: soon });
  assert.equal(first.status, 201);
  const ra = await first.json();
  assert.equal(ra.caption, '« Une phrase » 😔\n#rapfr');
  assert.equal(ra.trial, '');
  assert.equal((await reel(a.id, { publishAt: soon + 86400_000 })).status, 409, 'une vidéo ne part pas deux fois en Reel');
  const rb = await (await reel(b.id, { publishAt: soon, trial: 'MANUAL', caption: 'Essai' })).json();
  assert.equal(rb.trial, 'MANUAL');
  const state = await (await call(boss.token, 'GET', '/api/cut/reels')).json();
  assert.deepEqual(state.inReels.sort(), [a.id, b.id].sort());
  // « Lire » : le lien signé donne la vidéo ; falsifié, il est refusé.
  assert.equal((await fetch(base + ra.play)).status, 200);
  assert.equal((await fetch(base + ra.play.replace(/s=[^&]+/, 's=faux'))).status, 403);
  // Modifier : la description, le type d'essai (auto), l'heure.
  const changed = await (await call(boss.token, 'PATCH', `/api/cut/reels/${ra.id}`, { caption: 'Nouvelle description', trial: 'SS_PERFORMANCE' })).json();
  assert.equal(changed.caption, 'Nouvelle description');
  assert.equal(changed.trial, 'SS_PERFORMANCE');

  // L'heure passée sans compte relié : le Reel attend (rien ne part), avec la raison.
  run('UPDATE cut_reels SET publish_at = ?', Date.now() - 60_000);
  await publishDueReels();
  assert.equal(calls.length, 0, 'Instagram pas relié : aucun appel');
  assert.match(get('SELECT * FROM cut_reels WHERE id = ?', ra.id).error, /relie ton compte Instagram/);
  assert.equal(get('SELECT status FROM cut_reels WHERE id = ?', ra.id).status, 'scheduled');

  // Le compte relié (comme par la page compte) : chaque Reel part — conteneur, préparation, publication, lien.
  run(`INSERT INTO social_accounts (user_id, platform, account_id, alt_id, username, access_token, expires_at, error, created_at) VALUES (?, 'instagram', 'IG1', '', 'euhz', ?, ?, '', ?)`,
    boss.id, seal('jeton'), Date.now() + 50 * 86400_000, Date.now());
  assert.equal((await (await call(boss.token, 'GET', '/api/cut/reels')).json()).account, 'euhz');
  await publishDueReels();
  const containers = calls.filter((c) => c.url.endsWith('/IG1/media'));
  assert.equal(containers.length, 2);
  const normal = containers.find((c) => c.body.caption === 'Essai'), auto = containers.find((c) => c.body.caption === 'Nouvelle description');
  assert.equal(normal.body.media_type, 'REELS');
  assert.equal(normal.body.trial_params, JSON.stringify({ graduation_strategy: 'MANUAL' }), "Reel d'essai : je le partage moi-même");
  assert.equal(auto.body.trial_params, JSON.stringify({ graduation_strategy: 'SS_PERFORMANCE' }), "Reel d'essai : partagé s'il marche");
  assert.ok(normal.body.video_url.startsWith('https://api.test/api/cut/reel/'), 'Instagram va chercher la vidéo sur le serveur public');
  // Le lien donné à Instagram ouvre bien la vidéo (avant qu'elle soit effacée).
  const done = get('SELECT * FROM cut_reels WHERE id = ?', ra.id);
  assert.equal(done.status, 'published');
  assert.equal(done.permalink, 'https://www.instagram.com/reel/abc/');
  assert.ok(!fs.existsSync(path.join(dataDir, 'cut-reels', done.stored_as)), 'fichier effacé une fois publié');
  assert.equal((await call(boss.token, 'PATCH', `/api/cut/reels/${ra.id}`, { caption: 'x' })).status, 409, 'déjà publié');

  // Un Reel normal (pas d'essai) part aussi dans le fil ; un refus d'Instagram est expliqué.
  const c = await keep('Clip C');
  const rc = await (await reel(c.id, { publishAt: soon })).json();
  run('UPDATE cut_reels SET publish_at = ? WHERE id = ?', Date.now() - 60_000, rc.id);
  refuse = true;
  await publishDueReels();
  const failed = get('SELECT * FROM cut_reels WHERE id = ?', rc.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /reconnecte ton compte Instagram/);
  assert.equal(calls.filter((x) => x.url.endsWith('/IG1/media')).at(-1).body.share_to_feed, 'true');
  assert.equal(calls.filter((x) => x.url.endsWith('/IG1/media')).at(-1).body.trial_params, undefined);
  // Raté : on peut le reprogrammer, ou le retirer (la vidéo du cloud CUT pourra repartir).
  refuse = false;
  assert.equal((await call(boss.token, 'PATCH', `/api/cut/reels/${rc.id}`, { publishAt: soon })).status, 200);
  assert.equal((await call(boss.token, 'DELETE', `/api/cut/reels/${rc.id}`)).status, 200);
  assert.equal((await reel(c.id, { publishAt: soon })).status, 201, 'retiré : la vidéo peut repartir');
  console.log('reels : ok');
} finally {
  server.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows : la base est encore ouverte */ }
}
