// Panel en direct : annonce, maintenance, abonnements et packs, suppression de compte, limites d'essai, crédits.
// Sur une base jetable : node test/control.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-control-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', TRIALS_PER_IP: '2',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://api.test', FOUNDER_EMAILS: '',
  POPULARITY_SOURCE: 'http://127.0.0.1:9/' });

const { createApp } = await import('../src/app.js');
const { run, get, db } = await import('../src/db.js');
const { publicKeyPem } = await import('../src/licensing.js');
const { outbox } = await import('../src/mail.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, route, { token, body, raw, expect = 200 } = {}) {
  const response = await fetch(base + route, {
    method, redirect: 'manual',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const isJson = response.headers.get('content-type')?.includes('json');
  const data = isJson ? await response.json() : await response.text();
  assert.equal(response.status, expect, `${method} ${route} → ${response.status} ${isJson ? JSON.stringify(data) : ''}`);
  return data;
}

let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }

async function account(name, role) {
  const email = `${name}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  const link = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await call('POST', '/api/auth/verify', { body: { token: link } });
  if (role) run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return { token, email, id: get('SELECT id FROM users WHERE email = ?', email).id };
}
const binary = Buffer.concat([crypto.randomBytes(2000), crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }).subarray(-32)]);
const machine = (seed) => crypto.createHash('sha256').update('control:' + seed).digest('hex').slice(0, 40);

let founder, admin, alice, bob, a, b, c, partnerPlugin;
try {
  await step('comptes et plugins de départ', async () => {
    founder = await account('fondateur', 'founder');
    admin = await account('admin', 'admin');
    alice = await account('alice');
    bob = await account('bob');
    a = await call('POST', '/api/admin/products', { token: admin.token, body: { name: 'ONIRIQUE A', priceCents: 3000 }, expect: 201 });
    b = await call('POST', '/api/admin/products', { token: admin.token, body: { name: 'ONIRIQUE B', priceCents: 2000 }, expect: 201 });
    c = await call('POST', '/api/admin/products', { token: admin.token, body: { name: 'ONIRIQUE C', priceCents: 1000 }, expect: 201 });
    partnerPlugin = await call('POST', '/api/admin/products', { token: admin.token, body: { name: 'RAW', priceCents: 3000, creator: 'abrasion' }, expect: 201 });
    for (const p of [a, b, c, partnerPlugin]) await call('POST', `/api/admin/products/${p.id}/versions?${new URLSearchParams({ version: '1.0.0', filename: 'P.vst3' })}`, { token: admin.token, raw: binary, expect: 201 });
  });

  await step('annonce en direct : affichée sur le site, retirée à la date de fin', async () => {
    assert.equal((await call('GET', '/api/site')).announcement, null);
    await call('PUT', '/api/admin/live/announcement', { token: admin.token, body: { active: true, text: 'PROMO 20 % SUR TOUTE LA BOUTIQUE', link: 'javascript:alert(1)' }, expect: 400 });
    await call('PUT', '/api/admin/live/announcement', { token: alice.token, body: { active: true, text: 'x' }, expect: 403 });
    const set = await call('PUT', '/api/admin/live/announcement', { token: admin.token, body: { active: true, text: 'PROMO 20 % SUR TOUTE LA BOUTIQUE', link: 'boutique.html', linkLabel: 'Voir', tone: 'gold' } });
    const shown = (await call('GET', '/api/site')).announcement;
    assert.deepEqual(shown, { id: set.id, text: 'PROMO 20 % SUR TOUTE LA BOUTIQUE', link: 'boutique.html', linkLabel: 'Voir', tone: 'gold' });
    await call('PUT', '/api/admin/live/announcement', { token: admin.token, body: { active: true, text: 'PROMO 20 % SUR TOUTE LA BOUTIQUE', endsAt: '2001-01-01T00:00' } });
    assert.equal((await call('GET', '/api/site')).announcement, null, 'passée la date de fin, plus rien');
  });

  await step('maintenance : activée et coupée depuis le panel', async () => {
    await call('PUT', '/api/admin/live/maintenance', { token: admin.token, body: { on: true, message: 'Retour à 18 h.' } });
    assert.deepEqual((await call('GET', '/api/site')).maintenance, { on: true, message: 'Retour à 18 h.' });
    await call('PUT', '/api/admin/live/maintenance', { token: admin.token, body: { on: false } });
    assert.equal((await call('GET', '/api/site')).maintenance, null);
  });

  let plan;
  await step('abonnement : nouvelle formule, texte et plugins compris, appliqués aux droits', async () => {
    await call('POST', '/api/admin/plans', { token: admin.token, body: { name: 'DUO', interval: 'month', priceCents: 999, productIds: [a.id, partnerPlugin.id] }, expect: 400 });
    plan = await call('POST', '/api/admin/plans', { token: admin.token, body: { name: 'DUO', interval: 'month', priceCents: 999, description: 'Deux plugins.', productIds: [a.id, b.id] }, expect: 201 });
    const listed = (await call('GET', '/api/catalog')).plans.find((p) => p.id === plan.id);
    assert.equal(listed.description, 'Deux plugins.');
    assert.deepEqual(listed.productIds, [a.id, b.id]);
    await call('POST', '/api/checkout', { token: alice.token, body: { kind: 'plan', id: plan.id } });
    const me = await call('GET', '/api/me', { token: alice.token });
    assert.ok(me.entitlements[a.id] && me.entitlements[b.id], 'les plugins de la formule');
    assert.ok(!me.entitlements[c.id], 'pas ceux qui n\'y sont pas');
    await call('PATCH', `/api/admin/plans/${plan.id}`, { token: admin.token, body: { productIds: [a.id, b.id, c.id], description: 'Trois plugins.' } });
    assert.ok((await call('GET', '/api/me', { token: alice.token })).entitlements[c.id], 'un plugin ajouté à la formule profite aux abonnés');
    await call('DELETE', `/api/admin/plans/${plan.id}`, { token: admin.token, expect: 409 });
  });

  await step('pack : plusieurs plugins en un achat, une licence définitive chacun', async () => {
    await call('POST', '/api/admin/packs', { token: admin.token, body: { name: 'SOLO', priceCents: 1000, productIds: [a.id] }, expect: 400 });
    const pack = await call('POST', '/api/admin/packs', { token: admin.token, body: { name: 'VOIX', description: 'Le pack voix.', priceCents: 4500, productIds: [b.id, c.id] }, expect: 201 });
    assert.equal((await call('GET', '/api/catalog')).packs[0].name, 'VOIX');
    await call('POST', '/api/checkout', { token: bob.token, body: { kind: 'pack', id: pack.id } });
    const licences = db.prepare(`SELECT product_id, type, bundle FROM licenses WHERE user_id = ? AND status = 'active' ORDER BY product_id`).all(bob.id);
    assert.deepEqual(licences.map((l) => l.product_id), [b.id, c.id]);
    assert.ok(licences.every((l) => l.type === 'perpetual' && l.bundle?.startsWith('pack:')));
    await call('POST', '/api/checkout', { token: bob.token, body: { kind: 'pack', id: pack.id }, expect: 409 });
  });

  await step('historique des achats : qui, quoi, à quel créateur, totaux', async () => {
    const h = await call('GET', '/api/admin/orders', { token: admin.token });
    const pack = h.orders.find((o) => o.kind === 'pack');
    assert.deepEqual([pack.item, pack.creator, pack.user.email], ['Pack VOIX', 'onirique', bob.email]);
    assert.equal(h.totals.onirique.orders >= 1, true);
    assert.equal((await call('GET', '/api/admin/orders?creator=abrasion', { token: admin.token })).orders.length, 0);
    await call('GET', '/api/admin/orders', { token: alice.token, expect: 403 });
  });

  await step('essai gratuit : un par ordinateur et deux par connexion, quel que soit le compte', async () => {
    await call('POST', '/api/licenses/trial', { token: bob.token, body: { productId: a.id }, expect: 426 });
    await call('POST', '/api/licenses/trial', { token: bob.token, body: { productId: a.id, machineId: machine('pc1') }, expect: 201 });
    const carol = await account('carol');
    await call('POST', '/api/licenses/trial', { token: carol.token, body: { productId: a.id, machineId: machine('pc1') }, expect: 409 });
    await call('POST', '/api/licenses/trial', { token: carol.token, body: { productId: a.id, machineId: machine('pc2') }, expect: 201 });
    const dave = await account('dave');
    const refused = await call('POST', '/api/licenses/trial', { token: dave.token, body: { productId: a.id, machineId: machine('pc3') }, expect: 409 });
    assert.match(refused.error, /connexion/);
    await call('POST', '/api/licenses/trial', { token: dave.token, body: { productId: c.id, machineId: machine('pc3') }, expect: 201 });
  });

  await step('crédits : plusieurs plugins, un album, l\'ingé et son Instagram', async () => {
    await call('POST', '/api/me/profile', { token: founder.token, body: { instagram: 'pas un lien !' }, expect: 400 });
    await call('POST', '/api/me/profile', { token: founder.token, body: { instagram: 'https://www.instagram.com/onirique.ingé' }, expect: 400 });
    await call('POST', '/api/me/profile', { token: founder.token, body: { instagram: '@onirique.inge' } });
    assert.equal((await call('GET', '/api/me', { token: founder.token })).user.instagram, 'https://www.instagram.com/onirique.inge/');
    const founders = await call('GET', '/api/admin/founders', { token: admin.token });
    assert.deepEqual(founders.map((f) => f.id), [founder.id]);
    await call('POST', '/api/admin/credits', { token: admin.token, body: { spotifyUrl: 'https://open.spotify.com/track/0123456789abcdefghijkl', artist: 'Novi', title: 'Cinéma', engineerId: alice.id }, expect: 400 });
    await call('POST', '/api/admin/credits', { token: admin.token, body: { spotifyUrl: 'https://open.spotify.com/track/0123456789abcdefghijkl', artist: 'Novi', title: 'Cinéma', productIds: [a.id, b.id], engineerId: founder.id }, expect: 201 });
    const album = await call('POST', '/api/admin/credits', { token: admin.token, body: { spotifyUrl: 'https://open.spotify.com/album/abcdefghijkl0123456789', artist: 'Novi', title: 'Nuit' }, expect: 201 });
    assert.equal(album.kind, 'Album');
    assert.equal(album.spotifyType, 'album');
    run('UPDATE credits SET popularity = 80 WHERE id = ?', album.id);
    const list = await call('GET', '/api/credits');
    assert.equal(list[0].title, 'Nuit', 'le plus connu en premier');
    const track = list.find((x) => x.title === 'Cinéma');
    assert.deepEqual(track.plugins.map((p) => p.id), [a.id, b.id]);
    assert.deepEqual(track.engineer && { name: track.engineer.name, instagram: track.engineer.instagram }, { name: 'fondateur', instagram: 'https://www.instagram.com/onirique.inge/' });
  });

  await step("activation : deux empreintes, bail de 90 jours, reprise de l'ancienne, nouvelles machines limitées", async () => {
    const decode = (license) => JSON.parse(Buffer.from(license.payload, 'base64').toString('utf8'));
    const [v1, v2] = [machine('ancien'), machine('nouveau')];
    // Ancien ONIRIQUE CENTRAL : une seule empreinte, celle d'avant.
    const old = decode((await call('POST', '/api/licenses/activate', { token: alice.token, body: { productId: a.id, machineId: v1 } })).license);
    assert.equal(old.machine, v1);
    assert.equal(old.machine2, undefined);
    // Le bail : 90 jours, ou moins si la licence elle-même finit avant (un abonnement, ici).
    assert.equal(old.leaseUntil, Math.min(old.expiresAt ?? Infinity, old.issuedAt + 90 * 86400_000));
    // Nouveau : la même machine sous sa nouvelle empreinte reprend l'activation, sans en compter une de plus.
    const fresh = decode((await call('POST', '/api/licenses/activate', { token: alice.token, body: { productId: a.id, machineId: v2, legacyMachineId: v1 } })).license);
    assert.deepEqual([fresh.machine, fresh.machine2], [v1, v2]);
    const me = await call('GET', '/api/me', { token: alice.token });
    assert.deepEqual(me.activations.filter((x) => x.productId === a.id).map((x) => x.machineId), [v2]);
    // Faire tourner la licence : désactiver, activer ailleurs… au-delà de la limite + 3 nouveaux ordinateurs par mois, refusé.
    for (let i = 0; i < 4; i++) {
      await call('POST', '/api/licenses/activate', { token: alice.token, body: { productId: a.id, machineId: machine('pc-tour-' + i) } });
      await call('POST', '/api/licenses/deactivate', { token: alice.token, body: { productId: a.id, machineId: machine('pc-tour-' + i) } });
    }
    await call('POST', '/api/licenses/activate', { token: alice.token, body: { productId: a.id, machineId: machine('pc-tour-9') }, expect: 429 });
  });

  await step('suppression de compte : après avoir tapé SUPPRIME, licences révoquées', async () => {
    await call('DELETE', `/api/admin/users/${bob.id}`, { token: admin.token, body: { confirm: 'oui' }, expect: 400 });
    await call('DELETE', `/api/admin/users/${founder.id}`, { token: admin.token, body: { confirm: 'SUPPRIME' }, expect: 403 });
    await call('DELETE', `/api/admin/users/${admin.id}`, { token: admin.token, body: { confirm: 'SUPPRIME' }, expect: 400 });
    await call('DELETE', `/api/admin/users/${bob.id}`, { token: alice.token, body: { confirm: 'SUPPRIME' }, expect: 403 });
    await call('DELETE', `/api/admin/users/${bob.id}`, { token: admin.token, body: { confirm: 'SUPPRIME' } });
    assert.equal(get('SELECT id FROM users WHERE id = ?', bob.id), undefined);
    assert.equal(get(`SELECT COUNT(*) AS n FROM licenses WHERE status = 'active' AND note LIKE '%compte supprimé%'`).n, 0);
    assert.ok(get(`SELECT COUNT(*) AS n FROM licenses WHERE status = 'revoked' AND note LIKE '%compte supprimé%'`).n >= 2);
    await call('GET', '/api/me', { token: bob.token, expect: 401 });
    // Ses achats restent dans l'historique (obligation comptable), avec son adresse.
    const history = await call('GET', '/api/admin/orders', { token: admin.token });
    assert.ok(history.orders.some((o) => o.user.email === bob.email && o.user.deleted && o.item === 'Pack VOIX'));
    const users = await call('GET', '/api/admin/users', { token: admin.token });
    assert.ok('avatar' in users[0], 'la photo de profil est dans la liste des comptes');
  });

  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  db.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows garde parfois la base ouverte un instant */ }
}
process.exit(0);
