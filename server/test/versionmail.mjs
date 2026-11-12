// Mail aux clients d'un plugin quand une nouvelle version sort, sur une base jetable : node test/versionmail.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-versionmail-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', MAILING_INTERVAL_MS: '20',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://api.test', FOUNDER_EMAILS: '' });

const { createApp } = await import('../src/app.js');
const { run, get, all, db } = await import('../src/db.js');
const { publicKeyPem, createLicense } = await import('../src/licensing.js');
const { outbox } = await import('../src/mail.js');
const { announceVersions, setMarketing } = await import('../src/newsletter.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
async function call(method, route, { token, body, raw, expect = 200 } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
  assert.equal(response.status, expect, `${method} ${route} → ${response.status} ${JSON.stringify(data)}`);
  return data;
}
async function account(name, role) {
  const email = `${name}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  await call('POST', '/api/auth/verify', { body: { token: outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1] } });
  if (role) run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return { token, email, id: get('SELECT id FROM users WHERE email = ?', email).id };
}
const binary = Buffer.concat([crypto.randomBytes(2000), crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }).subarray(-32)]);
const publish = (token, id, version, platform = 'win', notes = '') => call('POST',
  `/api/admin/products/${id}/versions?${new URLSearchParams({ version, platform, notes, filename: platform === 'mac' ? 'P.zip' : 'P.vst3' })}`, { token, raw: binary, expect: 201 });
const later = () => Date.now() + 31 * 60_000;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const mailsTo = (who) => outbox.filter((m) => m.to === who.email && /est disponible/.test(m.subject));

try {
  const admin = await account('admin', 'admin');
  const [buyer, trial, gone, subscriber, vip] = [await account('alice'), await account('bob'), await account('carol'), await account('dave'), await account('eve', 'vip')];
  const tuner = await call('POST', '/api/admin/products', { token: admin.token, body: { name: 'ONIRIQUE TUNER', priceCents: 4000 }, expect: 201 });
  await publish(admin.token, tuner.id, '1.0.0');
  announceVersions(later());
  assert.equal(get('SELECT mailing_id FROM version_mailings WHERE version = ?', '1.0.0').mailing_id, null, 'personne à prévenir pour la première version');

  createLicense({ productId: tuner.id, userId: buyer.id, source: 'stripe' });
  createLicense({ productId: tuner.id, userId: trial.id, type: 'trial', expiresAt: Date.now() + 86400_000 });
  createLicense({ productId: tuner.id, userId: gone.id, source: 'stripe' });
  setMarketing(gone.id, false);
  const plan = run(`INSERT INTO plans (name, interval, price_cents) VALUES ('ALL ACCESS', 'month', 1999)`).lastInsertRowid;
  run(`INSERT INTO subscriptions (user_id, plan_id, status, current_period_end, updated_at) VALUES (?, ?, 'active', ?, ?)`, subscriber.id, plan, Date.now() + 30 * 86400_000, Date.now());

  await publish(admin.token, tuner.id, '1.1.0', 'win', 'Détection plus rapide\nNouveau mode basse latence');
  // Le Mac arrive comme par publish-plugin.mjs, directement dans la base.
  run(`INSERT INTO versions (product_id, version, notes, filename, stored_as, size, sha256, created_at, platform) VALUES (?, '1.1.0', '', 'P.zip', 'x', 1, 'x', ?, 'mac')`, tuner.id, Date.now());
  announceVersions();
  assert.equal(get('SELECT COUNT(*) AS n FROM version_mailings WHERE version = ?', '1.1.0').n, 0, 'attend 30 minutes');
  announceVersions(later());
  announceVersions(later());
  const mailings = all(`SELECT * FROM mailings WHERE audience = 'clients-plugin'`);
  assert.equal(mailings.length, 1, 'un seul envoi pour Windows et Mac');
  assert.equal(mailings[0].total, 2);
  for (let i = 0; i < 100 && mailsTo(buyer).length + mailsTo(subscriber).length < 2; i++) await sleep(20);
  assert.equal(mailsTo(buyer).length, 1, 'l\'acheteur est prévenu');
  assert.equal(mailsTo(subscriber).length, 1, 'l\'abonné est prévenu');
  for (const who of [trial, gone, vip, admin]) assert.equal(mailsTo(who).length, 0, `${who.email} ne reçoit rien`);
  const mail = mailsTo(buyer)[0];
  assert.match(mail.subject, /ONIRIQUE TUNER 1\.1\.0 est disponible/);
  assert.match(mail.text, /Bonjour alice/);
  assert.match(mail.text, /Nouveau mode basse latence/);
  assert.match(mail.text, /https:\/\/site\.test\/boutique\//);
  assert.match(mail.text, /Se désinscrire/);
  console.log('  ok  mail des nouvelles versions : acheteur et abonné prévenus une fois, essai, désinscrit et VIP exclus');
} finally {
  server.close();
  db.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows garde parfois la base ouverte un instant */ }
}
process.exit(0);
