// Shorts YouTube programmés, sur une base jetable et sans jamais joindre Google : node test/youtube.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-youtube-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'off', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: '',
  PUBLIC_URL: 'https://api.test', SITE_URL: 'https://site.test', FOUNDER_EMAILS: '', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret' });

const { createApp } = await import('../src/app.js');
const { run, get, db } = await import('../src/db.js');
const { publishDue } = await import('../src/youtube.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

// Google est joué ici : chaque appel est noté, et reçoit la réponse que YouTube ferait.
const realFetch = globalThis.fetch;
const google = [];
let refuse = false;
globalThis.fetch = async (url, options = {}) => {
  url = String(url);
  if (url.startsWith(base)) return realFetch(url, options);
  google.push({ url, options });
  if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'acces', refresh_token: 'durable' });
  if (url.includes('/channels')) return Response.json({ items: [{ id: 'UCabc', snippet: { title: 'Ma chaîne' }, contentDetails: { relatedPlaylists: { uploads: 'UUabc' } } }] });
  if (url.includes('playlistId=UUSHabc')) return Response.json({ items: [{ snippet: { description: 'Description d\'un ancien Short' } }] });
  if (url.includes('uploadType=resumable')) {
    return refuse ? Response.json({ error: { message: 'quota dépassé' } }, { status: 403 }) : new Response('', { headers: { location: 'https://envoi.test/session' } });
  }
  if (url === 'https://envoi.test/session') return Response.json({ id: 'VIDEO123' });
  return Response.json({}, { status: 404 });
};

async function call(method, route, { token, body, raw, expect = 200 } = {}) {
  const response = await fetch(base + route, {
    method, redirect: 'manual',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { 'Content-Type': 'video/mp4' } : body ? { 'Content-Type': 'application/json' } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  assert.equal(response.status, expect, `${method} ${route} → ${response.status}`);
  return response.status === 302 ? response.headers.get('location') : response.json();
}

async function account(name, role) {
  const { token } = await call('POST', '/api/auth/register', { body: { email: `${name}@test.local`, password: 'motdepasse1', name }, expect: 201 });
  run('UPDATE users SET role = ? WHERE email = ?', role, `${name}@test.local`);
  return token;
}

try {
  const client = await account('client', 'user');
  const staff = await account('equipe', 'founder');
  await call('GET', '/api/youtube', { token: await account('admin', 'admin'), expect: 403 });
  await call('GET', '/api/youtube', { token: client, expect: 403 });
  assert.deepEqual(await call('GET', '/api/youtube', { token: staff }), { configured: true, channel: null, videos: [], descriptions: [] });

  // Connexion : l'adresse de Google porte la demande, et le retour relie la chaîne au bon compte.
  const { url } = await call('POST', '/api/youtube/connect', { token: staff });
  const asked = new URL(url).searchParams;
  assert.equal(asked.get('redirect_uri'), 'https://api.test/api/youtube/callback');
  assert.match(await call('GET', '/api/youtube/callback?state=inconnu&code=x', { expect: 302 }), /youtube=Connexion/);
  assert.equal(await call('GET', `/api/youtube/callback?state=${asked.get('state')}&code=x`, { expect: 302 }), 'https://site.test/compte?youtube=ok');
  assert.notEqual(get('SELECT refresh_token FROM youtube_accounts').refresh_token, 'durable', 'l\'accès est chiffré en base');

  // Une vidéo envoyée attend sans date ; programmée, elle part quand son heure est passée.
  await call('POST', '/api/youtube/videos?filename=clip.txt', { token: staff, body: {}, expect: 400 });
  const video = await call('POST', '/api/youtube/videos?filename=Mon%20clip.mp4', { token: staff, raw: Buffer.from('contenu de la vidéo'), expect: 201 });
  assert.equal(video.title, 'Mon clip');
  assert.equal(video.status, 'draft');
  await call('PATCH', `/api/youtube/videos/${video.id}`, { token: client, body: { title: 'x', publishAt: null }, expect: 403 });
  await call('PATCH', `/api/youtube/videos/${video.id}`, { token: staff, body: { title: 'Titre', publishAt: Date.now() - 86_400_000 }, expect: 400 });
  const planned = await call('PATCH', `/api/youtube/videos/${video.id}`, { token: staff, body: { title: 'Titre', description: 'Ma description', publishAt: Date.now() + 3_600_000 } });
  assert.equal(planned.status, 'scheduled');

  google.length = 0;
  await publishDue();
  assert.equal(google.length, 0, 'rien ne part avant l\'heure');

  // YouTube refuse : la vidéo passe en échec avec la raison, son fichier est gardé, et elle se reprogramme.
  run('UPDATE youtube_videos SET publish_at = ? WHERE id = ?', Date.now() - 1000, video.id);
  refuse = true;
  await publishDue();
  let row = get('SELECT * FROM youtube_videos WHERE id = ?', video.id);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /quota dépassé/);
  assert.ok(fs.existsSync(path.join(dataDir, 'videos', row.stored_as)));

  refuse = false;
  await call('PATCH', `/api/youtube/videos/${video.id}`, { token: staff, body: { title: 'Titre', description: 'Ma description', publishAt: Date.now() } });
  await publishDue();
  row = get('SELECT * FROM youtube_videos WHERE id = ?', video.id);
  assert.equal(row.status, 'published');
  assert.ok(!fs.existsSync(path.join(dataDir, 'videos', row.stored_as)), 'le fichier publié n\'est plus gardé');
  const session = google.findLast((c) => c.url.includes('uploadType=resumable'));
  assert.deepEqual(JSON.parse(session.options.body).snippet, { title: 'Titre', description: 'Ma description' });
  assert.equal(google.at(-1).options.body.size, 20, 'le fichier entier est envoyé');

  // Les descriptions proposées : celles programmées ici, puis celles des Shorts de la chaîne.
  const state = await call('GET', '/api/youtube', { token: staff });
  assert.equal(state.channel, 'Ma chaîne');
  assert.equal(state.videos[0].url, 'https://www.youtube.com/shorts/VIDEO123');
  assert.deepEqual(state.descriptions, ['Ma description', 'Description d\'un ancien Short']);
  await call('PATCH', `/api/youtube/videos/${video.id}`, { token: staff, body: { title: 'Titre', publishAt: null }, expect: 409 });

  await call('DELETE', '/api/youtube/account', { token: staff });
  assert.equal((await call('GET', '/api/youtube', { token: staff })).channel, null);
  console.log('  ok  Shorts YouTube programmés');
} finally {
  server.close();
  db.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows garde parfois la base ouverte un instant */ }
}
