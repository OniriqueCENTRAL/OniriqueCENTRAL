// Parcours complet de l'API sur une base jetable : node test/smoke.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-test-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test' }); // SMTP "test" : les e-mails restent dans outbox

// La source du score de popularité est remplacée par un faux service : aucun appel ne sort pendant les tests.
const popularityCalls = [];
const popularitySource = http.createServer((req, res) => {
  const q = new URL(req.url, 'http://x').searchParams.get('q');
  popularityCalls.push(q);
  res.setHeader('Content-Type', 'application/json');
  if (q === 'panne') return res.end('<html>indisponible</html>');
  if (q === 'inconnu') return res.end(JSON.stringify({ status: 'error' }));
  res.end(JSON.stringify({ type: 'artist', id: '4tZwfgrHOc3mvqYlEYSvVi', name: 'Voix Test', followers: 1234, popularity: 41, secret: 'x',
    image: 'https://ailleurs.test/photo.jpg',
    topTracks: [{ id: 'a', name: 'Titre', popularity: 150, externalUrl: 'https://open.spotify.com/track/abc' }, { name: 'Piège', popularity: 3, externalUrl: 'javascript:alert(1)' }] }));
}).listen(0);
process.env.POPULARITY_SOURCE = `http://127.0.0.1:${popularitySource.address().port}/`;

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
// Un plugin payant n'est accepté que s'il embarque la clé publique du serveur (module de licence).
const licenseKey = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }).subarray(-32);
const binary = Buffer.concat([crypto.randomBytes(300_000), licenseKey]);
/** Un .zip d'un seul fichier compressé, comme ceux que produit la compilation Mac. */
function zipOf(name, content) {
  const packed = zlib.deflateRawSync(content);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + packed.length, 16);
  return Buffer.concat([local, Buffer.from(name), packed, central, Buffer.from(name), end]);
}
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
    // Plugin payant sans module de licence : refusé, en .vst3 comme en .zip.
    const bare = new URLSearchParams({ version: '9.9.9', filename: 'ONIRIQUE TEST.vst3' });
    await call('POST', `/api/admin/products/${product.id}/versions?${bare}`, { token: admin, raw: crypto.randomBytes(1000), expect: 400 });
    const bareZip = new URLSearchParams({ version: '9.9.9', filename: 'ONIRIQUE TEST.vst3.zip', platform: 'mac' });
    await call('POST', `/api/admin/products/${product.id}/versions?${bareZip}`, { token: admin, raw: zipOf('plugin', crypto.randomBytes(1000)), expect: 400 });

    // Versions Mac : même numéro accepté à côté de celui de Windows, .vst3 nu refusé, et chaque système voit la sienne.
    await call('POST', `/api/admin/products/${product.id}/versions?${q}&platform=mac`, { token: admin, raw: binary, expect: 400 });
    const macQuery = new URLSearchParams({ version: new URLSearchParams(q).get('version'), filename: 'ONIRIQUE TEST.vst3.zip', platform: 'mac' });
    const macVersion = await call('POST', `/api/admin/products/${product.id}/versions?${macQuery}`, { token: admin, raw: zipOf('plugin', binary), expect: 201 });
    assert.equal(macVersion.platform, 'mac');
    assert.deepEqual(macVersion.formats, [], 'un .zip sans plugin dedans n\'annonce aucun format');
    assert.deepEqual((await call('GET', '/api/catalog')).products.find((p) => p.id === product.id).platforms.sort(), ['mac', 'win']);
    const latestFor = async (headers) => (await (await fetch(`${base}/api/catalog`, { headers })).json()).products.find((p) => p.id === product.id).latest;
    assert.equal((await latestFor({})).id, version.id);
    assert.equal((await latestFor({ 'X-Onirique-Platform': 'mac' })).id, macVersion.id);
    await call('DELETE', `/api/admin/versions/${macVersion.id}`, { token: admin });
    assert.equal(await latestFor({ 'X-Onirique-Platform': 'mac' }), null);
    // Le panel admin dit, version par version, si le plugin embarque le module de licence.
    const listed = (await call('GET', '/api/admin/products', { token: admin })).find((p) => p.id === product.id);
    assert.deepEqual(listed.licensed, { win: true }, 'la version Mac a été retirée : seul Windows est annoncé');
    assert.equal(listed.versions[0].licensed, true);
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

  await step('ALL LICENCE : une clé de pack donne une licence par plugin, rattachées d\'un coup', async () => {
    const second = await call('POST', '/api/admin/products', { token: admin, body: { name: 'ONIRIQUE PACK', priceCents: 1000, accent: '#e23444' }, expect: 201 });
    const [pack] = await call('POST', '/api/admin/licenses', { token: admin, body: { productId: 'all', count: 1, maxActivations: 2 }, expect: 201 });
    assert.match(pack.key, /^ONIR(-[A-Z2-9]{4}){4}$/);
    assert.match(pack.productName, /^ALL LICENCE · 2 plugins$/);
    const inPack = (await call('GET', `/api/admin/licenses?q=${pack.key}`, { token: admin })).filter((l) => l.bundle === pack.key);
    assert.deepEqual(inPack.map((l) => l.productId).sort(), [product.id, second.id].sort());

    const holder = (await call('POST', '/api/auth/register', { body: { email: 'pack@test.local', password: 'motdepasse8' }, expect: 201 })).token;
    run(`UPDATE users SET email_verified = 1 WHERE email = 'pack@test.local'`);
    assert.equal((await call('POST', '/api/licenses/redeem', { token: holder, body: { key: pack.key } })).products, 2);
    const mine = await call('GET', '/api/me', { token: holder });
    assert.deepEqual(Object.keys(mine.entitlements).map(Number).sort(), [product.id, second.id].sort());
    await call('POST', '/api/licenses/redeem', { token: holder, body: { key: pack.key }, expect: 409 });
    await call('POST', '/api/licenses/redeem', { token: other, body: { key: pack.key }, expect: 409 });
    run('DELETE FROM products WHERE id = ?', second.id);
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

  await step('paiement Stripe (événements simulés) : licence définitive, e-mail de confirmation, rien en double', async () => {
    const { handleStripeEvent, verifyStripeSignature } = await import('../src/payments.js');
    const { config } = await import('../src/config.js');
    const buyer = (await call('POST', '/api/auth/register', { body: { email: 'acheteur@test.local', password: 'motdepasse9' }, expect: 201 })).token;
    const buyerId = (await call('GET', '/api/me', { token: buyer })).user.id;
    const paid = { type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', mode: 'payment', payment_status: 'paid',
      amount_total: 2500, customer: 'cus_test_1', metadata: { user_id: String(buyerId), kind: 'product', ref_id: String(product.id) } } } };
    outbox.length = 0;
    const platform = { creator: 'onirique', key: 'sk_test_essai', managed: true };
    await handleStripeEvent(paid, platform);
    await handleStripeEvent(paid, platform); // Stripe renvoie parfois le même événement
    const mine = await call('GET', '/api/me', { token: buyer });
    assert.equal(mine.entitlements[product.id].type, 'perpetual');
    assert.equal(mine.licenses.filter((l) => l.productId === product.id).length, 1, 'une seule licence malgré l\'événement en double');
    const mails = outbox.filter((m) => m.to === 'acheteur@test.local' && /Confirmation de commande/.test(m.subject));
    assert.equal(mails.length, 1);
    assert.match(mails[0].text, /ONIRIQUE TEST — licence définitive/);
    assert.match(mails[0].text, /revendeur Link \(Stripe\)/, 'en Managed Payments, le client voit Link comme vendeur');
    assert.match(mails[0].text, /25,00\s€ TTC/);

    // Un client hors zone euro paie dans sa monnaie : la confirmation annonce ce qu'il a réellement payé.
    outbox.length = 0;
    run('DELETE FROM licenses WHERE user_id = ?', buyerId);
    await handleStripeEvent({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_yen', mode: 'payment', payment_status: 'paid',
      amount_total: 4200, currency: 'jpy', metadata: { user_id: String(buyerId), kind: 'product', ref_id: String(product.id) } } } }, platform);
    assert.match(outbox.at(-1).text, /4.200.(JPY|¥) TTC/);

    // Un paiement pas encore reçu n'accorde rien.
    await handleStripeEvent({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_2', mode: 'payment', payment_status: 'unpaid',
      metadata: { user_id: String(buyerId), kind: 'product', ref_id: String(product.id) } } } }, platform);
    assert.equal((await call('GET', '/api/me', { token: buyer })).licenses.length, 1);

    // La signature du webhook : acceptée avec le bon secret, refusée sinon ou si elle est trop ancienne.
    const body = JSON.stringify(paid), t = Math.floor(Date.now() / 1000);
    const sign = (time, secret) => `t=${time},v1=${crypto.createHmac('sha256', secret).update(`${time}.${body}`).digest('hex')}`;
    verifyStripeSignature(body, sign(t, 'whsec_essai'), 'whsec_essai');
    assert.throws(() => verifyStripeSignature(body, sign(t, 'whsec_autre'), 'whsec_essai'), /invalide/);
    assert.throws(() => verifyStripeSignature(body, sign(t - 3600, 'whsec_essai'), 'whsec_essai'), /périmée/);
  });

  await step('abonnement Stripe (événements simulés) : mensuel actif, plugins choisis, fin à la résiliation', async () => {
    const { handleStripeEvent } = await import('../src/payments.js');
    const sub = (await call('POST', '/api/auth/register', { body: { email: 'abonne@test.local', password: 'motdepasse10' }, expect: 201 })).token;
    const subId = (await call('GET', '/api/me', { token: sub })).user.id;
    run(`INSERT INTO plans (name, interval, price_cents, kind) VALUES ('À LA CARTE', 'month', 999, 'pick')`);
    const planId = db.prepare(`SELECT id FROM plans WHERE kind = 'pick'`).get().id;
    const end = Math.floor(Date.now() / 1000) + 30 * 86400;
    const event = (status) => ({ type: 'customer.subscription.updated', data: { object: { id: 'sub_test_1', status, current_period_end: end,
      cancel_at_period_end: false, metadata: { user_id: String(subId), plan_id: String(planId), product_ids: JSON.stringify([product.id]) } } } });
    await handleStripeEvent(event('active'), { creator: 'onirique', key: 'sk_test_essai', managed: true });
    let me = await call('GET', '/api/me', { token: sub });
    assert.equal(me.entitlements[product.id].type, 'subscription');
    assert.ok(me.entitlements[product.id].expiresAt > end * 1000, 'la licence court jusqu\'à la fin de la période payée, avec une marge');
    await handleStripeEvent(event('canceled'), { creator: 'onirique', key: 'sk_test_essai', managed: true });
    me = await call('GET', '/api/me', { token: sub });
    assert.equal(me.entitlements[product.id], undefined);
    run('DELETE FROM subscriptions WHERE user_id = ?', subId);
    run(`DELETE FROM plans WHERE kind = 'pick'`);
  });

  await step('paiement Lemon Squeezy (événements simulés) : licence, e-mail, abonnement, remboursement, signature', async () => {
    const { handleLemonEvent, verifyLemonSignature } = await import('../src/payments.js');
    const { config } = await import('../src/config.js');
    const token = (await call('POST', '/api/auth/register', { body: { email: 'citron@test.local', password: 'motdepasse11' }, expect: 201 })).token;
    const id = (await call('GET', '/api/me', { token })).user.id;
    const custom = { user_id: String(id), kind: 'product', ref_id: String(product.id) };
    const order = (event_name, status) => ({ meta: { event_name, custom_data: custom }, data: { type: 'orders', id: '501', attributes: { status, total: 2500 } } });
    outbox.length = 0;
    handleLemonEvent(order('order_created', 'pending')); // pas encore payé : rien
    assert.equal((await call('GET', '/api/me', { token })).licenses.length, 0);
    handleLemonEvent(order('order_created', 'paid'));
    handleLemonEvent(order('order_created', 'paid')); // événement renvoyé
    let me = await call('GET', '/api/me', { token });
    assert.equal(me.entitlements[product.id].type, 'perpetual');
    assert.equal(me.licenses.length, 1);
    const mails = outbox.filter((m) => m.to === 'citron@test.local');
    assert.equal(mails.length, 1);
    assert.match(mails[0].text, /Lemon Squeezy/);
    assert.doesNotMatch(mails[0].text, /rétractation/);

    // Remboursement partiel : rien ne change. Remboursement complet : la licence est révoquée.
    run('UPDATE users SET email_verified = 1 WHERE id = ?', id); // l'activation demande une adresse validée
    await call('POST', '/api/licenses/activate', { token, body: { productId: product.id, machineId: machineA } });
    handleLemonEvent(order('order_refunded', 'partial_refund'));
    assert.ok((await call('GET', '/api/me', { token })).entitlements[product.id]);
    handleLemonEvent(order('order_refunded', 'refunded'));
    me = await call('GET', '/api/me', { token });
    assert.equal(me.entitlements[product.id], undefined);
    assert.equal(me.activations.filter((a) => a.productId === product.id).length, 0);

    // Abonnement mensuel à la carte : actif, puis résilié (accès gardé jusqu'à la fin payée), puis expiré.
    run(`INSERT INTO plans (name, interval, price_cents, kind) VALUES ('À LA CARTE', 'month', 999, 'pick')`);
    const planId = db.prepare(`SELECT id FROM plans WHERE kind = 'pick'`).get().id;
    const later = new Date(Date.now() + 20 * 86400_000).toISOString();
    const sub = (event_name, status, dates) => ({ meta: { event_name, custom_data: { user_id: String(id), kind: 'plan', ref_id: String(planId), product_ids: JSON.stringify([product.id]) } },
      data: { type: 'subscriptions', id: '77', attributes: { status, renews_at: null, ends_at: null, ...dates } } });
    handleLemonEvent(sub('subscription_created', 'active', { renews_at: later }));
    me = await call('GET', '/api/me', { token });
    assert.equal(me.entitlements[product.id].type, 'subscription');
    handleLemonEvent(sub('subscription_cancelled', 'cancelled', { ends_at: later }));
    me = await call('GET', '/api/me', { token });
    assert.ok(me.entitlements[product.id], 'résilié : l\'accès reste jusqu\'à la fin de la période payée');
    assert.equal(me.subscription.cancelAtPeriodEnd, true);
    handleLemonEvent(sub('subscription_expired', 'expired', { ends_at: new Date(Date.now() - 1000).toISOString() }));
    assert.equal((await call('GET', '/api/me', { token })).entitlements[product.id], undefined);
    run('DELETE FROM subscriptions WHERE user_id = ?', id);
    run(`DELETE FROM plans WHERE kind = 'pick'`);

    // Une vente faite ailleurs que sur ce site (sans nos données) ne touche à rien.
    handleLemonEvent({ meta: { event_name: 'order_created' }, data: { id: '9', attributes: { status: 'paid' } } });

    config.lemonWebhookSecret = 'secret-essai';
    const body = JSON.stringify(order('order_created', 'paid'));
    verifyLemonSignature(body, crypto.createHmac('sha256', 'secret-essai').update(body).digest('hex'));
    assert.throws(() => verifyLemonSignature(body, crypto.createHmac('sha256', 'autre').update(body).digest('hex')), /invalide/);
    assert.throws(() => verifyLemonSignature(body, undefined), /invalide/);
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

  await step('popularité : score lu à la source, réponse filtrée, gardée en mémoire', async () => {
    const found = await call('GET', '/api/popularity?q=Voix%20Test');
    assert.deepEqual(found, { type: 'artist', name: 'Voix Test', artist: null, image: null, url: 'https://open.spotify.com/artist/4tZwfgrHOc3mvqYlEYSvVi',
      popularity: 41, followers: 1234, tracks: [{ name: 'Titre', popularity: 100, url: 'https://open.spotify.com/track/abc' }, { name: 'Piège', popularity: 3, url: null }] });
    await call('GET', '/api/popularity?q=voix%20test');
    assert.deepEqual(popularityCalls, ['Voix Test'], 'la même recherche ne repart pas à la source');
    await call('GET', '/api/popularity?q=', { expect: 400 });
    assert.match((await call('GET', '/api/popularity?q=inconnu', { expect: 404 })).error, /introuvable/);
    await call('GET', '/api/popularity?q=panne', { expect: 502 });
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

  await step('ancien compte : adresse à confirmer sans rien fermer, lien renvoyé à la demande, confirmée par le lien', async () => {
    const old = (await call('POST', '/api/auth/login', { body: { email: 'futur@test.local', password: 'motdepasse3' } })).token;
    const before = (await call('GET', '/api/me', { token: old })).user;
    assert.deepEqual([before.emailVerified, before.emailToConfirm], [true, false]);
    run('UPDATE users SET email_verified = 2 WHERE id = ?', before.id);
    const flagged = (await call('GET', '/api/me', { token: old })).user;
    assert.deepEqual([flagged.emailVerified, flagged.emailToConfirm], [true, true], 'rien ne lui est fermé, mais le rappel est demandé');
    outbox.length = 0;
    assert.equal((await call('POST', '/api/auth/verify/resend', { token: old })).alreadyVerified, undefined);
    assert.equal(outbox.length, 1);
    assert.doesNotMatch(outbox[0].text, /restent fermés/);
    await call('POST', '/api/auth/verify', { body: { token: outbox[0].text.match(/\?verify=([\w-]+)/)[1] } });
    assert.equal((await call('GET', '/api/me', { token: old })).user.emailToConfirm, false);
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
  popularitySource.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
