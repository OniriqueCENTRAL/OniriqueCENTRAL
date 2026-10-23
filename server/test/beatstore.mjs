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
// PayPal en sandbox, simulé : une commande attend l'accord de l'acheteur (approved), puis le serveur l'encaisse.
const paypal = { orders: new Map(), captures: 0 };
async function paypalFake(url, init) {
  const route = new URL(url).pathname, reply = (json, status = 200) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  if (route === '/v1/oauth2/token') {
    return init.headers.Authorization === `Basic ${Buffer.from('client-paypal:secret-paypal').toString('base64')}` ? reply({ access_token: 'jeton' }) : reply({ error: 'invalid_client' }, 401);
  }
  if (route === '/v2/checkout/orders' && init.method === 'POST') {
    const body = JSON.parse(init.body), id = `PP${paypal.orders.size + 1}`;
    paypal.orders.set(id, { id, status: 'CREATED', amount: body.purchase_units[0].amount, body });
    return reply({ id, status: 'CREATED', links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] }, 201);
  }
  const o = paypal.orders.get(route.split('/')[4]);
  if (!o) return reply({ message: 'introuvable' }, 404);
  if (route.endsWith('/capture')) {
    if (o.status !== 'APPROVED') return reply({ message: 'ORDER_NOT_APPROVED' }, 422);
    paypal.captures++;
    o.status = 'COMPLETED';
  }
  return reply({ id: o.id, status: o.status, payer: { email_address: 'acheteur-paypal@test.fr', name: { given_name: 'Ache', surname: 'Teur' } },
    purchase_units: [{ payments: o.status === 'COMPLETED' ? { captures: [{ status: 'COMPLETED', amount: { value: o.amount.value, currency_code: o.amount.currency_code } }] } : {} }] });
}
// Pinterest simulé : le flux d'un profil, la page d'une épingle et ses images.
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(200)]);
function pinterestFake(url) {
  const u = String(url);
  if (u.startsWith('https://i.pinimg.com/')) return new Response(PNG, { status: 200 });
  if (u === 'https://www.pinterest.com/kaybeats/feed.rss') {
    return new Response(`<rss><channel><item><link>https://www.pinterest.com/pin/1/</link><description>&lt;img src="https://i.pinimg.com/236x/aa/bb/cc/cover1.jpg"&gt;</description></item>
      <item><link>https://www.pinterest.com/pin/2/</link><description>&lt;img src="https://i.pinimg.com/236x/aa/bb/cc/cover2.png"&gt;</description></item></channel></rss>`, { status: 200 });
  }
  if (u === 'https://www.pinterest.com/pin/77/') return new Response('<meta content="https://i.pinimg.com/originals/aa/bb/cc/pin77.jpg" data-rh="true" property="og:image"/>', { status: 200 });
  return new Response('introuvable', { status: 404 });
}
globalThis.fetch = async (url, init = {}) => {
  if (/^https:\/\/(www\.pinterest\.com|i\.pinimg\.com)\//.test(String(url))) return pinterestFake(url);
  if (String(url).startsWith('https://api-m.sandbox.paypal.com')) return paypalFake(url, init);
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
    assert.deepEqual([seller.connected, seller.stripe.sandbox, seller.stripe.webhook, seller.stripe.account, seller.paypal], [true, true, true, 'Studio Test', null]);
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
    // « Contacter le vendeur » : l'Instagram du beatmaker, réglé depuis Ventes.
    assert.equal(page.contact, null);
    await call('POST', '/api/me/profile', { token: beatmaker.token, body: { instagram: '@kay.beats' } });
    assert.equal((await call('GET', '/api/me/sounds/store', { token: beatmaker.token })).instagram, 'https://www.instagram.com/kay.beats/');
    assert.equal((await call('POST', `/api/sounds/share/${share}`, { body: {} })).contact, 'https://www.instagram.com/kay.beats/');
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

  await step('PayPal à côté de Stripe : l\'acheteur choisit ; paiement approuvé puis encaissé par le serveur, la licence est livrée', async () => {
    await call('PUT', '/api/me/sounds/store/seller', { token: beatmaker.token, body: { provider: 'paypal', clientId: 'client-paypal', secret: 'mauvais', sandbox: true }, expect: 502 });
    const seller = await call('PUT', '/api/me/sounds/store/seller', { token: beatmaker.token, body: { provider: 'paypal', clientId: 'client-paypal', secret: 'secret-paypal', sandbox: true } });
    assert.deepEqual([!!seller.stripe, seller.paypal], [true, { sandbox: true, clientId: 'client-paypal' }]);
    const page = await call('POST', `/api/sounds/share/${share}`, { body: {} });
    assert.deepEqual(page.pay, ['stripe', 'paypal']);
    const mp3Offer = page.tracks[0].offers.find((o) => o.name === 'MP3');
    // Sans choix, la carte (Stripe) ; avec PayPal choisi, la page PayPal.
    assert.match((await call('POST', `/api/sounds/share/${share}/buy`, { body: { trackId: tid, licenseId: mp3Offer.id } })).url, /checkout\.stripe\.com/);
    const { url } = await call('POST', `/api/sounds/share/${share}/buy`, { body: { trackId: tid, licenseId: mp3Offer.id, provider: 'paypal' } });
    assert.match(url, /^https:\/\/www\.sandbox\.paypal\.com\/checkoutnow\?token=PP1$/);
    const created = paypal.orders.get('PP1');
    assert.deepEqual(created.amount, { currency_code: 'EUR', value: '29.99' });
    const o = get('SELECT token FROM sound_orders WHERE provider_ref = ?', 'PP1');
    // L'acheteur revient sans avoir payé : rien n'est encaissé ni livré.
    assert.equal((await call('GET', `/api/sounds/orders/${o.token}`)).status, 'pending');
    assert.equal(paypal.captures, 0);
    created.status = 'APPROVED';
    const view = await call('GET', `/api/sounds/orders/${o.token}`);
    assert.deepEqual([view.status, view.buyerEmail, view.files.map((f) => f.kind)], ['paid', 'acheteur-paypal@test.fr', ['mp3']]);
    assert.ok((await call('GET', `/api/sounds/orders/${o.token}/files/mp3`)).equals(mp3));
    await call('GET', `/api/sounds/orders/${o.token}`);
    assert.equal(paypal.captures, 1);
    assert.ok(outbox.some((m) => m.to === 'acheteur-paypal@test.fr'));
    // Débrancher PayPal laisse Stripe ; sans aucun des deux, plus rien n'est achetable.
    const left = await call('DELETE', '/api/me/sounds/store/seller?provider=paypal', { token: beatmaker.token });
    assert.deepEqual([!!left.stripe, left.paypal], [true, null]);
    assert.deepEqual((await call('POST', `/api/sounds/share/${share}`, { body: {} })).pay, ['stripe']);
    await call('DELETE', '/api/me/sounds/store/seller', { token: beatmaker.token });
    assert.deepEqual((await call('POST', `/api/sounds/share/${share}`, { body: {} })).tracks[0].offers, []);
  });

  await step('YouTube : les prods programmées en vidéos, le modèle rempli pour chacune, une par jour', async () => {
    await call('POST', '/api/me/sounds/youtube', { token: beatmaker.token, body: { trackIds: [tid], title: 'x' }, expect: 400 });
    run(`INSERT INTO youtube_accounts (user_id, refresh_token, channel_id, channel_title, uploads, created_at) VALUES (?, 'x', 'UCx', 'Kay Beats', 'UUx', 0)`, beatmaker.id);
    const second = (await call('POST', `/api/me/sounds/projects/${pack}/tracks?filename=Nuit%2090bpm.wav`, { token: beatmaker.token, raw: wav('nuit'), expect: 201 })).id;
    await call('POST', '/api/me/sounds/youtube', { token: other.token, body: { trackIds: [tid], title: 'x' }, expect: 400 });
    await call('POST', '/api/me/sounds/youtube', { token: beatmaker.token, body: { trackIds: [tid], title: '' }, expect: 400 });
    const start = Date.now() + 3600_000;
    const made = await call('POST', '/api/me/sounds/youtube', { token: beatmaker.token, expect: 202, body: {
      trackIds: [tid, second], title: '[FREE] Type Beat - "{titre}" ({bpm} BPM) <b>', description: '{bpm} BPM · {cle}\nLicences : {lien}', tags: 'type beat, trap ,', privacy: 'unlisted', publishAt: start, every: 1 } });
    assert.equal(made.count, 2);
    const rows = made.videos.slice().sort((a, b) => a.publishAt - b.publishAt);
    assert.deepEqual(rows.map((v) => [v.title, v.status, v.privacy]), [['[FREE] Type Beat - "Ghost" (150 BPM) b', 'scheduled', 'unlisted'], ['[FREE] Type Beat - "Nuit" (90 BPM) b', 'scheduled', 'unlisted']]);
    assert.equal(rows[1].publishAt - rows[0].publishAt, 86_400_000);
    assert.match(rows[0].description, /^150 BPM · F min\nLicences : http.*\/ecoute\?t=/);
    assert.equal(get('SELECT tags FROM youtube_videos WHERE id = ?', rows[0].id).tags, 'type beat,trap');
    const left = await call('DELETE', `/api/me/sounds/youtube/${rows[1].id}`, { token: beatmaker.token });
    assert.equal(left.videos.length, 1);
  });

  await step('YouTube : un titre et une image propres à une prod ; images prises sur Pinterest', async () => {
    // Un titre écrit pour la prod remplace le modèle, et reste gardé pour la fois suivante.
    const made = await call('POST', '/api/me/sounds/youtube', { token: beatmaker.token, expect: 202,
      body: { trackIds: [tid], title: 'Modèle {titre}', titles: { [tid]: 'Mon titre ({bpm} BPM)' } } });
    assert.ok(made.videos.some((v) => v.title === 'Mon titre (150 BPM)'));
    const track = () => get('SELECT video_title, video_cover FROM sound_tracks WHERE id = ?', tid);
    assert.equal(track().video_title, 'Mon titre ({bpm} BPM)');
    // L'image de la vidéo : envoyée, refusée si ce n'est pas une image, puis prise sur Pinterest, enfin retirée.
    await call('PUT', `/api/me/sounds/tracks/${tid}/video-cover`, { token: beatmaker.token, raw: wav('pas-une-image'), headers: { 'Content-Type': 'image/png' }, expect: 400 });
    const sent = await call('PUT', `/api/me/sounds/tracks/${tid}/video-cover`, { token: beatmaker.token, raw: PNG, headers: { 'Content-Type': 'image/png' } });
    assert.match(sent.videoCover, /^\/api\/media\/.+\.png$/);
    await call('PUT', `/api/me/sounds/tracks/${tid}/video-cover`, { token: other.token, raw: PNG, headers: { 'Content-Type': 'image/png' }, expect: 404 });
    await call('POST', '/api/me/sounds/pinterest', { token: beatmaker.token, body: { source: 'https://exemple.com/kaybeats' }, expect: 400 });
    const board = await call('POST', '/api/me/sounds/pinterest', { token: beatmaker.token, body: { source: 'https://fr.pinterest.com/kaybeats/' } });
    assert.deepEqual(board.images.map((i) => i.url), ['https://i.pinimg.com/736x/aa/bb/cc/cover1.jpg', 'https://i.pinimg.com/736x/aa/bb/cc/cover2.png']);
    assert.equal((await call('GET', '/api/me/sounds/pinterest', { token: beatmaker.token })).source, 'https://fr.pinterest.com/kaybeats/');
    const pin = await call('POST', '/api/me/sounds/pinterest', { token: beatmaker.token, body: { source: 'https://www.pinterest.com/pin/77/' } });
    assert.equal(pin.images[0].url, 'https://i.pinimg.com/originals/aa/bb/cc/pin77.jpg');
    await call('POST', `/api/me/sounds/tracks/${tid}/video-cover`, { token: beatmaker.token, body: { url: 'https://evil.test/x.jpg' }, expect: 400 });
    const picked = await call('POST', `/api/me/sounds/tracks/${tid}/video-cover`, { token: beatmaker.token, body: { url: board.images[0].url } });
    assert.notEqual(picked.videoCover, sent.videoCover);
    const shown = (await call('GET', '/api/me/sounds', { token: beatmaker.token })).projects.find((x) => x.id === pack).tracks.find((x) => x.id === tid);
    assert.deepEqual([shown.videoTitle, shown.videoCover], ['Mon titre ({bpm} BPM)', picked.videoCover]);
    assert.equal((await call('DELETE', `/api/me/sounds/tracks/${tid}/video-cover`, { token: beatmaker.token })).videoCover, null);
  });

  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
