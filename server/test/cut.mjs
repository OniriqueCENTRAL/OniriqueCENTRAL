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

  // Le son d'origine du passage (WAV), envoyé avant la vidéo : réservé lui aussi, et seulement pour son auteur.
  const sendAudio = (token, body) => fetch(base + '/api/cut/audio', { method: 'POST', body,
    headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const wav = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.alloc(2000)]);
  assert.equal((await sendAudio('', wav)).status, 401, 'son sans compte');
  const outsider = await account('dehors');
  assert.equal((await sendAudio(outsider.token, wav)).status, 403, 'son sans CLOUD');
  assert.equal((await sendAudio(vip.token, Buffer.from('pas un wav du tout'))).status, 400, 'son qui n’est pas un WAV');
  const sent = await sendAudio(vip.token, wav);
  assert.equal(sent.status, 201);
  const { id } = await sent.json();
  const withAudio = (token, audio) => fetch(`${base}/api/cut/mp4?audio=${audio}&offset=0.02`, { method: 'POST', body: video,
    headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` } });
  assert.equal((await withAudio(vip.token, 'inconnu')).status, 400, 'son inconnu');
  assert.equal((await withAudio(user.token, id)).status, 400, 'son d’un autre compte');
  assert.equal((await withAudio(vip.token, id)).status, 200, 'vidéo avec son d’origine');
  assert.equal((await withAudio(vip.token, id)).status, 400, 'son déjà utilisé, donc effacé');
  // Rien ne reste sur le disque.
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'cut')), []);
  // La vidéo sortie : 1080 × 1920, 30 images par seconde, H.264 + AAC 320 kb/s, lisible dès le début du téléchargement.
  const args = cutArgs('a', 'b').join(' ');
  for (const part of ['crop=1080:1920', 'fps=30', 'libx264', 'aac', '320k', '+faststart']) assert.ok(args.includes(part), part);
  assert.ok(!args.includes('-ar'), 'le son garde sa fréquence d’origine');
  // Avec le son d'origine : la vidéo de l'enregistrement, le son du WAV, calé de l'écart mesuré.
  const mixed = cutArgs('v', 'o', 's.wav', 0.04).join(' ');
  for (const part of ['-itsoffset 0.040 -i s.wav', '-map 0:v:0', '-map 1:a:0', '-shortest']) assert.ok(mixed.includes(part), part);
  assert.ok(cutArgs('v', 'o', 's.wav', -0.03).join(' ').includes('-ss 0.030 -i s.wav'));
  console.log('cut : ok');
} finally {
  server.close();
}
