// Les formules d'abonnement (fiches.js, retouche 3) sur une base jetable : node test/formules.mjs
// ALL ACCESS couvre tout le catalogue ONIRIQUE (nouveautés comprises), ESSENTIAL devient N73, TUNER, EQ, DOUBLEBOX, VERB,
// aussi pour un abonné ESSENTIAL déjà en cours.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

Object.assign(process.env, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-formules-')), PAYMENTS_MODE: 'demo', PORT: '0',
  ADMIN_EMAIL: '', ADMIN_PASSWORD: '', FOUNDER_EMAILS: '', SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SOLDES: 'off' });

const { run, get, all, setSetting } = await import('../src/db.js');
const { applyRetouches } = await import('../src/fiches.js');
const { entitlement, activeSubscription } = await import('../src/licensing.js');

const product = (slug, creator = 'onirique') => Number(run(`INSERT INTO products (slug, name, price_cents, creator, published, created_at)
  VALUES (?, ?, 4999, ?, 1, 0)`, slug, slug.toUpperCase(), creator).lastInsertRowid);
const ids = Object.fromEntries(['vocalbox', 'onirique-vocal-spacer', 'onirique-n73', 'tuner', 'onirique-eq', 'onirique-doublebox', 'onirique-verb']
  .map((slug) => [slug, product(slug)]));
const partner = product('relic', 'relic');
const plan = (name, list) => Number(run(`INSERT INTO plans (name, interval, price_cents, active, kind, product_ids) VALUES (?, 'month', 2499, 1, 'all', ?)`,
  name, JSON.stringify(list)).lastInsertRowid);
const essential = plan('ESSENTIAL — MENSUEL', [ids.vocalbox, ids['onirique-eq'], ids['onirique-vocal-spacer']]);
const allMonth = plan('ALL ACCES ONIRIQUE - MENSUEL', [ids.vocalbox]);
const allYear = plan('ALL ACCESS ONIRIQUE — ANNUEL', [ids.vocalbox]);
const user = (email) => Number(run(`INSERT INTO users (email, password_hash, created_at) VALUES (?, 'x', 0)`, email).lastInsertRowid);
const ancien = user('ancien@test.local');
run(`INSERT INTO subscriptions (user_id, plan_id, status, current_period_end, updated_at) VALUES (?, ?, 'active', ?, 0)`, ancien, essential, Date.now() + 86400_000);
const fan = user('fan@test.local');
run(`INSERT INTO subscriptions (user_id, plan_id, status, current_period_end, updated_at) VALUES (?, ?, 'active', ?, 0)`, fan, allMonth, Date.now() + 86400_000);

setSetting('retouches_textes', 2);
applyRetouches();

for (const id of [allMonth, allYear]) assert.equal(get('SELECT product_ids FROM plans WHERE id = ?', id).product_ids, null);
assert.deepEqual(JSON.parse(get('SELECT product_ids FROM plans WHERE id = ?', essential).product_ids),
  ['onirique-n73', 'tuner', 'onirique-eq', 'onirique-doublebox', 'onirique-verb'].map((s) => ids[s]));
// L'abonné ESSENTIAL déjà en cours passe à la nouvelle liste : N73 oui, VOCALBOX non.
assert.equal(entitlement(ancien, ids.vocalbox), null);
assert.ok(entitlement(ancien, ids['onirique-n73']));
// L'abonné ALL ACCESS a tout le catalogue ONIRIQUE, même un plugin sorti après, mais pas les partenaires.
const nouveau = product('onirique-nouveau');
assert.ok(entitlement(fan, ids['onirique-verb']));
assert.ok(entitlement(fan, nouveau));
assert.equal(entitlement(fan, partner), null);
assert.equal(activeSubscription(fan).productIds, null);
// Une seule fois : rejouer ne change rien.
run('UPDATE plans SET product_ids = ? WHERE id = ?', JSON.stringify([ids.vocalbox]), allYear);
applyRetouches();
assert.equal(get('SELECT product_ids FROM plans WHERE id = ?', allYear).product_ids, JSON.stringify([ids.vocalbox]));
assert.equal(all('SELECT * FROM plans').length, 3);
console.log('formules : ok');
