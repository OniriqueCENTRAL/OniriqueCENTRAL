// Parcours complet de l'API sur une base jetable : node test/smoke.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-test-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test' }); // SMTP "test" : les e-mails restent dans outbox

const { createApp } = await import('../src/app.js');
const { run, now, db } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { publicKeyPem } = await import('../src/licensing.js');
const { outbox } = await import('../src/mail.js');

const adminPassword = crypto.randomBytes(9).toString('base64url');
run(`INSERT INTO users (email, name, password_hash, role, created_at) VALUES ('admin@test.local', 'Admin', ?, 'admin', ?)`,
  hashPassword(adminPassword), now());

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, route, { token, body, raw, type, expect = 200 } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(raw ? { 'Content-Type': type || 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}),
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

/** Crée un compte et valide son adresse avec le lien reçu par e-mail, comme le ferait son titulaire. */
async function register(body) {
  const { token } = await call('POST', '/api/auth/register', { body, expect: 201 });
  const link = outbox.filter((m) => m.to === body.email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await call('POST', '/api/auth/verify', { body: { token: link } });
  return token;
}

const machineA = 'a'.repeat(40), machineB = 'b'.repeat(40), machineC = 'c'.repeat(40);
const binary = crypto.randomBytes(300_000);
let admin, user, other, product, version, keys;

try {
  await step('connexion admin, refus des mauvais identifiants', async () => {
    admin = (await call('POST', '/api/auth/login', { body: { email: 'admin@test.local', password: adminPassword } })).token;
    await call('POST', '/api/auth/login', { body: { email: 'admin@test.local', password: 'faux-mot-de-passe' }, expect: 401 });
  });

  await step('inscription, doublon refusé, mot de passe court refusé', async () => {
    user = await register({ email: 'voix@test.local', password: 'motdepasse1', name: 'Voix' });
    other = await register({ email: 'autre@test.local', password: 'motdepasse2' });
    await call('POST', '/api/auth/register', { body: { email: 'VOIX@test.local', password: 'motdepasse1' }, expect: 409 });
    await call('POST', '/api/auth/register', { body: { email: 'court@test.local', password: 'abc' }, expect: 400 });
  });

  await step("l'admin est fermé aux comptes ordinaires et aux anonymes", async () => {
    await call('GET', '/api/admin/overview', { token: user, expect: 403 });
    await call('GET', '/api/admin/overview', { expect: 401 });
    await call('POST', '/api/admin/products', { token: user, body: { name: 'Pirate' }, expect: 403 });
  });

  await step('création de produit et envoi de version', async () => {
    product = await call('POST', '/api/admin/products', { token: admin, body: { name: 'ONIRIQUE TEST', priceCents: 2500, accent: '#e23444' }, expect: 201 });
    assert.equal(product.slug, 'onirique-test');
    const q = new URLSearchParams({ version: '1.0.0', filename: 'ONIRIQUE TEST.vst3', notes: 'Première' });
    version = await call('POST', `/api/admin/products/${product.id}/versions?${q}`, { token: admin, raw: binary, expect: 201 });
    assert.equal(version.sha256, crypto.createHash('sha256').update(binary).digest('hex'));
    await call('POST', `/api/admin/products/${product.id}/versions?${q}`, { token: admin, raw: binary, expect: 409 });

    // Versions Mac : même numéro accepté à côté de celui de Windows, .vst3 nu refusé, et chaque système voit la sienne.
    await call('POST', `/api/admin/products/${product.id}/versions?${q}&platform=mac`, { token: admin, raw: binary, expect: 400 });
    const macQuery = new URLSearchParams({ version: new URLSearchParams(q).get('version'), filename: 'ONIRIQUE TEST.vst3.zip', platform: 'mac' });
    const macVersion = await call('POST', `/api/admin/products/${product.id}/versions?${macQuery}`, { token: admin, raw: binary, expect: 201 });
    assert.equal(macVersion.platform, 'mac');
    const latestFor = async (headers) => (await (await fetch(`${base}/api/catalog`, { headers })).json()).products.find((p) => p.id === product.id).latest;
    assert.equal((await latestFor({})).id, version.id);
    assert.equal((await latestFor({ 'X-Onirique-Platform': 'mac' })).id, macVersion.id);
    await call('DELETE', `/api/admin/versions/${macVersion.id}`, { token: admin });
    assert.equal(await latestFor({ 'X-Onirique-Platform': 'mac' }), null);
    const evil = new URLSearchParams({ version: '1.0.1', filename: '..\\..\\evil.bat' });
    await call('POST', `/api/admin/products/${product.id}/versions?${evil}`, { token: admin, raw: binary, expect: 400 });
  });

  await step('démo interactive : acceptée si valide, servie avec le catalogue', async () => {
    const demo = JSON.stringify({ format: 'onirique-demo-v1', width: 10, height: 10, base: 'data:image/png;base64,AAAA', controls: [] });
    await call('PUT', `/api/admin/products/${product.id}/demo`, { token: user, raw: demo, expect: 403 });
    await call('PUT', `/api/admin/products/${product.id}/demo`, { token: admin, raw: '{"format":"autre"}', expect: 400 });
    await call('PUT', `/api/admin/products/${product.id}/demo`, { token: admin, raw: 'pas du json', expect: 400 });
    const updated = await call('PUT', `/api/admin/products/${product.id}/demo`, { token: admin, raw: demo });
    assert.match(updated.demo, /^\/api\/media\/[a-f0-9]{32}\.json$/);
    const served = await call('GET', updated.demo);
    assert.equal(served.format, 'onirique-demo-v1');
    assert.equal(fs.readdirSync(path.join(dataDir, 'media')).length, 1, 'les envois refusés ne laissent pas de fichier');
  });

  await step('crédits : ajout par lien Spotify, plugin rattaché, liste publique, suppression', async () => {
    const body = { spotifyUrl: 'https://open.spotify.com/intl-fr/track/6vJ83s2YUSDUlLQMSXS0lT?si=abc', title: 'CINÉMA', artist: 'Novi', productId: product.id, usedOn: 'Voix', released: '9 octobre 2026' };
    await call('POST', '/api/admin/credits', { token: user, body, expect: 403 });
    await call('POST', '/api/admin/credits', { token: admin, body: { ...body, spotifyUrl: 'https://exemple.com/pas-spotify' }, expect: 400 });
    await call('POST', '/api/admin/credits', { token: admin, body: { ...body, artist: '' }, expect: 400 });
    const created = await call('POST', '/api/admin/credits', { token: admin, body, expect: 201 });
    assert.deepEqual([created.title, created.spotifyId, created.plugin.slug, created.usedOn], ['CINÉMA', '6vJ83s2YUSDUlLQMSXS0lT', 'onirique-test', 'Voix']);
    const listed = await call('GET', '/api/credits');
    assert.equal(listed.length, 1);
    await call('PATCH', `/api/admin/credits/${created.id}`, { token: admin, body: { artist: '' }, expect: 400 });
    const edited = await call('PATCH', `/api/admin/credits/${created.id}`, { token: admin, body: { artist: 'Novi & co', productId: null, duration: '2:39' } });
    assert.deepEqual([edited.title, edited.artist, edited.plugin, edited.duration, edited.usedOn, edited.cover], ['CINÉMA', 'Novi & co', null, '2:39', 'Voix', created.cover]);
    await call('DELETE', `/api/admin/credits/${created.id}`, { token: admin });
    assert.equal((await call('GET', '/api/credits')).length, 0);
    assert.equal(fs.readdirSync(path.join(dataDir, 'media')).filter((f) => f.endsWith('.jpg')).length, 0, 'la pochette est retirée avec le crédit');
  });

  await step('la version la plus haute est mise en avant (1.10 > 1.9)', async () => {
    for (const v of ['1.9.0', '1.10.0']) {
      const q = new URLSearchParams({ version: v, filename: 'ONIRIQUE TEST.vst3' });
      await call('POST', `/api/admin/products/${product.id}/versions?${q}`, { token: admin, raw: binary, expect: 201 });
    }
    const catalog = await call('GET', '/api/catalog');
    assert.equal(catalog.products[0].latest.version, '1.10.0');
  });

  await step('sans licence : ni téléchargement ni activation', async () => {
    await call('GET', `/api/download/${version.id}`, { token: user, expect: 403 });
    await call('GET', `/api/download/${version.id}`, { expect: 401 });
    await call('POST', '/api/licenses/activate', { token: user, body: { productId: product.id, machineId: machineA }, expect: 403 });
  });

  await step('génération de clés, utilisation, clé déjà prise', async () => {
    keys = await call('POST', '/api/admin/licenses', { token: admin, body: { productId: product.id, count: 3, maxActivations: 2 }, expect: 201 });
    assert.equal(keys.length, 3);
    assert.match(keys[0].key, /^ONIR(-[A-Z2-9]{4}){4}$/);
    await call('POST', '/api/licenses/redeem', { token: user, body: { key: keys[0].key.toLowerCase().replaceAll('-', ' ') } });
    await call('POST', '/api/licenses/redeem', { token: other, body: { key: keys[0].key }, expect: 409 });
    await call('POST', '/api/licenses/redeem', { token: other, body: { key: 'ONIR-AAAA-AAAA-AAAA-AAAA' }, expect: 404 });
  });

  await step('téléchargement identique au fichier envoyé', async () => {
    const file = await call('GET', `/api/download/${version.id}`, { token: user });
    assert.ok(file.equals(binary));
  });

  await step('activation : licence signée vérifiable, limite de machines', async () => {
    const { license } = await call('POST', '/api/licenses/activate', { token: user, body: { productId: product.id, machineId: machineA, machineName: 'STUDIO' } });
    const body = Buffer.from(license.payload, 'base64');
    assert.ok(crypto.verify(null, body, publicKeyPem, Buffer.from(license.signature, 'base64')));
    const payload = JSON.parse(body);
    assert.deepEqual([payload.product, payload.machine, payload.email, payload.expiresAt], ['onirique-test', machineA, 'voix@test.local', null]);
    body[5] ^= 1;
    assert.ok(!crypto.verify(null, body, publicKeyPem, Buffer.from(license.signature, 'base64')));

    await call('POST', '/api/licenses/activate', { token: user, body: { productId: product.id, machineId: machineA } });
    await call('POST', '/api/licenses/activate', { token: user, body: { productId: product.id, machineId: machineB } });
    await call('POST', '/api/licenses/activate', { token: user, body: { productId: product.id, machineId: machineC }, expect: 409 });
    await call('POST', '/api/licenses/deactivate', { token: user, body: { productId: product.id, machineId: machineB } });
    await call('POST', '/api/licenses/activate', { token: user, body: { productId: product.id, machineId: machineC } });
  });

  await step('révocation : plus de droit, activations retirées', async () => {
    await call('PATCH', `/api/admin/licenses/${keys[0].id}`, { token: admin, body: { status: 'revoked' } });
    await call('POST', '/api/licenses/activate', { token: user, body: { productId: product.id, machineId: machineA }, expect: 403 });
    await call('GET', `/api/download/${version.id}`, { token: user, expect: 403 });
    const me = await call('GET', '/api/me', { token: user });
    assert.equal(me.activations.length, 0);
    assert.deepEqual(me.entitlements, {});
  });

  await step('licence expirée refusée, prolongée acceptée', async () => {
    const [timed] = await call('POST', '/api/admin/licenses', {
      token: admin, body: { productId: product.id, type: 'timed', expiresAt: Date.now() - 1000, email: 'voix@test.local' }, expect: 201,
    });
    assert.equal(timed.claimed, true);
    await call('POST', '/api/licenses/activate', { token: user, body: { productId: product.id, machineId: machineA }, expect: 403 });
    const until = Date.now() + 86400_000;
    await call('PATCH', `/api/admin/licenses/${timed.id}`, { token: admin, body: { expiresAt: until } });
    const { license } = await call('POST', '/api/licenses/activate', { token: user, body: { productId: product.id, machineId: machineA } });
    assert.equal(JSON.parse(Buffer.from(license.payload, 'base64')).expiresAt, until);
    await call('PATCH', `/api/admin/licenses/${timed.id}`, { token: admin, body: { status: 'revoked' } });
  });

  await step("clé réservée à une adresse : rattachée à l'inscription", async () => {
    await call('POST', '/api/admin/licenses', { token: admin, body: { productId: product.id, email: 'futur@test.local' }, expect: 201 });
    const futur = await register({ email: 'futur@test.local', password: 'motdepasse3' });
    const me = await call('GET', '/api/me', { token: futur });
    assert.equal(me.licenses.length, 1);
    assert.ok(me.entitlements[product.id]);
  });

  await step('achat (mode démo) : licence créée, second achat refusé', async () => {
    assert.equal((await call('POST', '/api/checkout', { token: other, body: { kind: 'product', id: product.id } })).mode, 'demo');
    const me = await call('GET', '/api/me', { token: other });
    assert.equal(me.entitlements[product.id].via, 'license');
    await call('POST', '/api/checkout', { token: other, body: { kind: 'product', id: product.id }, expect: 409 });
  });

  await step('essai gratuit : 7 jours, un seul par compte et par plugin, visible comme type "trial"', async () => {
    const tester = await register({ email: 'essai@test.local', password: 'motdepasse7' });
    const before = Date.now();
    const started = await call('POST', '/api/licenses/trial', { token: tester, body: { productId: product.id }, expect: 201 });
    assert.ok(started.expiresAt > before + 6 * 86400_000 && started.expiresAt < before + 8 * 86400_000, 'expire dans ~7 jours');

    const me = await call('GET', '/api/me', { token: tester });
    assert.equal(me.entitlements[product.id].type, 'trial');
    assert.deepEqual(me.trialsUsed, [product.id]);

    const { license } = await call('POST', '/api/licenses/activate', { token: tester, body: { productId: product.id, machineId: machineA } });
    assert.equal(JSON.parse(Buffer.from(license.payload, 'base64')).type, 'trial');

    await call('POST', '/api/licenses/trial', { token: tester, body: { productId: product.id }, expect: 409 }); // pas deux fois

    // Remise à zéro par un admin : l'essai disparaît et peut être relancé.
    const account = (await call('GET', '/api/admin/users?q=essai@test.local', { token: admin }))[0];
    assert.equal(account.trials, 1);
    await call('POST', `/api/admin/users/${account.id}/reset-trials`, { token: tester, expect: 403 });
    assert.equal((await call('POST', `/api/admin/users/${account.id}/reset-trials`, { token: admin })).removed, 1);
    assert.deepEqual((await call('GET', '/api/me', { token: tester })).trialsUsed, []);
    await call('POST', '/api/licenses/trial', { token: tester, body: { productId: product.id }, expect: 201 });
  });

  await step('abonnement : donne accès à tout, expire avec une marge, se résilie', async () => {
    run(`INSERT INTO plans (name, interval, price_cents) VALUES ('ALL ACCESS', 'month', 990)`);
    const { plans } = await call('GET', '/api/catalog');
    await call('POST', '/api/checkout', { token: user, body: { kind: 'plan', id: plans[0].id } });
    let me = await call('GET', '/api/me', { token: user });
    assert.equal(me.entitlements[product.id].via, 'subscription');
    const { license } = await call('POST', '/api/licenses/activate', { token: user, body: { productId: product.id, machineId: machineA } });
    const payload = JSON.parse(Buffer.from(license.payload, 'base64'));
    assert.equal(payload.type, 'subscription');
    assert.equal(payload.expiresAt, me.subscription.currentPeriodEnd + 3 * 86400_000);

    await call('POST', '/api/subscription/cancel', { token: user });
    me = await call('GET', '/api/me', { token: user });
    assert.equal(me.subscription.cancelAtPeriodEnd, true);
    assert.ok(me.entitlements[product.id], 'accès conservé jusqu’à la fin de la période');

    run('UPDATE subscriptions SET current_period_end = ? WHERE user_id = ?', Date.now() - 1000, me.user.id);
    await call('POST', '/api/licenses/activate', { token: user, body: { productId: product.id, machineId: machineA }, expect: 403 });
  });

  await step('support : e-mail à la boîte de support, visiteur sans compte accepté, messages listés pour les admins', async () => {
    outbox.length = 0;
    await call('POST', '/api/support', { token: user, body: { subject: 'Plugin muet', message: 'Le plugin ne sort aucun son.', context: 'TUNER 1.0.0' } });
    assert.equal(outbox.length, 1);
    assert.deepEqual([outbox[0].to, outbox[0].replyTo, outbox[0].subject], ['support@test.local', 'voix@test.local', '[Support] Plugin muet']);
    assert.match(outbox[0].text, /Le plugin ne sort aucun son\./);

    await call('POST', '/api/support', { token: user, body: { subject: '', message: 'court' }, expect: 400 });
    await call('POST', '/api/support', { body: { subject: 'Question', message: 'Est-ce compatible avec mon DAW ?' }, expect: 400 }); // visiteur sans e-mail
    await call('POST', '/api/support', { body: { subject: 'Question', message: 'Est-ce compatible avec mon DAW ?', email: 'visiteur@test.local', name: 'Visiteur' } });
    assert.equal(outbox.at(-1).replyTo, 'visiteur@test.local');
    await call('POST', '/api/support', { body: { subject: 'Spam', message: 'Achetez mes produits miracles', email: 'robot@test.local', website: 'http://spam' } });
    assert.equal(outbox.length, 2, 'le champ piège rempli ne déclenche aucun envoi');

    await call('GET', '/api/admin/support', { token: user, expect: 403 });
    const inbox = await call('GET', '/api/admin/support', { token: admin });
    assert.equal(inbox.mailbox, 'support@test.local');
    assert.deepEqual(inbox.messages.map((m) => m.email).sort(), ['visiteur@test.local', 'voix@test.local']);
    await call('DELETE', `/api/admin/support/${inbox.messages[0].id}`, { token: admin });
    assert.equal((await call('GET', '/api/admin/support', { token: admin })).messages.length, 1);
  });

  await step('mot de passe oublié : lien par e-mail, à usage unique, anciennes sessions fermées', async () => {
    const { createResetToken } = await import('../src/auth.js');
    await call('POST', '/api/auth/forgot', { body: { email: 'pas-un-email' }, expect: 400 });
    outbox.length = 0;
    await call('POST', '/api/auth/forgot', { body: { email: 'inconnu@test.local' } });
    assert.equal(outbox.length, 0, 'aucun e-mail pour une adresse sans compte, mais la même réponse');

    const before = (await call('POST', '/api/auth/login', { body: { email: 'futur@test.local', password: 'motdepasse3' } })).token;
    const id = (await call('GET', '/api/me', { token: before })).user.id;
    await call('POST', '/api/auth/forgot', { body: { email: 'futur@test.local' } });
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, 'futur@test.local');
    const token = outbox[0].text.match(/https:\/\/site\.test\/compte\?reset=([\w-]+)/)[1];

    await call('POST', '/api/auth/reset', { body: { token: 'faux-jeton', password: 'nouveau-passe-1' }, expect: 400 });
    await call('POST', '/api/auth/reset', { body: { token, password: 'court' }, expect: 400 });
    await call('POST', '/api/auth/reset', { body: { token, password: 'nouveau-passe-1' } });
    await call('POST', '/api/auth/reset', { body: { token, password: 'nouveau-passe-2' }, expect: 400 });
    await call('GET', '/api/me', { token: before, expect: 401 });
    await call('POST', '/api/auth/login', { body: { email: 'futur@test.local', password: 'motdepasse3' }, expect: 401 });
    await call('POST', '/api/auth/login', { body: { email: 'futur@test.local', password: 'nouveau-passe-1' } });

    const expired = createResetToken(id);
    run('UPDATE password_resets SET expires_at = ? WHERE user_id = ?', Date.now() - 1, id);
    await call('POST', '/api/auth/reset', { body: { token: expired, password: 'nouveau-passe-3' }, expect: 400 });
  });

  await step('changement de mot de passe : les anciennes sessions tombent', async () => {
    const { token } = await call('POST', '/api/me/password', { token: other, body: { current: 'motdepasse2', next: 'nouveau-passe-9' } });
    await call('GET', '/api/me', { token: other, expect: 401 });
    await call('GET', '/api/me', { token });
    await call('POST', '/api/auth/logout', { token });
    await call('GET', '/api/me', { token, expect: 401 });
  });

  await step('suppression de version : fichier retiré du disque', async () => {
    const before = fs.readdirSync(path.join(dataDir, 'files')).length;
    await call('DELETE', `/api/admin/versions/${version.id}`, { token: admin });
    assert.equal(fs.readdirSync(path.join(dataDir, 'files')).length, before - 1);
  });

  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
