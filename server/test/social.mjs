// Réponses automatiques Instagram et TikTok, sur une base jetable et sans jamais joindre Meta ni TikTok : node test/social.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-social-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'off', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: '',
  PUBLIC_URL: 'https://api.test', SITE_URL: 'https://site.test', FOUNDER_EMAILS: '',
  INSTAGRAM_APP_ID: '123', INSTAGRAM_APP_SECRET: 'igsecret', INSTAGRAM_VERIFY_TOKEN: 'verifie', TIKTOK_CLIENT_KEY: 'ttkey', TIKTOK_CLIENT_SECRET: 'ttsecret' });

const { createApp } = await import('../src/app.js');
const { run, get } = await import('../src/db.js');
const { pollComments, matches } = await import('../src/social.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

// Meta et TikTok sont joués ici : chaque appel est noté, et reçoit la réponse que la plateforme ferait.
const realFetch = globalThis.fetch;
const calls = [];
let ttComments = [];
let igComments = [];
globalThis.fetch = async (url, options = {}) => {
  url = String(url);
  if (url.startsWith(base)) return realFetch(url, options);
  calls.push({ url, options });
  if (url === 'https://api.instagram.com/oauth/access_token') return Response.json({ access_token: 'court', user_id: 1 });
  if (url.includes('ig_exchange_token')) return Response.json({ access_token: 'long', expires_in: 5184000 });
  if (url.includes('/me?')) return Response.json({ user_id: '17841400000', username: 'onirique' });
  if (url.includes('subscribed_apps')) return Response.json({ success: true });
  if (url.includes('/me/media')) return Response.json({ data: [{ id: 'M1', caption: 'Commente LIEN', media_type: 'VIDEO', thumbnail_url: 'https://cdn.test/m1.jpg', permalink: 'https://instagram.test/p/1', timestamp: '2026-10-18T10:00:00+0000' }] });
  if (url.includes('/M1/comments')) return Response.json({ data: igComments });
  if (url.includes('/replies') || url.includes('/messages')) return Response.json({ id: 'R' + calls.length });
  if (url.includes('/tt_user/oauth2/token/')) return Response.json({ code: 0, data: { access_token: 'ttacces', refresh_token: 'ttdurable', open_id: 'BIZ1', expires_in: 86400 } });
  if (url.includes('/business/get/')) return Response.json({ code: 0, data: { username: 'onirique.tt' } });
  if (url.includes('/business/comment/list/')) return Response.json({ code: 0, data: { comments: ttComments, has_more: false } });
  if (url.includes('/business/comment/like/') || url.includes('/business/comment/reply/create/')) return Response.json({ code: 0, data: {} });
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
  assert.deepEqual(state.accounts.instagram, { configured: true, username: null, connected: false, error: '' });

  // Pas d'automation sans compte relié.
  await call('POST', '/api/social/automations', { token: founder, body: { platform: 'instagram', postId: 'M1', replyText: 'ok' }, expect: 400 });

  // Connexion Instagram, puis TikTok : le retour relie le compte au bon fondateur.
  for (const platform of ['instagram', 'tiktok']) {
    const { url } = await call('POST', `/api/social/${platform}/connect`, { token: founder });
    const state = new URL(url).searchParams.get('state');
    assert.equal(await call('GET', `/api/social/${platform}/callback?state=${state}&code=abc`, { expect: 302 }), `https://site.test/compte?social=${platform}%3Aok`);
    // Une demande ne sert qu'une fois.
    assert.match(await call('GET', `/api/social/${platform}/callback?state=${state}&code=abc`, { expect: 302 }), /expir/);
  }
  state = await call('GET', '/api/social', { token: founder });
  assert.equal(state.accounts.instagram.username, 'onirique');
  assert.equal(state.accounts.tiktok.username, 'onirique.tt');
  assert.ok(!get(`SELECT access_token FROM social_accounts WHERE platform = 'instagram'`).access_token.includes('long'), 'jeton chiffré');

  const posts = await call('GET', '/api/social/instagram/posts', { token: founder });
  assert.equal(posts[0].id, 'M1');

  // Instagram : réponse publique puis DM. TikTok : like puis réponse (pas de DM, même si on en envoie un).
  const ig = await call('POST', '/api/social/automations', { token: founder, expect: 201,
    body: { platform: 'instagram', postId: 'M1', keywords: 'LIEN', replyText: 'Envoyé en DM {pseudo} 🔥', dmText: 'Salut {pseudo}, le lien : https://onirique.store', postThumb: posts[0].thumb } });
  assert.equal(ig.like, false);
  const tt = await call('POST', '/api/social/automations', { token: founder, expect: 201,
    body: { platform: 'tiktok', postId: 'V1', keywords: 'preset', replyText: 'Regarde tes messages !', dmText: 'ignoré' } });
  assert.equal(tt.like, true);
  assert.equal(tt.dmText, '');
  await call('POST', '/api/social/automations', { token: founder, body: { platform: 'tiktok', postId: 'V1', replyText: 'x'.repeat(151) }, expect: 400 });

  // Webhook Instagram : vérification de l'adresse, puis un envoi signé.
  assert.equal(await call('GET', '/api/social/instagram/webhook?hub.mode=subscribe&hub.verify_token=verifie&hub.challenge=42'), 42);
  await call('GET', '/api/social/instagram/webhook?hub.mode=subscribe&hub.verify_token=faux&hub.challenge=42', { expect: 403 });
  const later = Math.floor(Date.now() / 1000) + 5;
  const event = (id, text, from = { id: 'U1', username: 'fan' }) => JSON.stringify({ object: 'instagram', entry: [{ id: '17841400000', time: later,
    changes: [{ field: 'comments', value: { id, text, from, media: { id: 'M1' } } }] }] });
  const sign = (raw) => 'sha256=' + crypto.createHmac('sha256', 'igsecret').update(raw).digest('hex');
  await call('POST', '/api/social/instagram/webhook', { raw: event('C1', 'LIEN stp'), headers: { 'X-Hub-Signature-256': 'sha256=faux' }, expect: 401 });
  const raw = event('C1', 'Lien stp 🙏');
  await call('POST', '/api/social/instagram/webhook', { raw, headers: { 'X-Hub-Signature-256': sign(raw) } });
  await new Promise((done) => setTimeout(done, 100));
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
  await new Promise((done) => setTimeout(done, 100));
  assert.equal(sent('/replies').length, 1);
  assert.equal(sent('/messages').length, 1);

  // Relecture : un commentaire Instagram arrivé sans webhook, et des commentaires TikTok (un ancien est ignoré).
  igComments = [{ id: 'C9', text: 'LIEN', timestamp: new Date(Date.now() + 5000).toISOString(), username: 'autre', from: { id: 'U9', username: 'autre' } }];
  ttComments = [
    { comment_id: 'T1', text: 'PRESET svp', user_id: 'X1', username: 'beatmaker', create_time: later },
    { comment_id: 'T0', text: 'preset', user_id: 'X0', username: 'vieux', create_time: 1000 },
  ];
  await pollComments();
  assert.equal(sent('/C9/replies').length, 1);
  const like = sent('/business/comment/like/');
  assert.equal(like.length, 1);
  assert.deepEqual(JSON.parse(like[0].options.body), { business_id: 'BIZ1', comment_id: 'T1', action: 'LIKE' });
  const ttReply = sent('/business/comment/reply/create/');
  assert.equal(ttReply.length, 1);
  assert.deepEqual(JSON.parse(ttReply[0].options.body), { business_id: 'BIZ1', video_id: 'V1', comment_id: 'T1', text: 'Regarde tes messages !' });
  assert.ok(calls.indexOf(like[0]) < calls.indexOf(ttReply[0]), 'le like avant la réponse');

  state = await call('GET', '/api/social', { token: founder });
  const igState = state.automations.find((a) => a.platform === 'instagram');
  assert.equal(igState.sent, 2);
  assert.equal(igState.recent[0].name, 'autre');

  // Pause : plus rien ne part. Puis suppression, et déconnexion.
  await call('PATCH', `/api/social/automations/${tt.id}`, { token: founder, body: { keywords: 'preset', like: true, replyText: 'Regarde tes messages !', active: false } });
  ttComments = [{ comment_id: 'T2', text: 'preset', user_id: 'X2', username: 'b', create_time: later }];
  await pollComments();
  assert.equal(sent('/business/comment/reply/create/').length, 1);
  await call('DELETE', `/api/social/automations/${tt.id}`, { token: founder });
  await call('DELETE', `/api/social/automations/${tt.id}`, { token: founder, expect: 404 });
  await call('DELETE', '/api/social/tiktok/account', { token: founder });
  state = await call('GET', '/api/social', { token: founder });
  assert.equal(state.accounts.tiktok.connected, false);
  assert.equal(state.automations.length, 1);

  console.log('Réponses automatiques : OK');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
