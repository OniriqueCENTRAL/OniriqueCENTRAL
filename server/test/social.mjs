// Réponses automatiques Instagram, sur une base jetable et sans jamais joindre Meta : node test/social.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-social-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'off', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: '',
  PUBLIC_URL: 'https://api.test', SITE_URL: 'https://site.test', FOUNDER_EMAILS: '',
  INSTAGRAM_APP_ID: '123', INSTAGRAM_APP_SECRET: 'igsecret', INSTAGRAM_VERIFY_TOKEN: 'verifie' });

const { createApp } = await import('../src/app.js');
const { run, get } = await import('../src/db.js');
const { pollComments, matches } = await import('../src/social.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

// Meta est joué ici : chaque appel est noté, et reçoit la réponse qu'Instagram ferait.
const realFetch = globalThis.fetch;
const calls = [];
let comments = [];
globalThis.fetch = async (url, options = {}) => {
  url = String(url);
  if (url.startsWith(base)) return realFetch(url, options);
  calls.push({ url, options });
  if (url === 'https://api.instagram.com/oauth/access_token') return Response.json({ access_token: 'court', user_id: 1 });
  if (url.includes('ig_exchange_token')) return Response.json({ access_token: 'long', expires_in: 5184000 });
  if (url.includes('/me?')) return Response.json({ user_id: '17841400000', username: 'onirique' });
  if (url.includes('subscribed_apps')) return Response.json({ success: true });
  if (url.includes('/me/media')) return Response.json({ data: [{ id: 'M1', caption: 'Commente LIEN', media_type: 'VIDEO', thumbnail_url: 'https://cdn.test/m1.jpg', permalink: 'https://instagram.test/p/1', timestamp: '2026-10-18T10:00:00+0000' }] });
  if (url.includes('/M1/comments')) return Response.json({ data: comments });
  if (url.includes('/replies') || url.includes('/messages')) return Response.json({ id: 'R' + calls.length });
  return Response.json({}, { status: 404 });
};

async function call(method, route, { token, body, expect = 200, headers = {}, raw } = {}) {
  const response = await fetch(base + route, {
    method, redirect: 'manual',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body || raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  assert.equal(response.status, expect, `${method} ${route} → ${response.status}`);
  if (response.status === 302) return response.headers.get('location');
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function account(name, role) {
  const { token } = await call('POST', '/api/auth/register', { body: { email: `${name}@test.local`, password: 'motdepasse1', name }, expect: 201 });
  run('UPDATE users SET role = ? WHERE email = ?', role, `${name}@test.local`);
  return token;
}
const sent = (part) => calls.filter((c) => c.url.includes(part));
const settle = () => new Promise((done) => setTimeout(done, 100));

try {
  // Les mots : sans majuscules ni accents, mots entiers, plusieurs mots possibles.
  assert.ok(matches('lien', 'LIEN !!'));
  assert.ok(matches('preset, lien', 'je veux le Présèt stp'));
  assert.ok(matches('mon lien', 'envoie MON LIEN'));
  assert.ok(!matches('lien', 'aliens'));
  assert.ok(matches('', 'nimporte quoi'));

  const founder = await account('fondateur', 'founder');
  await call('GET', '/api/social', { token: await account('client', 'user'), expect: 403 });
  await call('GET', '/api/social', { token: await account('admin', 'admin'), expect: 403 });
  let state = await call('GET', '/api/social', { token: founder });
  assert.deepEqual(state, { accounts: { instagram: { configured: true, username: null, connected: false, error: '' } }, automations: [] });
  await call('POST', '/api/social/tiktok/connect', { token: founder, expect: 404 });

  // Pas d'automation sans compte relié.
  await call('POST', '/api/social/automations', { token: founder, body: { postId: 'M1', replyText: 'ok' }, expect: 400 });

  // Connexion : le retour relie le compte au bon fondateur, et une demande ne sert qu'une fois.
  const { url } = await call('POST', '/api/social/instagram/connect', { token: founder });
  const stateParam = new URL(url).searchParams.get('state');
  assert.equal(await call('GET', `/api/social/instagram/callback?state=${stateParam}&code=abc`, { expect: 302 }), 'https://site.test/compte?social=ok');
  assert.match(await call('GET', `/api/social/instagram/callback?state=${stateParam}&code=abc`, { expect: 302 }), /expir/);
  state = await call('GET', '/api/social', { token: founder });
  assert.equal(state.accounts.instagram.username, 'onirique');
  assert.ok(!get('SELECT access_token FROM social_accounts').access_token.includes('long'), 'jeton chiffré');

  const posts = await call('GET', '/api/social/instagram/posts', { token: founder });
  assert.equal(posts[0].id, 'M1');

  const auto = await call('POST', '/api/social/automations', { token: founder, expect: 201,
    body: { postId: 'M1', keywords: 'LIEN', replyText: 'Envoyé en DM {pseudo} 🔥', dmText: 'Salut {pseudo}, le lien : https://onirique.store', postThumb: posts[0].thumb } });
  assert.equal(auto.platform, 'instagram');
  await call('POST', '/api/social/automations', { token: founder, body: { postId: 'M1' }, expect: 400 });

  // Webhook : vérification de l'adresse, puis un envoi signé.
  assert.equal(await call('GET', '/api/social/instagram/webhook?hub.mode=subscribe&hub.verify_token=verifie&hub.challenge=42'), 42);
  await call('GET', '/api/social/instagram/webhook?hub.mode=subscribe&hub.verify_token=faux&hub.challenge=42', { expect: 403 });
  const later = Math.floor(Date.now() / 1000) + 5;
  const event = (id, text, from = { id: 'U1', username: 'fan' }) => JSON.stringify({ object: 'instagram', entry: [{ id: '17841400000', time: later,
    changes: [{ field: 'comments', value: { id, text, from, media: { id: 'M1' } } }] }] });
  const sign = (raw) => 'sha256=' + crypto.createHmac('sha256', 'igsecret').update(raw).digest('hex');
  await call('POST', '/api/social/instagram/webhook', { raw: event('C1', 'LIEN stp'), headers: { 'X-Hub-Signature-256': 'sha256=faux' }, expect: 401 });
  const raw = event('C1', 'Lien stp 🙏');
  await call('POST', '/api/social/instagram/webhook', { raw, headers: { 'X-Hub-Signature-256': sign(raw) } });
  await settle();
  // La réponse sous le commentaire, puis le DM.
  const reply = sent('/C1/replies');
  assert.equal(reply.length, 1);
  assert.equal(new URLSearchParams(reply[0].options.body).get('message'), 'Envoyé en DM @fan 🔥');
  const dm = sent('/messages');
  assert.equal(dm.length, 1);
  assert.deepEqual(JSON.parse(dm[0].options.body), { recipient: { comment_id: 'C1' }, message: { text: 'Salut @fan, le lien : https://onirique.store' } });
  assert.ok(calls.indexOf(reply[0]) < calls.indexOf(dm[0]), 'la réponse avant le DM');

  // Le même commentaire relu, la même personne qui recommente, un mot absent, et son propre commentaire : rien.
  for (const [id, text, from] of [['C1', 'Lien stp 🙏'], ['C2', 'LIEN encore'], ['C3', 'trop bien'], ['C4', 'lien', { id: '17841400000', username: 'onirique' }]]) {
    const body = event(id, text, from);
    await call('POST', '/api/social/instagram/webhook', { raw: body, headers: { 'X-Hub-Signature-256': sign(body) } });
  }
  await settle();
  assert.equal(sent('/replies').length, 1);
  assert.equal(sent('/messages').length, 1);

  // Relecture : un commentaire arrivé sans webhook reçoit sa réponse ; un commentaire d'avant l'automation, non.
  comments = [
    { id: 'C9', text: 'LIEN', timestamp: new Date(Date.now() + 5000).toISOString(), username: 'autre', from: { id: 'U9', username: 'autre' } },
    { id: 'C0', text: 'lien', timestamp: '2026-01-01T10:00:00+0000', username: 'vieux', from: { id: 'U0', username: 'vieux' } },
  ];
  await pollComments();
  assert.equal(sent('/C9/replies').length, 1);
  assert.equal(sent('/C0/replies').length, 0);
  assert.equal(sent('/messages').length, 2);

  state = await call('GET', '/api/social', { token: founder });
  assert.equal(state.automations[0].sent, 2);
  assert.equal(state.automations[0].recent[0].name, 'autre');

  // Pause : plus rien ne part. Puis suppression, et déconnexion.
  await call('PATCH', `/api/social/automations/${auto.id}`, { token: founder, body: { keywords: 'lien', replyText: 'ok', dmText: '', active: false } });
  comments = [{ id: 'C10', text: 'lien', timestamp: new Date(Date.now() + 5000).toISOString(), username: 'b', from: { id: 'U10', username: 'b' } }];
  await pollComments();
  assert.equal(sent('/C10/replies').length, 0);
  await call('DELETE', `/api/social/automations/${auto.id}`, { token: founder });
  await call('DELETE', `/api/social/automations/${auto.id}`, { token: founder, expect: 404 });
  await call('DELETE', '/api/social/instagram/account', { token: founder });
  state = await call('GET', '/api/social', { token: founder });
  assert.equal(state.accounts.instagram.connected, false);
  assert.equal(state.automations.length, 0);

  console.log('Réponses automatiques : OK');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
