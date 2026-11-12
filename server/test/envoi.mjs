// ONIRIQUE ENVOI : envoi de fichiers, lien, mot de passe, .zip et expiration, sur une base jetable : node test/envoi.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-envoi-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test' });

const { createApp } = await import('../src/app.js');
const { run, get, setSetting } = await import('../src/db.js');
setSetting('sounds_disk_max', 1); // le disque de la machine de test peut être plein à plus de 80 %
const { outbox } = await import('../src/mail.js');
const { sweepEnvois } = await import('../src/envoi.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const api = (url, { token, json, body, method } = {}) => fetch(base + url, { method: method || (json || body ? 'POST' : 'GET'),
  body: json ? JSON.stringify(json) : body,
  headers: { ...(json ? { 'Content-Type': 'application/json' } : body ? { 'Content-Type': 'application/octet-stream' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

const email = 'envoi@test.local';
const { token } = await (await api('/api/auth/register', { json: { email, password: 'motdepasse1', name: 'Nova' } })).json();
const verify = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
await api('/api/auth/verify', { json: { token: verify } });

try {
  assert.equal((await api('/api/envois', { json: {} })).status, 401, 'sans compte, pas d\'envoi');

  // Envoi sans mot de passe : deux fichiers au même nom, puis le lien.
  const { id } = await (await api('/api/envois', { token, json: { title: 'Stems', message: 'Bonne écoute', days: 1 } })).json();
  assert.equal((await api(`/api/envois/${id}`)).status, 404, 'pas encore prêt');
  assert.equal((await api(`/api/envois/${id}/ready`, { token, method: 'POST' })).status, 400, 'pas de fichier');
  for (const text of ['un', 'deux']) assert.equal((await api(`/api/envois/${id}/files?name=voix.wav`, { token, body: text })).status, 201);
  assert.equal((await api(`/api/envois/${id}/ready`, { token, method: 'POST' })).status, 200);
  assert.equal((await api(`/api/envois/${id}/files?name=x`, { token, body: 'x' })).status, 409, 'plus d\'ajout après le départ');

  const info = await (await api(`/api/envois/${id}`)).json();
  assert.equal(info.sender, 'Nova');
  assert.equal(info.files.length, 2);
  assert.equal(info.size, 6);
  assert.equal(await (await api(`/api/envois/${id}/files/${info.files[1].id}`)).text(), 'deux');
  const zip = Buffer.from(await (await api(`/api/envois/${id}/zip`)).arrayBuffer());
  assert.ok(zip.includes('voix.wav') && zip.includes('voix (2).wav'), 'les deux noms dans le .zip');
  assert.equal(get('SELECT downloads FROM envois WHERE id = ?', id).downloads, 2);
  assert.equal((await (await api('/api/envois', { token })).json()).length, 1);

  // Avec mot de passe : rien sans la clé, la clé contre le bon mot de passe seulement.
  const locked = (await (await api('/api/envois', { token, json: { password: 'secret', days: 7 } })).json()).id;
  await api(`/api/envois/${locked}/files?name=a.txt`, { token, body: 'a' });
  await api(`/api/envois/${locked}/ready`, { token, method: 'POST' });
  const refused = await api(`/api/envois/${locked}`);
  assert.equal(refused.status, 401);
  assert.equal((await refused.json()).locked, true);
  assert.equal((await api(`/api/envois/${locked}/unlock`, { json: { password: 'faux' } })).status, 403);
  const { key } = await (await api(`/api/envois/${locked}/unlock`, { json: { password: 'secret' } })).json();
  const open = await (await api(`/api/envois/${locked}?k=${key}`)).json();
  assert.equal(await (await api(`/api/envois/${locked}/files/${open.files[0].id}?k=${key}`)).text(), 'a');
  assert.equal((await api(`/api/envois/${locked}/zip`)).status, 401);

  // Expiration : la ligne et les fichiers partent.
  const stored = get('SELECT stored_as FROM envoi_files WHERE envoi_id = ? LIMIT 1', id).stored_as;
  run('UPDATE envois SET expires_at = 1 WHERE id = ?', id);
  assert.equal((await api(`/api/envois/${id}`)).status, 404);
  fs.utimesSync(path.join(dataDir, 'envois', stored), new Date(0), new Date(0));
  sweepEnvois();
  assert.ok(!fs.existsSync(path.join(dataDir, 'envois', stored)), 'fichier expiré effacé');

  // Suppression par l'expéditeur.
  assert.equal((await api(`/api/envois/${locked}`, { token, method: 'DELETE' })).status, 200);
  assert.equal((await (await api('/api/envois', { token })).json()).length, 0);
  console.log('envoi : ok');
} finally {
  server.close();
}
