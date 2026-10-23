// Vente des prods d'un pack (licences, Stripe Checkout, webhook signé, livraison) et listes d'adresses en CSV, sur une
// base jetable, avec un Stripe simulé : node test/beatstore.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-beatstore-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test' });

// Stripe en mode test, simulé : il garde les pages de paiement demandées et donne un secret de webhook.
const HOOK_SECRET = 'whsec_' + 'k'.repeat(32);
const stripe = { sessions: [], hooks: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).startsWith('https://api.stripe.com/v1')) return realFetch(url, init);
  const route = String(url).slice('https://api.stripe.com/v1'.length), body = Object.fromEntries(new URLSearchParams(init.body || ''));
  const reply = (json) => new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (route === '/account') return reply({ settings: { dashboard: { display_name: 'Studio Test' } } });
  if (route === '/webhook_endpoints' && init.method === 'POST') { stripe.hooks.push(body); return reply({ id: 'we_1', secret: HOOK_SECRET }); }
  if (route.startsWith('/webhook_endpoints/')) return reply({ deleted: true });
  if (route === '/checkout/sessions') {
    const session = { id: `cs_test_${stripe.sessions.length + 1}`, ...body };
    stripe.sessions.push(session);
    return reply({ id: session.id, url: `https://checkout.stripe.com/c/pay/${session.id}` });
  }
  return new Response('{}', { status: 404 });
};

const { createApp } = await import('../src/app.js');
const { run, get, setSetting } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, route, { token, body, raw, headers = {}, expect = 200 } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}), ...headers,
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

async function account(name, role) {
  const email = `${name}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  const link = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await call('POST', '/api/auth/verify', { body: { token: link } });
  if (role) run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}

const wav = (marker) => Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.from(marker), Buffer.alloc(2000)]);
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.from('mp3-livre'), Buffer.alloc(1000)]);
const zip = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.from('stems'), Buffer.alloc(1000)]);
const signed = (payload, secret = HOOK_SECRET, t = Math.floor(Date.now() / 1000)) => {
  const raw = JSON.stringify(payload);
  return { raw, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}` } };
};
const hook = (seller, payload, opts, expect = 200) => {
  const { raw, headers } = signed(payload, ...(opts || []));
  return call('POST', `/api/sounds/stripe/webhook/${seller}`, { raw, headers, expect });
};
setSetting('sounds_disk_max', 1);

let beatmaker, other, pack, tid, share, order;
try {
  await step('listes d\'adresses : import d\'un CSV, une adresse une fois, réservées à leur compte', async () => {
    beatmaker = await account('beatmaker', 'vip');
    other = await account('autre', 'vip');
    const csv = 'Nom;E-mail;Ville\n"Dupont, Jean";Jean.Dupont@Mail.fr;Paris\nAmi;ami@test.fr;\n;pas-une-adresse;Lyon\nDoublon;jean.dupont@mail.fr;\r\n';
    const list = await call('POST', '/api/me/sounds/mail-lists', { token: beatmaker.token, body: { name: 'Rappeurs', emails: csv }, expect: 201 });
    assert.deepEqual(list.emails, ['jean.dupont@mail.fr', 'ami@test.fr']);
    assert.equal(list.count, 2);
    await call('POST', '/api/me/sounds/mail-lists', { token: beatmaker.token, body: { name: 'Vide', emails: 'Nom;E-mail\n' }, expect: 400 });
    await call('GET', `/api/me/sounds/mail-lists/${list.id}`, { token: other.token, expect: 404 });
    const edited = await call('PATCH', `/api/me/sounds/mail-lists/${list.id}`, { token: beatmaker.token, body: { emails: list.emails.concat('nouveau@test.fr').join('\n') } });
    assert.equal(edited.count, 3);
    assert.deepEqual((await call('GET', '/api/me/sounds/mail-lists', { token: beatmaker.token })).map((l) => [l.name, l.count]), [['Rappeurs', 3]]);
  });

  await step('compte Stripe branché avec son webhook ; licences, fichiers livrés et prix de la prod', async () => {
    pack = (await call('POST', '/api/me/sounds/projects', { token: beatmaker.token, body: { title: 'Pack', kind: 'pack' }, expect: 201 })).id;
    tid = (await call('POST', `/api/me/sounds/projects/${pack}/tracks?filename=Ghost%20150bpm%20Fmin.wav`, { token: beatmaker.token, raw: wav('ecoute'), expect: 201 })).id;
    await call('PUT', '/api/me/sounds/store/seller', { token: beatmaker.token, body: { provider: 'stripe', secret: 'sk_live_court' }, expect: 400 });
    const seller = await call('PUT', '/api/me/sounds/store/seller', { token: beatmaker.token, body: { provider: 'stripe', secret: 'sk_test_' + 'x'.repeat(24) } });
    assert.deepEqual([seller.connected, seller.sandbox, seller.webhook, seller.account], [true, true, true, 'Studio Test']);
    assert.equal(stripe.hooks[0].url, `https://site.test/api/sounds/stripe/webhook/${beatmaker.id}`);
    await call('PUT', `/api/me/sounds/tracks/${tid}/files/mp3?filename=Ghost.mp3`, { token: beatmaker.token, raw: mp3 });
    await call('PUT', `/api/me/sounds/tracks/${tid}/files/wav?filename=Ghost.wav`, { token: beatmaker.token, raw: wav('wav-livre') });
    await call('PUT', `/api/me/sounds/tracks/${tid}/files/stems?filename=Ghost.zip`, { token: beatmaker.token, raw: mp3, expect: 400 });
    await call('PUT', `/api/me/sounds/tracks/${tid}/files/stems?filename=Ghost.zip`, { token: beatmaker.token, raw: zip });
    const { licenses } = await call('GET', '/api/me/sounds/store', { token: beatmaker.token });
    const byName = Object.fromEntries(licenses.map((l) => [l.name, l]));
    await call('PATCH', `/api/me/sounds/tracks/${tid}`, { token: beatmaker.token, body: { licensePrices: { [byName.WAV.id]: 50 } }, expect: 400 });
    await call('PATCH', `/api/me/sounds/tracks/${tid}`, { token: beatmaker.token, body: { forSale: true, licensePrices: { [byName.WAV.id]: 3500, [byName.Exclusive.id]: 0, 99999: 100 } } });
    const { url } = await call('POST', '/api/me/sounds/links', { token: beatmaker.token, body: { projectId: pack }, expect: 201 });
    share = new URL(url).searchParams.get('t');
    const page = await call('POST', `/api/sounds/share/${share}`, { body: {} });
    assert.deepEqual(page.tracks[0].offers.map((o) => [o.name, o.price]), [['MP3', 2999], ['WAV', 3500], ['Track stems', 9999]]);
  });

  await step('achat : page Stripe Checkout au prix de la licence choisie, rien de livré avant le webhook', async () => {
    const page = await call('POST', `/api/sounds/share/${share}`, { body: {} });
    const wavOffer = page.tracks[0].offers.find((o) => o.name === 'WAV');
    const exclusive = (await call('GET', '/api/me/sounds/store', { token: beatmaker.token })).licenses.find((l) => l.exclusive);
    await call('POST', `/api/sounds/share/${share}/buy`, { body: { trackId: tid, licenseId: exclusive.id }, expect: 400 });
    const { url } = await call('POST', `/api/sounds/share/${share}/buy`, { body: { trackId: tid, licenseId: wavOffer.id } });
    assert.equal(url, 'https://checkout.stripe.com/c/pay/cs_test_1');
    const session = stripe.sessions[0];
    assert.equal(session['line_items[0][price_data][unit_amount]'], '3500');
    order = get('SELECT * FROM sound_orders WHERE provider_ref = ?', session.id);
    // Le retour de l'acheteur sur la page d'achat ne confirme rien.
    const view = await call('GET', `/api/sounds/orders/${order.token}`);
    assert.deepEqual([view.status, view.files], ['pending', []]);
    await call('GET', `/api/sounds/orders/${order.token}/files/wav`, { expect: 403 });
    await call('GET', `/api/sounds/orders/${order.token}/licence.txt`, { expect: 403 });
  });

  await step('webhook : signature fausse, périmée ou d\'un autre compte refusée ; montant différent ignoré', async () => {
    const paid = (amount = 3500) => ({ type: 'checkout.session.completed', data: { object: { id: stripe.sessions[0].id, payment_status: 'paid', amount_total: amount, currency: 'eur', customer_details: { email: 'acheteur@test.fr', name: 'Acheteur' } } } });
    await hook(beatmaker.id, paid(), ['whsec_' + 'z'.repeat(32)], 400);
    await hook(beatmaker.id, paid(), [HOOK_SECRET, Math.floor(Date.now() / 1000) - 3600], 400);
    const { raw, headers } = signed(paid());
    await call('POST', `/api/sounds/stripe/webhook/${beatmaker.id}`, { raw: raw.replace('3500', '3501'), headers, expect: 400 });
    await hook(other.id, paid(), null, 404);
    await hook(beatmaker.id, paid(100));
    await hook(beatmaker.id, { ...paid(), data: { object: { ...paid().data.object, payment_status: 'unpaid' } } });
    assert.equal(get('SELECT status FROM sound_orders WHERE id = ?', order.id).status, 'pending');
  });

  await step('webhook signé : la commande est payée et livre le WAV et le MP3 de la licence, avec son contrat', async () => {
    const event = { type: 'checkout.session.completed', data: { object: { id: stripe.sessions[0].id, payment_status: 'paid', amount_total: 3500, currency: 'eur', customer_details: { email: 'acheteur@test.fr', name: 'Acheteur' } } } };
    await hook(beatmaker.id, event);
    await hook(beatmaker.id, event); // Stripe renvoie parfois le même événement : une seule livraison.
    assert.equal(outbox.filter((m) => m.to === 'acheteur@test.fr').length, 1);
    assert.match(outbox.find((m) => m.to === 'acheteur@test.fr').text, new RegExp(`achat\\.html\\?o=${order.token}`));
    const view = await call('GET', `/api/sounds/orders/${order.token}`);
    assert.deepEqual([view.status, view.buyerEmail, view.license.name, view.files.map((f) => f.kind)], ['paid', 'acheteur@test.fr', 'WAV', ['mp3', 'wav']]);
    const file = await call('GET', `/api/sounds/orders/${order.token}/files/wav`);
    assert.ok(file.equals(wav('wav-livre')));
    assert.ok((await call('GET', `/api/sounds/orders/${order.token}/files/mp3`)).equals(mp3));
    await call('GET', `/api/sounds/orders/${order.token}/files/stems`, { expect: 403 });
    const contract = (await call('GET', `/api/sounds/orders/${order.token}/licence.txt`)).toString('utf8');
    assert.ok(contract.includes('CONTRAT DE LICENCE « WAV »') && contract.includes('« Ghost »') && contract.includes('35'));
    const { orders } = await call('GET', '/api/me/sounds/store', { token: beatmaker.token });
    assert.deepEqual([orders[0].status, orders[0].buyerEmail], ['paid', 'acheteur@test.fr']);
  });

  await step('contrat personnalisé par le beatmaker : champs remplis à l\'achat, copié dans la commande', async () => {
    const contract = await call('PUT', '/api/me/sounds/store/contract', { token: beatmaker.token, body: {
      title: 'Licence {licence} — {beatmaker}', legalName: 'Studio Ghost SAS', contact: 'contact@ghost.fr', clauses: 'Clause maison : créditer {beatmaker} sur {prod}.\n\nSeconde clause.', footer: 'Studio Ghost', signatures: false, inconnu: 'x' } });
    assert.equal(contract.legalName, 'Studio Ghost SAS');
    assert.equal(contract.inconnu, undefined);
    const preview = await call('POST', '/api/me/sounds/store/contract/preview', { token: beatmaker.token, body: { contract: { intro: 'Pour {acheteur}.' }, terms: 'Une ligne\nDeux lignes' } });
    assert.deepEqual([preview.title.startsWith('Licence '), preview.intro, preview.licenseClauses], [true, 'Pour Prénom Nom <acheteur@exemple.fr>.', ['Une ligne', 'Deux lignes']]);
    const page = await call('POST', `/api/sounds/share/${share}`, { body: {} });
    const mp3Offer = page.tracks[0].offers.find((o) => o.name === 'MP3');
    await call('POST', `/api/sounds/share/${share}/buy`, { body: { trackId: tid, licenseId: mp3Offer.id } });
    const session = stripe.sessions.at(-1);
    await hook(beatmaker.id, { type: 'checkout.session.completed', data: { object: { id: session.id, payment_status: 'paid', amount_total: 2999, currency: 'eur', customer_details: { email: 'b@test.fr', name: 'B' } } } });
    const o = get('SELECT token FROM sound_orders WHERE provider_ref = ?', session.id);
    // Changer le modèle après l'achat ne change pas le contrat vendu.
    await call('PUT', '/api/me/sounds/store/contract', { token: beatmaker.token, body: { title: 'Autre titre' } });
    const view = await call('GET', `/api/sounds/orders/${o.token}`);
    assert.equal(view.contract.title, 'Licence MP3 — Studio Ghost SAS');
    assert.deepEqual(view.contract.generalClauses, ['Clause maison : créditer Studio Ghost SAS sur Ghost.', 'Seconde clause.']);
    assert.equal(view.contract.signatures, false);
    const text = (await call('GET', `/api/sounds/orders/${o.token}/licence.txt`)).toString('utf8');
    assert.ok(text.includes('Contact du concédant : contact@ghost.fr') && text.includes('Studio Ghost') && !text.includes('Le licencié : B'));
  });

  await step('simulation de paiement : réservée aux fondateurs, livrée sans prestataire, sans retirer une exclusive', async () => {
    const boss = await account('fondateur', 'founder');
    const page = await call('POST', `/api/sounds/share/${share}`, { token: boss.token, body: {} });
    assert.equal(page.simulate, true);
    assert.equal((await call('POST', `/api/sounds/share/${share}`, { body: {} })).simulate, false);
    const exclusive = (await call('GET', '/api/me/sounds/store', { token: beatmaker.token })).licenses.find((l) => l.exclusive);
    await call('PATCH', `/api/me/sounds/tracks/${tid}`, { token: beatmaker.token, body: { licensePrices: {} } });
    await call('POST', `/api/sounds/share/${share}/simulate`, { token: other.token, body: { trackId: tid, licenseId: exclusive.id }, expect: 403 });
    await call('POST', `/api/sounds/share/${share}/simulate`, { body: { trackId: tid, licenseId: exclusive.id }, expect: 403 });
    const sellerMails = outbox.filter((m) => m.to === 'beatmaker@test.local').length;
    const { url } = await call('POST', `/api/sounds/share/${share}/simulate`, { token: boss.token, body: { trackId: tid, licenseId: exclusive.id } });
    const view = await call('GET', `/api/sounds/orders/${new URL(url).searchParams.get('o')}`);
    assert.deepEqual([view.status, view.simulated, view.buyerEmail, view.files.map((f) => f.kind)], ['paid', true, 'fondateur@test.local', ['mp3', 'wav', 'stems']]);
    assert.ok((await call('GET', view.files[2].url)).equals(zip));
    assert.equal(get('SELECT sold FROM sound_tracks WHERE id = ?', tid).sold, 0);
    assert.equal(outbox.filter((m) => m.to === 'beatmaker@test.local').length, sellerMails);
    assert.ok(outbox.filter((m) => m.to === 'fondateur@test.local').at(-1).subject.includes('Exclusive'));
  });

  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
