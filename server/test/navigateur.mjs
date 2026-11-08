// Profil d'ONIRIQUE Navigateur suivi par le compte, sur une base jetable : node test/navigateur.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-navigateur-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: 'test',
  MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test', FOUNDER_EMAILS: '' });
const { createApp } = await import('../src/app.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, route, { token, body, expect = 200 } = {}) {
  const r = await fetch(base + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  assert.equal(r.status, expect, `${method} ${route} → ${r.status} ${JSON.stringify(data)}`);
  return data;
}

try {
  await call('GET', '/api/navigateur/profil', { expect: 401 });
  const { token } = await call('POST', '/api/auth/register', { body: { email: 'nav@test.local', password: 'motdepasse1', name: 'Nav' }, expect: 201 });
  const { token: autre } = await call('POST', '/api/auth/register', { body: { email: 'autre@test.local', password: 'motdepasse1', name: 'Autre' }, expect: 201 });

  assert.deepEqual(await call('GET', '/api/navigateur/profil', { token }), { donnees: null, date: 0 });
  const profil = { Accent: '#3d7bff', Moteur: 'duckduckgo', Raccourcis: [{ type: 'site', nom: 'ONIRIQUE', url: 'https://onirique.store/' }] };
  await call('PUT', '/api/navigateur/profil', { token, body: { donnees: profil, date: 2000 } });
  assert.deepEqual(await call('GET', '/api/navigateur/profil', { token }), { donnees: profil, date: 2000 });
  // Un PC resté en arrière n'écrase pas le profil plus récent.
  await call('PUT', '/api/navigateur/profil', { token, body: { donnees: { Accent: '#e5384a' }, date: 1000 }, expect: 409 });
  assert.equal((await call('GET', '/api/navigateur/profil', { token })).donnees.Accent, '#3d7bff');
  // Chaque compte a le sien.
  assert.deepEqual(await call('GET', '/api/navigateur/profil', { token: autre }), { donnees: null, date: 0 });
  await call('PUT', '/api/navigateur/profil', { token, body: { donnees: [], date: 3000 }, expect: 400 });
  await call('PUT', '/api/navigateur/profil', { token, body: { donnees: {}, date: 'hier' }, expect: 400 });
  console.log('Navigateur : ok');
} finally {
  server.close();
  process.exit(process.exitCode ?? 0);
}
