// Rôles (fondateur, admin, VIP, partenaire) et créateurs des plugins, sur une base jetable : node test/roles.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-roles-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', FOUNDER_EMAILS: 'Boss@Test.local' });

const { createApp } = await import('../src/app.js');
const { run, get, db } = await import('../src/db.js');
const { publicKeyPem } = await import('../src/licensing.js');
const { outbox } = await import('../src/mail.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, route, { token, body, raw, expect = 200 } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const isJson = response.headers.get('content-type')?.includes('json');
  const data = isJson ? await response.json() : Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, expect, `${method} ${route} → ${response.status} ${isJson ? JSON.stringify(data) : ''}`);
  return data;
}

let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

/** Crée un compte, valide son adresse par le lien reçu, et lui donne un rôle directement en base. */
async function account(name, role) {
  const email = `${name}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  const link = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await call('POST', '/api/auth/verify', { body: { token: link } });
  if (role) run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}
const roleOf = (who) => get('SELECT role FROM users WHERE id = ?', who.id).role;

// Un plugin payant n'est accepté que s'il embarque la clé publique du serveur (module de licence).
const binary = Buffer.concat([crypto.randomBytes(2000), crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }).subarray(-32)]);
const machine = 'a'.repeat(40);
const upload = (token, productId, version, expect = 201) => call('POST',
  `/api/admin/products/${productId}/versions?${new URLSearchParams({ version, filename: 'PLUGIN.vst3' })}`, { token, raw: binary, expect });

let founder, admin, admin2, user, vip, partner, tuner, raw, tunerVersion, rawVersion;

try {
  await step('comptes de départ', async () => {
    founder = await account('fondateur', 'founder');
    admin = await account('admin', 'admin');
    admin2 = await account('admin2', 'admin');
    user = await account('client');
    vip = await account('invite');
    partner = await account('partenaire');
  });

  await step('créateur d\'un plugin : ONIRIQUE par défaut, ABRASION au choix, visible dans le catalogue', async () => {
    tuner = await call('POST', '/api/admin/products', { token: admin.token, body: { name: 'ONIRIQUE TUNER', priceCents: 3900 }, expect: 201 });
    raw = await call('POST', '/api/admin/products', { token: admin.token, body: { name: 'ONIRIQUE RAW', priceCents: 2990, creator: 'abrasion' }, expect: 201 });
    assert.equal(tuner.creator, 'onirique');
    assert.equal(raw.creator, 'abrasion');
    await call('POST', '/api/admin/products', { token: admin.token, body: { name: 'ONIRIQUE X', creator: 'inconnu' }, expect: 400 });
    await call('PATCH', `/api/admin/products/${tuner.id}`, { token: admin.token, body: { creator: 'inconnu' }, expect: 400 });
    tunerVersion = await upload(admin.token, tuner.id, '1.0.0');
    rawVersion = await upload(admin.token, raw.id, '1.0.0');
    const catalog = (await call('GET', '/api/catalog')).products;
    assert.deepEqual(catalog.map((p) => [p.name, p.creator]), [['ONIRIQUE TUNER', 'onirique'], ['ONIRIQUE RAW', 'abrasion']]);
  });

  await step('un admin donne les rôles VIP et partenaire, pas le rôle admin ni fondateur', async () => {
    await call('PATCH', `/api/admin/users/${vip.id}`, { token: admin.token, body: { role: 'vip' } });
    await call('PATCH', `/api/admin/users/${partner.id}`, { token: admin.token, body: { role: 'abrasion' } });
    assert.equal(roleOf(vip), 'vip');
    assert.equal(roleOf(partner), 'abrasion');
    await call('PATCH', `/api/admin/users/${user.id}`, { token: admin.token, body: { role: 'admin' }, expect: 403 });
    await call('PATCH', `/api/admin/users/${user.id}`, { token: admin.token, body: { role: 'founder' }, expect: 403 });
    await call('PATCH', `/api/admin/users/${user.id}`, { token: admin.token, body: { role: 'empereur' }, expect: 400 });
    assert.equal(roleOf(user), 'user');
  });

  await step('un admin ne retire pas le rôle d\'un autre admin ni d\'un fondateur, et ne change pas leur mot de passe', async () => {
    for (const target of [admin2, founder]) {
      for (const role of ['user', 'vip', 'abrasion']) await call('PATCH', `/api/admin/users/${target.id}`, { token: admin.token, body: { role }, expect: 403 });
      await call('PATCH', `/api/admin/users/${target.id}`, { token: admin.token, body: { password: 'pris-de-force-1' }, expect: 403 });
    }
    assert.equal(roleOf(admin2), 'admin');
    assert.equal(roleOf(founder), 'founder');
    await call('POST', '/api/auth/login', { body: { email: 'fondateur@test.local', password: 'motdepasse1' } });
    // Le mot de passe d'un compte ordinaire reste du ressort d'un admin.
    await call('PATCH', `/api/admin/users/${user.id}`, { token: admin.token, body: { password: 'nouveau-passe-1' } });
    user.token = (await call('POST', '/api/auth/login', { body: { email: 'client@test.local', password: 'nouveau-passe-1' } })).token;
  });

  await step('le fondateur gère le rôle admin ; personne ne change son propre rôle', async () => {
    await call('PATCH', `/api/admin/users/${admin2.id}`, { token: founder.token, body: { role: 'user' } });
    assert.equal(roleOf(admin2), 'user');
    await call('GET', '/api/admin/overview', { token: admin2.token, expect: 403 });
    await call('PATCH', `/api/admin/users/${admin2.id}`, { token: founder.token, body: { role: 'admin' } });
    await call('GET', '/api/admin/overview', { token: admin2.token });
    await call('PATCH', `/api/admin/users/${admin2.id}`, { token: founder.token, body: { password: 'choisi-par-le-fondateur' } });
    await call('PATCH', `/api/admin/users/${founder.id}`, { token: founder.token, body: { role: 'user' }, expect: 400 });
    await call('PATCH', `/api/admin/users/${admin.id}`, { token: admin.token, body: { role: 'user' }, expect: 400 });
    // Redonner le rôle déjà porté ne change rien et n'est pas une faute.
    await call('PATCH', `/api/admin/users/${admin.id}`, { token: admin.token, body: { role: 'admin' } });
    assert.equal((await call('GET', '/api/me', { token: founder.token })).user.role, 'founder');
  });

  await step('adresse de fondateur : le rôle vient avec la validation de l\'adresse, pas avant', async () => {
    const { token } = await call('POST', '/api/auth/register', { body: { email: 'boss@test.local', password: 'motdepasse1' }, expect: 201 });
    assert.equal((await call('GET', '/api/me', { token })).user.role, 'user');
    await call('GET', '/api/admin/overview', { token, expect: 403 });
    const link = outbox.filter((m) => m.to === 'boss@test.local').at(-1).text.match(/\?verify=([\w-]+)/)[1];
    await call('POST', '/api/auth/verify', { body: { token: link } });
    assert.equal((await call('GET', '/api/me', { token })).user.role, 'founder');
    await call('GET', '/api/admin/overview', { token });
  });

  await step('VIP : tous les plugins sans licence, activation et téléchargement compris ; plus rien une fois le rôle retiré', async () => {
    await call('GET', `/api/download/${tunerVersion.id}`, { token: user.token, expect: 403 });
    const me = await call('GET', '/api/me', { token: vip.token });
    assert.deepEqual(Object.keys(me.entitlements).map(Number).sort(), [tuner.id, raw.id].sort());
    assert.equal(me.entitlements[tuner.id].via, 'vip');
    assert.equal(me.licenses.length, 0);
    assert.deepEqual(await call('GET', `/api/download/${tunerVersion.id}`, { token: vip.token }), binary);
    const { license } = await call('POST', '/api/licenses/activate', { token: vip.token, body: { productId: raw.id, machineId: machine, machineName: 'PC' } });
    const body = Buffer.from(license.payload, 'base64');
    assert.ok(crypto.verify(null, body, publicKeyPem, Buffer.from(license.signature, 'base64')));
    const payload = JSON.parse(body);
    assert.equal(payload.type, 'vip');
    assert.ok(payload.expiresAt > Date.now() + 29 * 86400_000 && payload.expiresAt < Date.now() + 31 * 86400_000, 'licence de 30 jours, renouvelée par CENTRAL');

    await call('PATCH', `/api/admin/users/${vip.id}`, { token: admin.token, body: { role: 'user' } });
    assert.deepEqual((await call('GET', '/api/me', { token: vip.token })).entitlements, {});
    await call('GET', `/api/download/${tunerVersion.id}`, { token: vip.token, expect: 403 });
    await call('POST', '/api/licenses/activate', { token: vip.token, body: { productId: raw.id, machineId: machine, machineName: 'PC' }, expect: 403 });
  });

  await step('VIP avec un essai en cours : le plugin est offert, pas en mode démo ; un plugin acheté reste une licence', async () => {
    await call('POST', '/api/licenses/trial', { token: vip.token, body: { productId: tuner.id }, expect: 201 });
    assert.equal((await call('GET', '/api/me', { token: vip.token })).entitlements[tuner.id].type, 'trial');
    await call('PATCH', `/api/admin/users/${vip.id}`, { token: admin.token, body: { role: 'vip' } });
    const [key] = await call('POST', '/api/admin/licenses', { token: admin.token, body: { productId: raw.id }, expect: 201 });
    await call('POST', '/api/licenses/redeem', { token: vip.token, body: { key: key.key } });
    const { entitlements } = await call('GET', '/api/me', { token: vip.token });
    assert.equal(entitlements[tuner.id].type, 'vip');
    assert.equal(entitlements[raw.id].via, 'license');
    assert.equal((await call('GET', '/api/me', { token: founder.token })).entitlements[tuner.id].via, 'vip', 'un fondateur a tous les plugins aussi');
    assert.deepEqual((await call('GET', '/api/me', { token: admin.token })).entitlements, {}, 'un admin n\'a pas les plugins offerts');
  });

  await step('partenaire : son panel ne montre que ses plugins', async () => {
    const mine = await call('GET', '/api/admin/products', { token: partner.token });
    assert.deepEqual(mine.map((p) => p.name), ['ONIRIQUE RAW']);
    for (const route of ['/overview', '/users', '/plans', '/credits', '/support']) await call('GET', `/api/admin${route}`, { token: partner.token, expect: 403 });
    await call('PATCH', `/api/admin/users/${user.id}`, { token: partner.token, body: { role: 'vip' }, expect: 403 });
    await call('GET', '/api/admin/products', { token: user.token, expect: 403 });
    assert.equal((await call('GET', '/api/me', { token: partner.token })).user.role, 'abrasion');
  });

  await step('partenaire : il modifie et publie ses plugins, pas ceux des autres, et ne change pas de créateur', async () => {
    await call('PATCH', `/api/admin/products/${tuner.id}`, { token: partner.token, body: { priceCents: 100 }, expect: 404 });
    const edited = await call('PATCH', `/api/admin/products/${raw.id}`, { token: partner.token, body: { priceCents: 1990, creator: 'onirique' } });
    assert.equal(edited.priceCents, 1990);
    assert.equal(edited.creator, 'abrasion');
    const created = await call('POST', '/api/admin/products', { token: partner.token, body: { name: 'ONIRIQUE TAMA', creator: 'onirique' }, expect: 201 });
    assert.equal(created.creator, 'abrasion');

    await upload(partner.token, tuner.id, '9.0.0', 404);
    const mine = await upload(partner.token, raw.id, '1.0.1');
    await call('PATCH', `/api/admin/versions/${mine.id}`, { token: partner.token, body: { notes: 'Corrections' } });
    await call('PATCH', `/api/admin/versions/${tunerVersion.id}`, { token: partner.token, body: { notes: 'pirate' }, expect: 404 });
    await call('DELETE', `/api/admin/versions/${tunerVersion.id}`, { token: partner.token, expect: 404 });
    await call('DELETE', `/api/admin/versions/${mine.id}`, { token: partner.token });
    await call('PUT', `/api/admin/products/${tuner.id}/image`, { token: partner.token, raw: binary, expect: 404 });
    assert.equal(get('SELECT price_cents AS price FROM products WHERE id = ?', tuner.id).price, 3900);
    assert.equal((await call('GET', '/api/catalog')).products.find((p) => p.id === tuner.id).versions[0].notes, '');

    // Sans licence, il télécharge ses propres plugins (pour les vérifier), pas ceux des autres.
    assert.deepEqual(await call('GET', `/api/download/${rawVersion.id}`, { token: partner.token }), binary);
    await call('GET', `/api/download/${tunerVersion.id}`, { token: partner.token, expect: 403 });
  });

  await step('partenaire : il ne gère que les licences de ses plugins', async () => {
    const [tunerKey] = await call('POST', '/api/admin/licenses', { token: admin.token, body: { productId: tuner.id }, expect: 201 });
    await call('POST', '/api/admin/licenses', { token: partner.token, body: { productId: tuner.id }, expect: 404 });
    const [rawKey] = await call('POST', '/api/admin/licenses', { token: partner.token, body: { productId: raw.id, note: 'partenaire' }, expect: 201 });

    const listed = await call('GET', '/api/admin/licenses', { token: partner.token });
    assert.ok(listed.length >= 2 && listed.every((l) => l.productName === 'ONIRIQUE RAW'), 'seulement les licences de ses plugins');
    assert.ok((await call('GET', '/api/admin/licenses', { token: admin.token })).some((l) => l.key === tunerKey.key));
    assert.equal((await call('GET', `/api/admin/licenses?q=${tunerKey.key}`, { token: partner.token })).length, 0, 'la recherche ne sort pas du périmètre');

    await call('PATCH', `/api/admin/licenses/${tunerKey.id}`, { token: partner.token, body: { status: 'revoked' }, expect: 404 });
    await call('POST', `/api/admin/licenses/${tunerKey.id}/reset`, { token: partner.token, expect: 404 });
    await call('DELETE', `/api/admin/licenses/${tunerKey.id}`, { token: partner.token, expect: 404 });
    assert.equal(get('SELECT status FROM licenses WHERE id = ?', tunerKey.id).status, 'active');
    await call('PATCH', `/api/admin/licenses/${rawKey.id}`, { token: partner.token, body: { status: 'revoked' } });
    await call('POST', `/api/admin/licenses/${rawKey.id}/reset`, { token: partner.token });
    await call('DELETE', `/api/admin/licenses/${rawKey.id}`, { token: partner.token });

    // Sa clé de pack ne couvre que ses plugins (RAW et TAMA), jamais ceux d'ONIRIQUE.
    const [pack] = await call('POST', '/api/admin/licenses', { token: partner.token, body: { productId: 'all' }, expect: 201 });
    const inPack = db.prepare('SELECT p.name FROM licenses l JOIN products p ON p.id = l.product_id WHERE l.bundle = ? ORDER BY p.name').all(pack.key).map((r) => r.name);
    assert.deepEqual(inPack, ['ONIRIQUE RAW', 'ONIRIQUE TAMA']);
  });

  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  db.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows garde parfois la base ouverte un instant */ }
}
