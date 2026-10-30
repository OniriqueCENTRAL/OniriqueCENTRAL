// ONIRIQUE CUT : qui peut convertir sa vidéo en MP4, sur une base jetable : node test/cut.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-cut-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test' });

const { createApp } = await import('../src/app.js');
const { run, get } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { cutArgs } = await import('../src/cut.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const post = (token, body) => fetch(base + '/api/cut/mp4', { method: 'POST', body,
  headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

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
  const video = Buffer.from('fausse video webm');
  assert.equal((await post('', video)).status, 401, 'sans compte');
  const user = await account('simple');
  assert.equal((await post(user.token, video)).status, 403, 'compte sans CLOUD');

  const vip = await account('membre', 'vip');
  const ok = await post(vip.token, video);
  assert.equal(ok.status, 200, 'membre ONIRIQUE');
  assert.equal(ok.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), video);

  // L'abonnement aux outils ouvre aussi CUT.
  run(`INSERT INTO tool_subscriptions (user_id, interval, status, current_period_end, updated_at) VALUES (?, 'month', 'active', ?, ?)`,
    user.id, Date.now() + 86400_000, Date.now());
  assert.equal((await post(user.token, video)).status, 200, 'abonné CLOUD');
  assert.equal((await post(vip.token, Buffer.alloc(0))).status, 400, 'fichier vide');
  // Rien ne reste sur le disque.
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'cut')), []);
  // La vidéo sortie : 1080 × 1920, 30 images par seconde, H.264 + AAC, lisible dès le début du téléchargement.
  const args = cutArgs('a', 'b').join(' ');
  for (const part of ['crop=1080:1920', 'fps=30', 'libx264', 'aac', '+faststart']) assert.ok(args.includes(part), part);
  console.log('cut : ok');
} finally {
  server.close();
}
