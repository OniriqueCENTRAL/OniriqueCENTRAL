// Les soldes (soldes.js) sur une base jetable : node test/soldes.mjs
// Prix soldé au catalogue, remise appliquée au paiement sans code, la plus forte remise gagne, partenaires exclus,
// fenêtre d'annonce, et tout revient au prix normal après la date.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

Object.assign(process.env, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-soldes-')), PAYMENTS_MODE: 'demo', PORT: '0',
  ADMIN_EMAIL: '', ADMIN_PASSWORD: '', FOUNDER_EMAILS: '', SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SOLDES: '' });

const { createApp } = await import('../src/app.js');
const { run, get, setSetting } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { SOLDES, saleOf, planSaleOf, salePopup } = await import('../src/soldes.js');
const { quote } = await import('../src/promos.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, route, { token, body, expect = 200 } = {}) => {
  const r = await fetch(base + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  assert.equal(r.status, expect, `${method} ${route} → ${r.status} ${JSON.stringify(data)}`);
  return data;
};
const product = (slug, name, price, creator = 'onirique') => {
  run('INSERT INTO products (slug, name, tagline, description, price_cents, published, creator, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, 0)', slug, name, 't', 'd', price, creator);
  return get('SELECT * FROM products WHERE slug = ?', slug);
};
const vocalbox = product('vocalbox', 'ONIRIQUE VOCALBOX', 14999);
const n73 = product('onirique-n73', 'ONIRIQUE N73', 8999);
const eq = product('onirique-eq', 'ONIRIQUE EQ', 4999);
const halo = product('onirique-halo', 'ONIRIQUE HALO', 9999);
const partenaire = product('onirique-modbox', 'MODBOX D\'UN PARTENAIRE', 7999, 'relic');

// Les prix : -30 % et -20 %, arrondis au centime ; rien hors liste, rien chez un partenaire.
assert.equal(saleOf(vocalbox).priceCents, 10499);
assert.equal(saleOf(n73).priceCents, 7199);
assert.equal(saleOf(eq), null);
assert.equal(saleOf(partenaire), null);
// Après la date : plus rien.
assert.equal(saleOf(vocalbox, SOLDES.fin + 1), null);
assert.equal(salePopup(SOLDES.fin + 1), null);

// Le catalogue montre le prix soldé.
const catalog = await call('GET', '/api/catalog');
const seen = Object.fromEntries(catalog.products.map((p) => [p.slug, p]));
assert.deepEqual([seen.vocalbox.sale.percent, seen.vocalbox.sale.priceCents, seen.vocalbox.priceCents], [30, 10499, 14999]);
assert.equal(seen['onirique-eq'].sale, null);

// Au paiement : la remise s'applique sans code ; un code plus fort gagne ; un code plus faible est dit moins fort.
const { token } = await call('POST', '/api/auth/register', { body: { email: 'soldes@test.local', password: 'motdepasse1', name: 'Nov' }, expect: 201 });
const user = get('SELECT * FROM users WHERE email = ?', 'soldes@test.local');
let q = await call('POST', '/api/promo/quote', { token, body: { productId: vocalbox.id } });
assert.deepEqual([q.finalCents, q.source, q.label, q.sale.name], [10499, 'sale', '-30 %', 'Black Friday']);
run("INSERT INTO promo_codes (code, percent, active, created_at) VALUES ('FORT40', 40, 1, 0), ('FAIBLE10', 10, 1, 0)");
assert.deepEqual([quote(user, vocalbox, 'FORT40').finalCents, quote(user, vocalbox, 'FORT40').source], [8999, 'promo']);
const faible = quote(user, vocalbox, 'FAIBLE10');
assert.deepEqual([faible.finalCents, faible.source, faible.promoId], [10499, 'sale', null]);
assert.match(faible.ignored, /Black Friday \(-30 %\) est plus forte que ce code/);
assert.equal(quote(user, eq, null).finalCents, 4999);

// La fenêtre d'annonce : pendant les soldes, la leur passe avant la nouveauté réglée dans le panel.
setSetting('popup', { id: 'x', active: true, kind: 'plugin', slug: 'onirique-eclipse', text: 'ECLIPSE est sorti' });
const site = await call('GET', '/api/site');
assert.equal(site.popup.id, SOLDES.id);
assert.equal(site.popup.theme, 'black-friday');
assert.equal(site.popup.title, "Jusqu'à -30 %");
// HALO, le dernier sorti, ouvre la liste ; puis les plus fortes remises ; l'abonnement annuel ALL ACCESS la ferme.
const annuel = Number(run("INSERT INTO plans (name, interval, price_cents, active, kind) VALUES ('ALL ACCESS ONIRIQUE — annuel', 'year', 38499, 1, 'all')").lastInsertRowid);
run("INSERT INTO plans (name, interval, price_cents, active, kind) VALUES ('ALL ACCESS ONIRIQUE — mensuel', 'month', 3999, 1, 'all')");
run("INSERT INTO plans (name, interval, price_cents, active, kind) VALUES ('À LA CARTE', 'month', 999, 1, 'pick')");
const popup = (await call('GET', '/api/site')).popup;
assert.deepEqual(popup.deals.map((d) => d.slug), ['onirique-halo', 'vocalbox', 'onirique-n73', null]);
assert.deepEqual([popup.deals[3].name, popup.deals[3].href, popup.deals[3].sale.priceCents], ['ALL ACCESS ONIRIQUE, la première année', '/boutique#plans', 26949]);

// Les abonnements : -30 % la première année en annuel, les 3 premiers mois au mois ; pas la formule à la carte ; plus rien après la date.
const plans = (await call('GET', '/api/catalog')).plans;
assert.deepEqual(plans.map((p) => [p.interval, p.sale?.priceCents, p.sale?.months, p.sale?.periodText]),
  [['month', 2799, 3, 'les 3 premiers mois'], ['year', 26949, 12, 'la première année']]);
assert.equal(planSaleOf(get("SELECT * FROM plans WHERE kind = 'pick'")), null);
assert.equal(planSaleOf(get('SELECT * FROM plans WHERE id = ?', annuel), SOLDES.fin + 1), null);
// En mode démo, s'abonner pendant les soldes marche comme d'habitude.
const done = await call('POST', '/api/checkout', { token, body: { kind: 'plan', id: annuel } }).catch((e) => e);
assert.ok(done.granted || /vérifi|valid/i.test(String(done.message)), String(done.message || JSON.stringify(done)));

console.log('  ok  soldes');
server.close();
