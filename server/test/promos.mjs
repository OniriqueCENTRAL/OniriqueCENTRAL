// Codes promo, parrainage, catégories et e-mails aux inscrits, sur une base jetable : node test/promos.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-promos-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', MAILING_INTERVAL_MS: '20',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://api.test', FOUNDER_EMAILS: '' });

const { createApp } = await import('../src/app.js');
const { run, get, db } = await import('../src/db.js');
const { publicKeyPem } = await import('../src/licensing.js');
const { outbox } = await import('../src/mail.js');
const { rewardSponsor } = await import('../src/promos.js');

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

async function account(name, role, extra = {}) {
  const email = `${name}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name, ...extra }, expect: 201 });
  const link = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await call('POST', '/api/auth/verify', { body: { token: link } });
  if (role) run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return { token, email, id: get('SELECT id FROM users WHERE email = ?', email).id };
}
const binary = Buffer.concat([crypto.randomBytes(2000), crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }).subarray(-32)]);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

let admin, partner, alice, bob, carol, tuner, raw, meter;
try {
  await step('plugins et comptes de départ', async () => {
    admin = await account('admin', 'admin');
    partner = await account('abrasion', 'abrasion');
    alice = await account('alice');
    tuner = await call('POST', '/api/admin/products', { token: admin.token, body: { name: 'ONIRIQUE TUNER', tagline: 'Correction de la voix', priceCents: 4000 }, expect: 201 });
    raw = await call('POST', '/api/admin/products', { token: admin.token, body: { name: 'RAW', tagline: 'Synthé wavetable', priceCents: 3000, creator: 'abrasion' }, expect: 201 });
    meter = await call('POST', '/api/admin/products', { token: admin.token, body: { name: 'METER', priceCents: 2000, category: 'meter' }, expect: 201 });
    for (const p of [tuner, raw, meter]) await call('POST', `/api/admin/products/${p.id}/versions?${new URLSearchParams({ version: '1.0.0', filename: 'P.vst3' })}`, { token: admin.token, raw: binary, expect: 201 });
  });

  await step('catégories : une seule par plugin, choisie dans le panel, sinon devinée', async () => {
    const catalog = await call('GET', '/api/catalog');
    assert.deepEqual(catalog.categories.map((c) => c.id), ['beat', 'mix', 'master', 'meter', 'app']);
    const of = (id) => catalog.products.find((p) => p.id === id).categories;
    assert.deepEqual(of(meter.id), ['meter']);
    assert.deepEqual(of(tuner.id), ['mix']);
    assert.deepEqual(of(raw.id), ['beat']);
    await call('PATCH', `/api/admin/products/${raw.id}`, { token: admin.token, body: { category: 'voice' }, expect: 400 });
    await call('PATCH', `/api/admin/products/${tuner.id}`, { token: admin.token, body: { category: 'master' } });
    assert.deepEqual((await call('GET', '/api/catalog')).products.find((p) => p.id === tuner.id).categories, ['master']);
    await call('PATCH', `/api/admin/products/${tuner.id}`, { token: admin.token, body: { category: '' } });
  });

  await step('code promo : créé par un admin, vérifié, appliqué au paiement, une fois par compte', async () => {
    await call('POST', '/api/admin/promos', { token: admin.token, body: { code: 'noel20', percent: 20 }, expect: 201 });
    await call('POST', '/api/admin/promos', { token: admin.token, body: { code: 'NOEL20', percent: 10 }, expect: 409 });
    await call('POST', '/api/admin/promos', { token: admin.token, body: { code: 'X', percent: 10 }, expect: 400 });
    await call('POST', '/api/admin/promos', { token: admin.token, body: { code: 'DOUBLE', percent: 10, amountCents: 500 }, expect: 400 });
    const q = await call('POST', '/api/promo/quote', { token: alice.token, body: { productId: tuner.id, code: ' noel20 ' } });
    assert.equal(q.finalCents, 3200);
    assert.equal(q.label, '-20 %');
    await call('POST', '/api/promo/quote', { token: alice.token, body: { productId: tuner.id, code: 'FAUX' }, expect: 404 });
    await call('POST', '/api/checkout', { token: alice.token, body: { kind: 'product', id: tuner.id, promo: 'NOEL20' } });
    assert.equal(get('SELECT amount_cents FROM orders WHERE user_id = ?', alice.id).amount_cents, 3200);
    await call('POST', '/api/promo/quote', { token: alice.token, body: { productId: meter.id, code: 'NOEL20' }, expect: 409 });
    const list = await call('GET', '/api/admin/promos', { token: admin.token });
    assert.equal(list[0].uses, 1);
  });

  await step('code limité : plugins choisis, nombre d\'utilisations, date de fin, désactivé', async () => {
    const promo = await call('POST', '/api/admin/promos', { token: admin.token, body: { code: 'METER5', amountCents: 500, productIds: [meter.id], maxUses: 1 }, expect: 201 });
    await call('POST', '/api/promo/quote', { token: alice.token, body: { productId: raw.id, code: 'METER5' }, expect: 400 });
    assert.equal((await call('POST', '/api/promo/quote', { token: alice.token, body: { productId: meter.id, code: 'METER5' } })).finalCents, 1500);
    await call('PATCH', `/api/admin/promos/${promo.id}`, { token: admin.token, body: { expiresAt: Date.now() - 1000 } });
    await call('POST', '/api/promo/quote', { token: alice.token, body: { productId: meter.id, code: 'METER5' }, expect: 410 });
    await call('PATCH', `/api/admin/promos/${promo.id}`, { token: admin.token, body: { expiresAt: null, active: false } });
    await call('POST', '/api/promo/quote', { token: alice.token, body: { productId: meter.id, code: 'METER5' }, expect: 404 });
  });

  await step('un partenaire ne crée que des codes pour ses propres plugins', async () => {
    const own = await call('POST', '/api/admin/promos', { token: partner.token, body: { code: 'RAW10', percent: 10 }, expect: 201 });
    assert.equal(own.creator, 'abrasion');
    await call('POST', '/api/admin/promos', { token: partner.token, body: { code: 'VOLE', percent: 10, productIds: [tuner.id] }, expect: 400 });
    await call('POST', '/api/promo/quote', { token: alice.token, body: { productId: tuner.id, code: 'RAW10' }, expect: 400 });
    assert.ok((await call('GET', '/api/admin/promos', { token: partner.token })).every((p) => p.creator === 'abrasion'));
    await call('GET', '/api/admin/referral', { token: partner.token, expect: 403 });
    await call('GET', '/api/admin/mailings', { token: partner.token, expect: 403 });
  });

  await step('code à -100 % : le plugin est accordé sans paiement', async () => {
    await call('POST', '/api/admin/promos', { token: admin.token, body: { code: 'CADEAU', percent: 100, productIds: [meter.id] }, expect: 201 });
    const result = await call('POST', '/api/checkout', { token: alice.token, body: { kind: 'product', id: meter.id, promo: 'CADEAU' } });
    assert.equal(result.mode, 'free');
    assert.ok(get(`SELECT id FROM licenses WHERE user_id = ? AND product_id = ? AND source = 'promo'`, alice.id, meter.id));
  });

  await step('parrainage : l\'ami invité a sa remise sur un plugin ONIRIQUE, pas sur celui d\'un partenaire', async () => {
    const me = await call('GET', '/api/me', { token: alice.token });
    assert.match(me.referral.code, /^[A-Z2-9]{7}$/);
    assert.equal(me.referral.link, `https://site.test/compte.html?ref=${me.referral.code}`);
    bob = await account('bob', null, { ref: me.referral.code.toLowerCase(), newsletter: true });
    const bobMe = await call('GET', '/api/me', { token: bob.token });
    assert.equal(bobMe.referral.sponsor, 'alice');
    assert.equal(bobMe.referral.welcomePercent, 15);
    assert.equal((await call('POST', '/api/promo/quote', { token: bob.token, body: { productId: tuner.id } })).finalCents, 3400);
    assert.equal((await call('POST', '/api/promo/quote', { token: bob.token, body: { productId: raw.id } })).finalCents, 3000);
    // Un code plus faible que la remise de bienvenue : c'est elle qui compte, et on le dit.
    await call('POST', '/api/admin/promos', { token: admin.token, body: { code: 'PETIT', percent: 5 }, expect: 201 });
    const q = await call('POST', '/api/promo/quote', { token: bob.token, body: { productId: tuner.id, code: 'PETIT' } });
    assert.equal(q.finalCents, 3400);
    assert.ok(q.note);
    await call('POST', '/api/me/referrer', { token: bob.token, body: { code: me.referral.code }, expect: 409 });
    await call('POST', '/api/me/referrer', { token: alice.token, body: { code: bobMe.referral.code }, expect: 400 });
  });

  await step('parrainage : le premier achat payé de l\'ami donne un code au parrain, une seule fois', async () => {
    await call('POST', '/api/checkout', { token: bob.token, body: { kind: 'product', id: tuner.id } });
    assert.equal(get('SELECT referral_welcome_used FROM users WHERE id = ?', bob.id).referral_welcome_used, 1);
    // Un vrai paiement (Stripe) : simulé ici par la commande et l'appel du webhook.
    run(`INSERT INTO orders (user_id, kind, ref_id, amount_cents, provider, provider_ref, created_at) VALUES (?, 'product', ?, 3400, 'stripe', 'cs_test', ?)`, bob.id, tuner.id, Date.now());
    const gifts = rewardSponsor(bob.id);
    assert.equal(gifts.length, 1);
    assert.equal(gifts[0].percent, 30);
    assert.deepEqual(rewardSponsor(bob.id), []);
    const mail = outbox.filter((m) => m.to === alice.email).at(-1);
    assert.match(mail.subject, /parrainage/i);
    assert.ok(mail.html.includes(gifts[0].code));
    const aliceMe = await call('GET', '/api/me', { token: alice.token });
    assert.equal(aliceMe.referral.converted, 1);
    assert.equal(aliceMe.referral.rewards[0].code, gifts[0].code);
    // Ce code n'est qu'à elle.
    await call('POST', '/api/promo/quote', { token: bob.token, body: { productId: tuner.id, code: gifts[0].code }, expect: 404 });
    assert.equal((await call('POST', '/api/promo/quote', { token: alice.token, body: { productId: raw.id, code: gifts[0].code }, expect: 400 })).error.includes('RAW'), true);
  });

  await step('parrainage : au palier, un plugin offert ; réglages dans le panel', async () => {
    await call('PUT', '/api/admin/referral', { token: admin.token, body: { milestone: 2, rewardPercent: 25 } });
    carol = await account('carol', null, { ref: (await call('GET', '/api/me', { token: alice.token })).referral.code });
    run(`INSERT INTO orders (user_id, kind, ref_id, amount_cents, provider, provider_ref, created_at) VALUES (?, 'product', ?, 2000, 'stripe', 'cs_test2', ?)`, carol.id, meter.id, Date.now());
    assert.deepEqual(rewardSponsor(carol.id).map((g) => g.percent), [25, 100]);
    const stats = await call('GET', '/api/admin/referral', { token: admin.token });
    assert.equal(stats.converted, 2);
    assert.equal(stats.top[0].email, alice.email);
    await call('PUT', '/api/admin/referral', { token: admin.token, body: { friendPercent: 150 }, expect: 400 });
  });

  await step('e-mails : tous mis en page, la case nouveautés, l\'envoi groupé et la désinscription', async () => {
    const welcome = outbox.find((m) => m.to === bob.email);
    assert.ok(welcome.html.includes('Valider mon adresse'));
    assert.equal((await call('GET', '/api/me', { token: bob.token })).user.newsletter, true);
    assert.equal((await call('GET', '/api/me', { token: carol.token })).user.newsletter, false);
    const info = await call('GET', '/api/admin/mailings', { token: admin.token });
    assert.equal(info.audiences.find((a) => a.id === 'newsletter').count, 1);
    const content = { subject: 'Nouveau : {prenom}, découvre METER', title: 'Salut {prenom}', text: 'Il est **sorti**.', productIds: [meter.id], promoCode: 'NOEL20', buttonLabel: 'Voir', buttonUrl: 'https://site.test/boutique.html' };
    const preview = await call('POST', '/api/admin/mailings/preview', { token: admin.token, body: content });
    assert.ok(preview.html.includes('METER') && preview.html.includes('NOEL20'));
    await call('POST', '/api/admin/mailings', { token: admin.token, body: { ...content, audience: 'all' }, expect: 400 });
    await call('POST', '/api/admin/mailings', { token: admin.token, body: { ...content, audience: 'newsletter' }, expect: 201 });
    for (let i = 0; i < 50 && !outbox.some((m) => m.subject === 'Nouveau : bob, découvre METER'); i++) await sleep(20);
    const sent = outbox.find((m) => m.subject === 'Nouveau : bob, découvre METER');
    assert.ok(sent, 'le message groupé est parti');
    assert.ok(sent.headers['List-Unsubscribe']);
    const link = sent.html.match(/href="(https:\/\/api\.test\/api\/newsletter\/unsubscribe[^"]+)"/)[1].replace(/&amp;/g, '&');
    await call('GET', link.replace('https://api.test', '').replace(/t=[^&]+/, 't=faux'), { expect: 400 });
    await call('GET', link.replace('https://api.test', ''));
    assert.equal((await call('GET', '/api/me', { token: bob.token })).user.newsletter, false);
    assert.equal(get('SELECT marketing FROM users WHERE id = ?', bob.id).marketing, -1);
    await call('POST', '/api/me/newsletter', { token: bob.token, body: { enabled: true } });
    assert.equal((await call('GET', '/api/me', { token: bob.token })).user.newsletter, true);
  });

  await step('boîte mail et charte graphique : réservées aux fondateurs ; une réponse part mise en page', async () => {
    const founder = await account('fondatrice', 'founder');
    await call('GET', '/api/admin/mailbox', { token: admin.token, expect: 403 });
    await call('GET', '/api/admin/brand-kit/info', { token: admin.token, expect: 403 });
    assert.equal((await call('GET', '/api/admin/mailbox', { token: founder.token })).enabled, false); // pas d'IMAP en test
    await call('GET', '/api/admin/brand-kit', { token: founder.token, expect: 404 });
    await call('GET', '/api/admin/knobs', { token: admin.token, expect: 403 });
    await call('GET', '/api/admin/knobs', { expect: 401 });
    assert.ok((await call('GET', '/api/admin/knobs', { token: founder.token })).includes('Les potards ONIRIQUE'));
    await call('POST', '/api/admin/mailbox/send', { token: founder.token, body: { to: 'pas une adresse', subject: 'x', text: 'y' }, expect: 400 });
    await call('POST', '/api/admin/mailbox/send', { token: founder.token, body: { to: 'client@exemple.com', subject: 'Re: votre commande', text: 'Bonjour,\n\nC\'est réglé.' } });
    const sent = outbox.find((m) => m.subject === 'Re: votre commande');
    assert.ok(sent && sent.html.includes('réglé'));
  });

  await step('acheteurs de VOCAL MINI : VOCALBOX moitié prix (pas avec un simple essai)', async () => {
    const { createLicense } = await import('../src/licensing.js');
    const mini = await call('POST', '/api/admin/products', { token: admin.token, body: { name: 'ONIRIQUE VOCAL MINI', priceCents: 4999 }, expect: 201 });
    const box = await call('POST', '/api/admin/products', { token: admin.token, body: { name: 'VOCALBOX', priceCents: 14999 }, expect: 201 });
    for (const p of [mini, box]) await call('POST', `/api/admin/products/${p.id}/versions?${new URLSearchParams({ version: '1.0.0', filename: 'P.vst3' })}`, { token: admin.token, raw: binary, expect: 201 });
    const buyer = await account('acheteur-mini');
    let q = await call('POST', '/api/promo/quote', { token: buyer.token, body: { productId: box.id } });
    assert.equal(q.finalCents, 14999, 'sans VOCAL MINI : plein tarif');
    createLicense({ productId: mini.id, userId: buyer.id, type: 'trial', expiresAt: Date.now() + 7 * 86400_000, source: 'trial' });
    q = await call('POST', '/api/promo/quote', { token: buyer.token, body: { productId: box.id } });
    assert.equal(q.finalCents, 14999, 'un essai de VOCAL MINI ne compte pas');
    createLicense({ productId: mini.id, userId: buyer.id, source: 'stripe' });
    q = await call('POST', '/api/promo/quote', { token: buyer.token, body: { productId: box.id } });
    assert.equal(q.finalCents, 7500);
    assert.equal(q.source, 'owner');
    assert.match(q.note, /VOCAL MINI/);
    q = await call('POST', '/api/promo/quote', { token: buyer.token, body: { productId: mini.id } });
    assert.equal(q.discountCents, 0, 'la remise ne vaut que pour VOCALBOX');
  });

  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  db.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows garde parfois la base ouverte un instant */ }
}
process.exit(0);
