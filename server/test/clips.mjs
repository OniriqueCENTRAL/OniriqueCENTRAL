// CLIPS : envoi réservé aux membres, conversion en MP4 (si ffmpeg est là), page avec l'aperçu Discord, vues, suppression :
// node test/clips.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-clips-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test' });

const { createApp } = await import('../src/app.js');
const { run, setSetting } = await import('../src/db.js');
setSetting('sounds_disk_max', 1);
const { outbox } = await import('../src/mail.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const api = (url, { token, body, method, headers } = {}) => fetch(base + url, { method: method || (body ? 'POST' : 'GET'), body,
  headers: { ...(body ? { 'Content-Type': 'application/octet-stream' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } });
async function account(email, role) {
  const { token } = await (await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'motdepasse1', name: email.split('@')[0] }) })).json();
  const verify = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await fetch(base + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verify }) });
  run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return token;
}
const waitDone = async (id, token) => {
  for (let i = 0; i < 600; i++) {
    const c = await (await api(`/api/clips/${id}`, { token })).json();
    if (c.status !== 'wait') return c;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error('conversion trop longue');
};
let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version']); execFileSync('nice', ['-n', '0', 'true']); } catch { ffmpeg = false; }

try {
  const user = await account('simple@test.local', 'user');
  const nova = await account('nova@test.local', 'beta');
  const autre = await account('autre@test.local', 'vip');
  assert.equal((await api('/api/clips', { token: user, body: 'x' })).status, 403, 'un simple compte ne partage pas de clip');
  assert.equal((await api('/api/clips', { body: 'x' })).status, 401);

  // Un vrai WebM de 2 s (image et son) quand ffmpeg est là ; sinon un fichier illisible, qui doit finir « failed ».
  const src = path.join(dataDir, 'essai.webm');
  if (ffmpeg) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2',
    '-c:v', 'libvpx', '-c:a', 'libopus', '-shortest', src]);
  else fs.writeFileSync(src, 'pas une vidéo');
  const sent = await api(`/api/clips?title=${encodeURIComponent('  Le   pentakill <b>  ')}`, { token: nova, body: fs.readFileSync(src) });
  assert.equal(sent.status, 202);
  const first = await sent.json();
  assert.equal(first.title, 'Le pentakill <b>');
  assert.equal(first.url, `https://site.test/clip?c=${first.id}`);
  assert.equal((await api(`/api/clips/${first.id}`)).status, 404, 'en préparation : invisible des autres');
  const done = await waitDone(first.id, nova);
  assert.equal(fs.existsSync(path.join(dataDir, 'clips', `${first.id}.src`)), false, 'le WebM reçu ne reste pas');

  if (ffmpeg) {
    assert.equal(done.status, 'ready');
    assert.deepEqual([done.width, done.height], [640, 360]);
    assert.ok(done.duration > 1.5 && done.duration < 2.5);
    const range = await api(`/api/clips/${first.id}/video.mp4`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(range.status, 206, 'la vidéo se lit par morceaux (avance rapide, Discord)');
    assert.equal((await api(`/api/clips/${first.id}/poster.jpg`)).headers.get('content-type'), 'image/jpeg');
    const page = await (await api(`/clip?c=${first.id}`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0)' } })).text();
    assert.ok(page.includes(`<meta property="og:video" content="https://site.test/api/clips/${first.id}/video.mp4">`));
    assert.ok(page.includes('Le pentakill &lt;b&gt;') && !page.includes('<b>'), 'le titre est échappé');
    await api(`/clip?c=${first.id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    await api(`/clip?c=${first.id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    assert.equal((await (await api(`/api/clips/${first.id}`)).json()).views, 1, 'une vue par personne, aucune pour Discord');
  } else {
    assert.equal(done.status, 'failed');
    assert.equal((await api(`/clip?c=${first.id}`)).status, 404);
  }

  assert.equal((await api('/clip?c=inconnu')).status, 404);
  assert.deepEqual((await (await api('/api/clips', { token: nova })).json()).map((c) => c.id), [first.id]);
  assert.equal((await api(`/api/clips/${first.id}`, { token: autre, method: 'DELETE' })).status, 404, 'seul l\'auteur supprime');
  assert.equal((await api(`/api/clips/${first.id}`, { token: nova, method: 'DELETE' })).status, 200);
  assert.equal((await api(`/api/clips/${first.id}/video.mp4`)).status, 404);
  assert.equal(fs.readdirSync(path.join(dataDir, 'clips')).length, 0, 'plus aucun fichier');
  console.log(`clips : tous les essais passent${ffmpeg ? '' : ' (sans ffmpeg : conversion non essayée)'}`);
} finally {
  server.close();
}
