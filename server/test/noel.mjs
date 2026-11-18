// Le cadeau de Noël (noel.js) sur une base jetable : node test/noel.mjs
// VOCAL MINI offert du 25 au 31 décembre aux comptes qui ne l'ont pas pour de bon, une seule fois, et l'animation de
// l'application n'est proposée qu'à ceux qui l'ont reçu.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

Object.assign(process.env, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-noel-')), PAYMENTS_MODE: 'demo', PORT: '0',
  ADMIN_EMAIL: '', ADMIN_PASSWORD: '', FOUNDER_EMAILS: '', SMTP_HOST: 'test', MAIL_FROM: 'support@test.local' });

const { run, get, all } = await import('../src/db.js');
const { createLicense } = await import('../src/licensing.js');
const { NOEL, noelEnCours, offrirNoel, noelView } = await import('../src/noel.js');

run('INSERT INTO products (slug, name, tagline, description, price_cents, published, creator, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, 0)',
  NOEL.slug, 'ONIRIQUE VOCAL MINI', 't', 'd', 4999, 'onirique');
const mini = get('SELECT * FROM products WHERE slug = ?', NOEL.slug);
const user = (email, createdAt) => {
  run('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)', email, email, 'x', createdAt);
  return get('SELECT id FROM users WHERE email = ?', email).id;
};
const before = NOEL.debut - 86400_000, during = NOEL.debut + 3600_000, after = NOEL.fin + 3600_000;
const ancien = user('ancien@test.local', 1);
const acheteur = user('acheteur@test.local', 1);
const essai = user('essai@test.local', 1);
const tardif = user('tardif@test.local', NOEL.fin + 1000); // créé après le 31 décembre
createLicense({ productId: mini.id, userId: acheteur, source: 'stripe', note: 'Achat' });
createLicense({ productId: mini.id, userId: essai, type: 'trial', source: 'trial', expiresAt: during + 86400_000 });
const gifts = (id) => all('SELECT * FROM licenses WHERE user_id = ? AND bundle = ?', id, NOEL.id);

// Avant le 25 et après le 31 : rien.
assert.equal(noelEnCours(before), false);
assert.equal(offrirNoel(before), 0);
assert.equal(noelView(ancien, during), null);
assert.equal(offrirNoel(after), 0);

// Le 25 : l'ancien compte et celui qui n'avait qu'un essai le reçoivent, pas l'acheteur ni le compte créé après le 31.
assert.equal(offrirNoel(during), 2);
assert.equal(gifts(ancien).length, 1);
assert.equal(gifts(ancien)[0].type, 'perpetual');
assert.equal(gifts(ancien)[0].source, 'gift');
assert.equal(gifts(essai).length, 1);
assert.equal(gifts(acheteur).length, 0);
assert.equal(gifts(tardif).length, 0);

// Une seule fois : les passages suivants n'ajoutent rien.
assert.equal(offrirNoel(during), 0);
assert.equal(offrirNoel(during, ancien), 0);

// Un compte créé pendant les fêtes : reçu dès sa première ouverture.
const nouveau = user('nouveau@test.local', during);
assert.equal(offrirNoel(during, nouveau), 1);
assert.equal(gifts(nouveau).length, 1);

// L'animation : pour ceux qui l'ont reçu, jusqu'au 15 janvier.
const view = noelView(ancien, during);
assert.equal(view.slug, NOEL.slug);
assert.equal(view.priceCents, 4999);
assert.equal(view.id, NOEL.id);
assert.ok(noelView(ancien, NOEL.animationJusquA - 1000));
assert.equal(noelView(ancien, NOEL.animationJusquA + 1000), null);
assert.equal(noelView(acheteur, during), null);

console.log('noel : ok');
