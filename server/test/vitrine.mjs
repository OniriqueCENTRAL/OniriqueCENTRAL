// La vitrine des graphistes sur une base jetable, avec un Stripe simulé : node test/vitrine.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-vitrine-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: 'test',
  MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test', FOUNDER_EMAILS: 'fondateur@test.local' });

const sessions = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).startsWith('https://api.stripe.com/v1')) return realFetch(url, init);
  const route = String(url).slice('https://api.stripe.com/v1'.length), body = Object.fromEntries(new URLSearchParams(init.body || ''));
  const reply = (json, status = 200) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  if (route === '/checkout/sessions') { const s = { id: `cs_${sessions.length + 1}`, ...body }; sessions.push(s); return reply({ id: s.id, url: `https://checkout.stripe.com/${s.id}` }); }
  const s = sessions.find((x) => route === `/checkout/sessions/${x.id}`);
  return s ? reply({ id: s.id, payment_status: s.paid ? 'paid' : 'unpaid', amount_total: Number(s['line_items[0][price_data][unit_amount]']), currency: 'eur',
    customer_details: { email: 'client@test.fr', name: 'Client' } }) : reply({}, 404);
};

const { createApp } = await import('../src/app.js');
const { get, run } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { saveStripeAccount } = await import('../src/payments.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
async function call(method, route, { token, body, raw, type, expect = 200 } = {}) {
  const r = await fetch(base + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { 'Content-Type': type } : body ? { 'Content-Type': 'application/json' } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined) });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
  assert.equal(r.status, expect, `${method} ${route} → ${r.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}
let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }
async function account(name) {
  const email = `${name.toLowerCase()}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  await call('POST', '/api/auth/verify', { body: { token: outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1] } });
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}

try {
  const artist = await account('Dias'), visitor = await account('Lou');
  // Une cover de 2000 px, en dégradé (pour que le filigrane change bien les pixels).
  const cover = await sharp({ create: { width: 2000, height: 2000, channels: 3, background: '#203040' } }).png().toBuffer();
  let visual;

  await step('publier : page de profil exigée, image vérifiée, prix gardé', async () => {
    await call('POST', '/api/me/vitrine?title=Cover', { token: artist.token, raw: cover, type: 'image/png', expect: 409 });
    await call('PUT', '/api/me/profile/page', { token: artist.token, body: { handle: 'dias7am' } });
    await call('POST', '/api/me/vitrine?title=Faux', { token: artist.token, raw: Buffer.from('pas une image'), type: 'image/png', expect: 400 });
    await call('POST', '/api/me/vitrine?title=Cher&price=50', { token: artist.token, raw: cover, type: 'image/png', expect: 400 });
    await call('POST', '/api/me/vitrine?title=Cover', { raw: cover, type: 'image/png', expect: 401 });
    visual = await call('POST', '/api/me/vitrine?title=Nuit%20rouge&price=4999&unique=1', { token: artist.token, raw: cover, type: 'image/png', expect: 201 });
    assert.deepEqual([visual.title, visual.price, visual.unique, visual.forSale, visual.author.handle], ['Nuit rouge', 4999, true, false, 'dias7am']);
    assert.equal(fs.readdirSync(path.join(dataDir, 'vitrine')).length, 2); // l'original et sa copie filigranée
  });

  await step('le public ne voit que la copie filigranée et réduite, jamais l\'original', async () => {
    const list = await call('GET', '/api/vitrine');
    assert.deepEqual(list.map((v) => v.id), [visual.id]);
    assert.deepEqual((await call('GET', '/api/vitrine?u=dias7am')).map((v) => v.id), [visual.id]);
    assert.equal(JSON.stringify(list).includes(get('SELECT original FROM vitrine_visuals WHERE id = ?', visual.id).original), false);
    const shown = await call('GET', `/api/vitrine/${visual.id}/image`, { token: visitor.token });
    const meta = await sharp(shown).metadata();
    assert.deepEqual([meta.format, meta.width], ['webp', 1200]);
    const plain = await sharp(cover).resize(1200).raw().toBuffer(), marked = await sharp(shown).removeAlpha().raw().toBuffer();
    assert.notDeepEqual(marked, plain);
    // Ni l'original par son nom de fichier, ni par une commande qui n'existe pas ou n'est pas payée.
    const original = get('SELECT original FROM vitrine_visuals WHERE id = ?', visual.id).original;
    await call('GET', `/api/media/${original}`, { token: visitor.token, expect: 404 });
    await call('GET', `/api/vitrine/orders/nimporte/original`, { token: visitor.token, expect: 404 });
    await call('GET', `/api/vitrine/${visual.id}/original`, { token: visitor.token, expect: 404 });
  });

  await step('acheter : Stripe Checkout d\'ONIRIQUE, original livré une fois payé, solde du graphiste', async () => {
    await call('POST', `/api/vitrine/${visual.id}/buy`, { expect: 503 });
    saveStripeAccount('onirique', { secretKey: 'sk_live_' + 'p'.repeat(24), webhookSecret: 'whsec_' + 'k'.repeat(32) });
    assert.equal((await call('GET', `/api/vitrine/${visual.id}`)).forSale, true);
    // La marketplace : le visuel en vente, sa copie filigranée seulement ; pas un visuel sans prix.
    const free = await call('POST', '/api/me/vitrine?title=Offert', { token: artist.token, raw: cover, type: 'image/png', expect: 201 });
    const market = await call('GET', '/api/marketplace');
    assert.deepEqual(market.map((x) => [x.type, x.id, x.price, x.seller.handle]), [['visual', visual.id, 4999, 'dias7am']]);
    assert.ok(market[0].image.startsWith(`/api/vitrine/${visual.id}/image`));
    assert.deepEqual([market[0].page, market[0].unique], [`/article?v=${visual.id}`, true]);
    assert.equal(JSON.stringify(market).includes(get('SELECT original FROM vitrine_visuals WHERE id = ?', visual.id).original), false);
    await call('DELETE', `/api/me/vitrine/${free.id}`, { token: artist.token });
    const { url } = await call('POST', `/api/vitrine/${visual.id}/buy`, { token: visitor.token });
    const session = sessions.find((s) => url.endsWith(s.id)), o = get('SELECT * FROM sound_orders WHERE provider_ref = ?', session.id);
    assert.deepEqual([o.visual_id, o.amount, o.provider, session['line_items[0][price_data][unit_amount]']], [visual.id, 4999, 'onirique', '4999']);
    await call('GET', `/api/vitrine/orders/${o.token}/original`, { token: visitor.token, expect: 403 });
    assert.deepEqual((await call('GET', `/api/sounds/orders/${o.token}`)).files, []);
    session.paid = true;
    const order = await call('GET', `/api/sounds/orders/${o.token}`);
    assert.deepEqual([order.status, order.visual, order.contract, order.files.length], ['paid', true, null, 1]);
    const file = await call('GET', order.files[0].url);
    assert.ok(file.equals(cover), 'l\'acheteur reçoit l\'original tel qu\'envoyé');
    assert.ok(outbox.some((m) => m.to === 'client@test.fr' && m.text.includes(`/achat?o=${o.token}`)));
    assert.ok(outbox.some((m) => m.to === 'dias@test.local' && m.subject.startsWith('Vente')));
    // Vente unique : plus achetable.
    assert.equal((await call('GET', `/api/vitrine/${visual.id}`)).sold, true);
    await call('POST', `/api/vitrine/${visual.id}/buy`, { expect: 400 });
    const mine = await call('GET', '/api/me/vitrine', { token: artist.token });
    assert.deepEqual([mine.balance.due, mine.orders.length, mine.handle], [4999, 1, 'dias7am']);
    assert.ok((await call('POST', '/api/me/vitrine/payout-request', { token: artist.token })).askedAt);
  });

  await step('modifier et retirer : seul le graphiste ; un visuel vendu reste livrable', async () => {
    await call('PATCH', `/api/me/vitrine/${visual.id}`, { token: visitor.token, body: { price: 100 }, expect: 404 });
    await call('DELETE', `/api/me/vitrine/${visual.id}`, { token: visitor.token, expect: 404 });
    const second = await call('POST', '/api/me/vitrine?title=Esquisse', { token: artist.token, raw: cover, type: 'image/png', expect: 201 });
    assert.equal((await call('PATCH', `/api/me/vitrine/${second.id}`, { token: artist.token, body: { price: 1500, title: 'Esquisse 2' } })).price, 1500);
    await call('DELETE', `/api/me/vitrine/${second.id}`, { token: artist.token });
    await call('DELETE', `/api/me/vitrine/${visual.id}`, { token: artist.token });
    assert.deepEqual(await call('GET', '/api/vitrine'), []);
    const o = get('SELECT token FROM sound_orders WHERE visual_id = ? AND status = ?', visual.id, 'paid');
    assert.ok((await call('GET', `/api/vitrine/orders/${o.token}/original`)).equals(cover));
    assert.equal(fs.readdirSync(path.join(dataDir, 'vitrine')).length, 2); // les fichiers du visuel non vendu sont effacés
  });

  console.log(`vitrine : ${passed} étapes réussies`);
} finally {
  server.close();
  run('SELECT 1');
}
process.exit(0);
