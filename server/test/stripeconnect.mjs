// « Se connecter avec Stripe » (Stripe Connect) : le beatmaker relie son compte sans clé, l'achat passe par la plateforme
// au nom de son compte, la commande se vérifie chez Stripe, et débrancher retire l'accès.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-connect-'));
const PLATFORM = 'sk_test_' + 'p'.repeat(24), HOOK = 'whsec_' + 'c'.repeat(32);
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://api.test',
  STRIPE_CONNECT_CLIENT_ID: 'ca_test123', STRIPE_CONNECT_SECRET_KEY: PLATFORM, STRIPE_CONNECT_WEBHOOK_SECRET: HOOK });

// Stripe simulé : l'OAuth de Connect, le compte relié, les sessions de paiement créées au nom de ce compte.
const stripe = { sessions: new Map(), deauthorized: [], accounts: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://connect.stripe.com') && !u.startsWith('https://api.stripe.com')) return realFetch(url, init);
  const body = Object.fromEntries(new URLSearchParams(init.body || ''));
  const reply = (json, status = 200) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  if (u === 'https://connect.stripe.com/oauth/token') {
    assert.equal(init.headers.Authorization, `Bearer ${PLATFORM}`);
    return body.code === 'bon-code' ? reply({ stripe_user_id: 'acct_kay', livemode: false }) : reply({ error: 'invalid_grant', error_description: 'code expiré' }, 400);
  }
  if (u === 'https://connect.stripe.com/oauth/deauthorize') { stripe.deauthorized.push(body.stripe_user_id); return reply({ stripe_user_id: body.stripe_user_id }); }
  const route = u.slice('https://api.stripe.com/v1'.length), account = init.headers['Stripe-Account'] || '';
  stripe.accounts.push(account);
  if (route === '/accounts/acct_kay') return reply({ business_profile: { name: 'Kay Beats Studio' } });
  if (route === '/checkout/sessions' && init.method === 'POST') {
    const id = `cs_test_${stripe.sessions.size + 1}`;
    stripe.sessions.set(id, { id, account, amount_total: Number(body['line_items[0][price_data][unit_amount]']), currency: 'eur', payment_status: 'unpaid' });
    return reply({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
  }
  const session = stripe.sessions.get(route.split('/')[3]);
  if (route.startsWith('/checkout/sessions/') && session && session.account === account) return reply({ ...session, customer_details: { email: 'fan@test.fr', name: 'Fan' } });
  return reply({ error: { message: 'introuvable' } }, 404);
};

const { createApp } = await import('../src/app.js');
const { run, get, setSetting } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, route, { token, body, raw, headers = {}, expect = 200 } = {}) {
  const response = await fetch(base + route, {
    method, redirect: 'manual',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const isJson = response.headers.get('content-type')?.includes('json');
  const data = isJson ? await response.json() : { location: response.headers.get('location') };
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
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}
const wav = (marker) => Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.from(marker), Buffer.alloc(2000)]);
setSetting('sounds_disk_max', 1);

try {
  let beatmaker, pack, tid, share;
  await step('« Se connecter avec Stripe » : le compte est relié au retour de Stripe, sans clé', async () => {
    beatmaker = await account('kay', 'vip');
    pack = (await call('POST', '/api/me/sounds/projects', { token: beatmaker.token, body: { title: 'Pack', kind: 'pack' }, expect: 201 })).id;
    tid = (await call('POST', `/api/me/sounds/projects/${pack}/tracks?filename=Ghost%20150bpm.wav`, { token: beatmaker.token, raw: wav('x'), expect: 201 })).id;
    assert.equal((await call('GET', '/api/me/sounds/store', { token: beatmaker.token })).seller.connectAvailable, true);
    const { url } = await call('POST', '/api/me/sounds/store/stripe-connect', { token: beatmaker.token, body: { back: `#/p/${pack}` } });
    const q = new URL(url).searchParams;
    assert.deepEqual([q.get('client_id'), q.get('scope'), q.get('redirect_uri')], ['ca_test123', 'read_write', 'https://api.test/api/sounds/stripe/connect/callback']);
    // Un code refusé, un state inconnu : rien n'est relié, le beatmaker revient avec le message.
    const bad = await call('GET', `/api/sounds/stripe/connect/callback?state=inconnu&code=bon-code`, { expect: 302 });
    assert.match(decodeURIComponent(bad.location), /stripe=Connexion à Stripe expirée/);
    const ok = await call('GET', `/api/sounds/stripe/connect/callback?state=${q.get('state')}&code=bon-code`, { expect: 302 });
    assert.equal(ok.location, `https://site.test/mes-sons?stripe=ok#/p/${pack}`);
    const { seller } = await call('GET', '/api/me/sounds/store', { token: beatmaker.token });
    assert.deepEqual([seller.connected, seller.stripe.connect, seller.stripe.account, seller.stripe.sandbox], [true, true, 'Kay Beats Studio', true]);
    // Le state ne sert qu'une fois.
    assert.match(decodeURIComponent((await call('GET', `/api/sounds/stripe/connect/callback?state=${q.get('state')}&code=bon-code`, { expect: 302 })).location), /expirée/);
  });

  await step('achat : session créée au nom du compte relié, commande payée vérifiée chez Stripe', async () => {
    await call('PATCH', `/api/me/sounds/tracks/${tid}`, { token: beatmaker.token, body: { forSale: true } });
    await call('PUT', `/api/me/sounds/tracks/${tid}/files/wav?filename=Ghost.wav`, { token: beatmaker.token, raw: wav('wav') });
    await call('PUT', `/api/me/sounds/tracks/${tid}/files/mp3?filename=Ghost.mp3`, { token: beatmaker.token, raw: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(1000)]) });
    const { url } = await call('POST', '/api/me/sounds/links', { token: beatmaker.token, body: { projectId: pack }, expect: 201 });
    share = new URL(url).searchParams.get('t');
    const page = await call('POST', `/api/sounds/share/${share}`, { body: {} });
    const offer = page.tracks[0].offers[0];
    assert.ok(offer, 'une licence en vente');
    const bought = await call('POST', `/api/sounds/share/${share}/buy`, { body: { trackId: tid, licenseId: offer.id } });
    const session = [...stripe.sessions.values()].at(-1);
    assert.equal(session.account, 'acct_kay');
    assert.ok(bought.url.includes(session.id));
    const order = get('SELECT * FROM sound_orders WHERE provider_ref = ?', session.id);
    assert.equal((await call('GET', `/api/sounds/orders/${order.token}`)).status, 'pending');
    session.payment_status = 'paid';
    assert.equal((await call('GET', `/api/sounds/orders/${order.token}`)).status, 'paid');
    assert.ok(outbox.some((m) => m.to === 'fan@test.fr'));
  });

  await step('webhook des comptes connectés : signé par la plateforme, un retrait d\'accès débranche le compte', async () => {
    const send = (payload, secret = HOOK) => {
      const raw = JSON.stringify(payload), t = Math.floor(Date.now() / 1000);
      return call('POST', '/api/sounds/stripe/connect-webhook', { raw, expect: secret === HOOK ? 200 : 400,
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}` } });
    };
    await send({ type: 'account.application.deauthorized', account: 'acct_kay' }, 'whsec_' + 'z'.repeat(32));
    assert.equal((await call('GET', '/api/me/sounds/store', { token: beatmaker.token })).seller.stripe.connect, true);
    await send({ type: 'account.application.deauthorized', account: 'acct_kay' });
    assert.equal((await call('GET', '/api/me/sounds/store', { token: beatmaker.token })).seller.stripe, null);
  });

  await step('débrancher : l\'accès est retiré chez Stripe', async () => {
    const { url } = await call('POST', '/api/me/sounds/store/stripe-connect', { token: beatmaker.token, body: {} });
    await call('GET', `/api/sounds/stripe/connect/callback?state=${new URL(url).searchParams.get('state')}&code=bon-code`, { expect: 302 });
    await call('DELETE', '/api/me/sounds/store/seller?provider=stripe', { token: beatmaker.token });
    assert.deepEqual(stripe.deauthorized, ['acct_kay']);
    assert.equal((await call('GET', '/api/me/sounds/store', { token: beatmaker.token })).seller.connected, false);
  });

  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows : la base encore ouverte */ }
}
