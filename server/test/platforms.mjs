// Spotify, Deezer et Apple Music dans les playlists d'ONIRIQUE CLOUD, face à de fausses plateformes locales :
// node test/platforms.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// Les fausses plateformes : l'API de Deezer, celle d'iTunes, et les pages publiques de Spotify.
const spotifyState = (tracks) => Buffer.from(JSON.stringify({ entities: { items: { x: { content: { items: tracks.map((t) => ({ itemV2: { data: {
  __typename: 'Track', uri: `spotify:track:${t.id}`, name: t.name, artists: { items: [{ profile: { name: t.artist } }] },
  duration: { totalMilliseconds: 200000 }, previews: { audioPreviews: { items: [{ url: `https://p.scdn.co/mp3-preview/${t.id.toLowerCase()}` }] } },
  albumOfTrack: { coverArt: { sources: [{ width: 300, url: 'https://i.scdn.co/image/cover300' }] } },
} } })) } } } } })).toString('base64');
const SP1 = 'A123456789abcdefghijkl', SP2 = 'B123456789abcdefghijkl', SP3 = 'C123456789abcdefghijkl';
const fake = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
  const html = (body) => { res.setHeader('Content-Type', 'text/html'); res.end(body); };
  const dz = (id, title) => ({ id, title, readable: true, duration: 180, preview: `https://cdnt-preview.dzcdn.net/api/1/1/${id}.mp3`, artist: { name: 'Ninho' },
    album: { cover_medium: 'https://e-cdns-images.dzcdn.net/images/cover/a/250x250.jpg' } });
  if (url.pathname === '/search') return json({ data: [dz(11, 'Jefe'), { id: 12, title: 'Illisible', readable: false }, { id: '13; rm', title: 'Piège' }] });
  if (url.pathname === '/track/11') return json(dz(11, 'Jefe'));
  if (url.pathname === '/playlist/900') return json({ title: 'Ma playlist Deezer', picture_medium: 'https://e-cdns-images.dzcdn.net/images/playlist/b/250x250.jpg' });
  if (url.pathname === '/playlist/900/tracks') return json({ data: [dz(21, 'Un'), dz(22, 'Deux'), { id: 23, title: 'Grisé', readable: false }] });
  if (url.pathname === '/playlist/901') return json({ error: { message: 'private' } });
  if (url.pathname === '/user/555') return json({ id: 555, name: 'Nov sur Deezer' });
  if (url.pathname === '/user/555/playlists') return json({ data: [{ id: 900, title: 'Ma playlist Deezer', nb_tracks: 2, picture_medium: 'https://evil.example/c.jpg' }] });
  if (url.pathname === '/user/556') return json({ error: { message: 'no data' } });
  if (url.pathname === '/itunes/search') return json({ results: [{ wrapperType: 'track', trackId: 31, trackName: 'Solar', artistName: 'Drake',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/100x100bb.jpg', trackTimeMillis: 210000, previewUrl: 'https://audio-ssl.itunes.apple.com/p/31.m4a' }] });
  if (url.pathname === '/itunes/lookup') return json({ results: url.searchParams.get('id').split(',').filter((id) => /^\d+$/.test(id)).map((id) => ({ wrapperType: 'track',
    trackId: Number(id), trackName: `Titre ${id}`, artistName: 'Drake', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/100x100bb.jpg', previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a' })) });
  // Spotify : une playlist dont la page détaille deux titres et en liste un troisième par son seul lien.
  if (url.pathname === `/spotify/playlist/${'P'.repeat(22)}`) return html(`<meta property="og:title" content="Rap FR &amp; co"><meta property="og:image" content="https://i.scdn.co/image/pl">`
    + [SP1, SP2, SP3].map((id) => `<meta name="music:song" content="https://open.spotify.com/track/${id}">`).join('')
    + `<script id="initialState" type="text/plain">${spotifyState([{ id: SP1, name: 'Premier', artist: 'Ninho' }, { id: SP2, name: 'Deuxième', artist: 'Tiakola' }])}</script>`);
  if (url.pathname === `/spotify/track/${SP3}`) return html('<meta property="og:description" content="SDM · Album · Song · 2024">');
  if (url.pathname === '/spotify/oembed') return json({ title: 'Troisième', thumbnail_url: 'https://i.scdn.co/image/t3' });
  // Faux LRCLIB : des paroles synchronisées pour « Troisième ».
  if (url.pathname === '/lrclib/get') return url.searchParams.get('track_name') === 'Troisième' ? json({ syncedLyrics: '[00:01.00] première ligne' }) : (res.statusCode = 404, json({}));
  if (url.pathname === '/lrclib/search') return json([]);
  if (url.pathname === '/spotify/user/novmusic') return html('<meta property="og:title" content="Nov">');
  // Faux Spotify : la connexion PKCE (code « bon » → jetons), le renouvellement, le profil, les playlists et leurs pages.
  if (url.pathname === '/spaccounts/api/token') {
    let body = '';
    req.on('data', (c) => { body += c; });
    return req.on('end', () => {
      const f = new URLSearchParams(body);
      if (f.get('client_id') !== 'client-test') { res.statusCode = 400; return json({ error: 'invalid_client' }); }
      if (f.get('grant_type') === 'authorization_code' && f.get('code') === 'bon' && f.get('code_verifier') === VERIFIER && f.get('redirect_uri') === 'https://site.test/mes-sons') {
        return json({ access_token: 'acces-1', refresh_token: 'renouvelle-1', expires_in: 1 });
      }
      // Un compte hors des 5 invités : Spotify le connecte, puis refuse l'API (403).
      if (f.get('grant_type') === 'authorization_code' && f.get('code') === 'horsliste') return json({ access_token: 'acces-3', refresh_token: 'renouvelle-3', expires_in: 3600 });
      if (f.get('grant_type') === 'refresh_token' && f.get('refresh_token') === 'renouvelle-1') return json({ access_token: 'acces-2', expires_in: 3600 });
      res.statusCode = 400;
      json({ error: 'invalid_grant' });
    });
  }
  if (url.pathname.startsWith('/spapi/v1/')) {
    if (!/^Bearer acces-[123]$/.test(req.headers.authorization || '')) { res.statusCode = 401; return json({}); }
    if (req.headers.authorization === 'Bearer acces-3') { res.statusCode = 403; return json({ error: { status: 403 } }); }
    const route = url.pathname.slice(9);
    // Depuis 2026, /me ne dit plus « product » : le compte est tenté en Premium.
    if (route === '/me') return json({ id: 'nov', display_name: 'Nov' });
    if (route === '/search') return json({ tracks: { items: [{ type: 'track', id: SP1, name: url.searchParams.get('q'), duration_ms: 200000, artists: [{ name: 'Ninho' }],
      album: { images: [{ width: 300, url: 'https://i.scdn.co/image/s' }] } }] } });
    if (route === '/me/playlists') return json({ items: [{ id: 'Q'.repeat(22), name: 'Privée', items: { total: 3 }, images: [{ url: 'https://i.scdn.co/image/q' }] }, { id: 'piège', name: 'x' }] });
    if (route === `/playlists/${'Q'.repeat(22)}`) return json({ name: 'Privée', images: [{ url: 'https://i.scdn.co/image/q' }] });
    if (route === `/playlists/${'Q'.repeat(22)}/items`) {
      const t = (id, name) => ({ item: { type: 'track', id, name, duration_ms: 180000, artists: [{ name: 'Nov' }], album: { images: [{ width: 300, url: 'https://i.scdn.co/image/a' }] } } });
      // La page suivante est annoncée par une adresse absolue de la vraie API : seul son chemin est suivi.
      return url.searchParams.get('offset') === '100' ? json({ items: [t(SP3, 'Trois')], next: null })
        : json({ items: [t(SP1, 'Un'), t(SP2, 'Deux'), { track: { type: 'episode', id: 'E'.repeat(22), name: 'Podcast' } }],
          next: `https://api.spotify.com/v1/playlists/${'Q'.repeat(22)}/items?offset=100&limit=100` });
    }
    res.statusCode = 404;
    return json({});
  }
  res.statusCode = 404;
  res.end();
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
const self = `http://127.0.0.1:${fake.address().port}`;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-platforms-'));
const VERIFIER = 'v'.repeat(50);
// La clé MusicKit de l'équipe (une clé EC P-256, comme celle qu'Apple fournit en .p8).
const apple = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
fs.mkdirSync(path.join(dataDir, 'keys'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'keys', 'apple-music.p8'), apple.privateKey.export({ type: 'pkcs8', format: 'pem' }));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: 'test',
  MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test', FOUNDER_EMAILS: '',
  DEEZER_API: self, ITUNES_API: `${self}/itunes`, SPOTIFY_WEB: `${self}/spotify`,
  LRCLIB_API: `${self}/lrclib`, SPOTIFY_CLIENT_ID: 'client-test', SPOTIFY_ACCOUNTS: `${self}/spaccounts`, SPOTIFY_API: `${self}/spapi`, APPLE_TEAM_ID: 'EQUIPE1234', APPLE_MUSIC_KEY_ID: 'CLE1234567' });
const { createApp } = await import('../src/app.js');
const { db, run, get, now } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { cleanItem, previewUrl, nextPosition } = await import('../src/platforms.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, route, { token, body, expect = 200 } = {}) {
  const response = await fetch(base + route, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : {};
  assert.equal(response.status, expect, `${method} ${route} → ${response.status} ${JSON.stringify(data)}`);
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
const project = (userId, kind) => run('INSERT INTO sound_projects (user_id, title, kind, created_at) VALUES (?, ?, ?, ?)', userId, kind ? 'Ma playlist' : 'Album', kind, now()).lastInsertRowid;

let member, stranger, client, pl, album;
try {
  await step('un titre de plateforme est nettoyé : identifiant, lien refait, pochette et extrait des seules plateformes', async () => {
    assert.equal(cleanItem({ platform: 'deezer', id: '13; rm', title: 'x' }), null);
    assert.equal(cleanItem({ platform: 'tidal', id: '1', title: 'x' }), null);
    const x = cleanItem({ platform: 'spotify', id: SP1, title: '  Premier  ', cover: 'https://evil.example/c.jpg', preview: 'http://p.scdn.co/a', url: 'https://evil.example' });
    assert.deepEqual([x.title, x.cover, x.preview, x.url], ['Premier', null, null, `https://open.spotify.com/track/${SP1}`]);
    assert.equal(previewUrl('https://p.scdn.co/mp3-preview/abc'), 'https://p.scdn.co/mp3-preview/abc');
    assert.equal(previewUrl('https://p.scdn.co.evil.example/x'), null);
    assert.equal(previewUrl(`${self}/p.mp3`), null);
  });

  await step('réservé aux membres de CLOUD', async () => {
    member = await account('membre', 'vip');
    stranger = await account('autre', 'vip');
    client = await account('client');
    await call('GET', '/api/me/platforms', { token: client.token, expect: 403 });
    // Un partenaire qui a ONIRIQUE CLOUD, mais n'est pas membre ONIRIQUE : pas de Spotify pour l'instant.
    const partner = await account('partenaire', 'abrasion');
    await call('GET', '/api/me/platforms', { token: partner.token, expect: 403 });
    await call('GET', '/api/platforms/search?source=deezer&q=jefe', { token: client.token, expect: 403 });
  });

  await step('recherche sur Deezer et Apple Music ; Spotify renvoie au lien', async () => {
    const dz = await call('GET', '/api/platforms/search?source=deezer&q=jefe', { token: member.token });
    assert.deepEqual(dz.map((t) => t.id), ['11']);
    assert.equal(dz[0].preview, 'https://cdnt-preview.dzcdn.net/api/1/1/11.mp3');
    const ap = await call('GET', '/api/platforms/search?source=apple&q=solar', { token: member.token });
    assert.deepEqual([ap[0].platform, ap[0].id, ap[0].duration, ap[0].cover], ['apple', '31', 210, 'https://is1-ssl.mzstatic.com/image/600x600bb.jpg']);
    await call('GET', '/api/platforms/search?source=spotify&q=jefe', { token: member.token, expect: 404 });
  });

  await step('un lien collé : titre Deezer, playlist Deezer, playlist Spotify, titre Apple Music', async () => {
    const t = await call('POST', '/api/platforms/resolve', { token: member.token, body: { url: 'https://www.deezer.com/fr/track/11' } });
    assert.deepEqual([t.kind, t.items.length, t.items[0].title], ['track', 1, 'Jefe']);
    const p = await call('POST', '/api/platforms/resolve', { token: member.token, body: { url: 'https://www.deezer.com/fr/playlist/900' } });
    assert.deepEqual([p.kind, p.title, p.items.map((x) => x.id)], ['playlist', 'Ma playlist Deezer', ['21', '22']]);
    await call('POST', '/api/platforms/resolve', { token: member.token, body: { url: 'https://www.deezer.com/fr/playlist/901' }, expect: 404 });
    const s = await call('POST', '/api/platforms/resolve', { token: member.token, body: { url: `https://open.spotify.com/playlist/${'P'.repeat(22)}?si=abc` } });
    assert.equal(s.title, 'Rap FR & co');
    assert.deepEqual(s.items.map((x) => [x.id, x.title, !!x.preview]), [[SP1, 'Premier', true], [SP2, 'Deuxième', true], [SP3, 'Troisième', false]]);
    const a = await call('POST', '/api/platforms/resolve', { token: member.token, body: { url: 'https://music.apple.com/fr/album/x/100?i=42' } });
    assert.deepEqual([a.kind, a.items[0].id, a.items[0].title], ['track', '42', 'Titre 42']);
    await call('POST', '/api/platforms/resolve', { token: member.token, body: { url: 'https://evil.example/track/1' }, expect: 400 });
    await call('POST', '/api/platforms/resolve', { token: member.token, body: { url: 'javascript:alert(1)' }, expect: 400 });
  });

  await step('les titres s’ajoutent à une playlist, après les sons du CLOUD, et pas ailleurs', async () => {
    pl = project(member.id, 'playlist');
    album = project(member.id, '');
    const cloud = run('INSERT INTO sound_tracks (project_id, title, position, created_at) VALUES (?, ?, 0, ?)', pl, 'Mon son', now()).lastInsertRowid;
    const items = [{ platform: 'deezer', id: '11', title: 'Jefe', artist: 'Ninho' }, { platform: 'spotify', id: SP3, title: 'Troisième' }, { platform: 'deezer', id: 'nope', title: 'x' }];
    const added = await call('POST', `/api/me/sounds/projects/${pl}/platform-items`, { token: member.token, body: { items }, expect: 201 });
    assert.deepEqual(added.items.map((x) => [x.platform, x.position]), [['deezer', 1], ['spotify', 2]]);
    // Un son du CLOUD ajouté ensuite arrive après eux (sounds.js place ses titres avec nextPosition).
    assert.equal(nextPosition(pl), 3);
    await call('POST', `/api/me/sounds/projects/${album}/platform-items`, { token: member.token, body: { items }, expect: 400 });
    await call('POST', `/api/me/sounds/projects/${pl}/platform-items`, { token: stranger.token, body: { items }, expect: 404 });
    await call('POST', `/api/me/sounds/projects/${pl}/platform-items`, { token: member.token, body: { items: [] }, expect: 400 });
    // La pochette ne vient que des adresses d'images de Spotify, et seulement pour une playlist.
    await call('POST', `/api/me/sounds/projects/${pl}/platform-cover`, { token: member.token, body: { url: 'https://evil.example/c.jpg' }, expect: 400 });
    await call('POST', `/api/me/sounds/projects/${album}/platform-cover`, { token: member.token, body: { url: 'https://i.scdn.co/image/a' }, expect: 400 });
    await call('POST', `/api/me/sounds/projects/${pl}/platform-cover`, { token: stranger.token, body: { url: 'https://i.scdn.co/image/a' }, expect: 404 });
    const mine = await call('GET', '/api/me/platforms', { token: member.token });
    assert.equal(mine.items.length, 2);
    assert.deepEqual(mine.positions, { [cloud]: 0 });
    assert.equal((await call('GET', '/api/me/platforms', { token: stranger.token })).items.length, 0);

    // L'ordre mêlé : complet, sans doublon, seulement des clés de la playlist.
    const [x1, x2] = added.ids;
    // Les paroles d'un titre Spotify : celles de LRCLIB ; un titre qui n'en a pas en renvoie de vides.
    assert.equal((await call('GET', `/api/me/sounds/platform-items/${x2}/lyrics`, { token: member.token })).lyrics, '[00:01.00] première ligne');
    assert.equal((await call('GET', `/api/me/sounds/platform-items/${x1}/lyrics`, { token: member.token })).lyrics, '');
    await call('GET', `/api/me/sounds/platform-items/${x2}/lyrics`, { token: stranger.token, expect: 404 });
    await call('PUT', `/api/me/sounds/projects/${pl}/mixed-order`, { token: member.token, body: { keys: [`x${x2}`, `t${cloud}`, `x${x1}`] } });
    assert.equal(get('SELECT position FROM sound_tracks WHERE id = ?', cloud).position, 1);
    assert.equal(get('SELECT position FROM sound_platform_items WHERE id = ?', x2).position, 0);
    await call('PUT', `/api/me/sounds/projects/${pl}/mixed-order`, { token: member.token, body: { keys: [`x${x2}`, `t${cloud}`] }, expect: 400 });
    await call('PUT', `/api/me/sounds/projects/${pl}/mixed-order`, { token: member.token, body: { keys: [`x${x2}`, `x${x2}`, `x${x1}`] }, expect: 400 });

    // Un étranger ne retire rien ; l'extrait d'un titre sans extrait est cherché sur Deezer (ici, adresse locale refusée).
    await call('DELETE', `/api/me/sounds/platform-items/${x1}`, { token: stranger.token, expect: 404 });
    await call('DELETE', `/api/me/sounds/platform-items/${x1}`, { token: member.token });
    assert.equal(get('SELECT COUNT(*) AS n FROM sound_platform_items WHERE project_id = ?', pl).n, 1);
  });

  await step('l’extrait relayé : adresse signée, et seulement chez les plateformes', async () => {
    const [dz] = await call('GET', '/api/platforms/search?source=deezer&q=jefe', { token: member.token });
    const listen = new URL(dz.listen, base);
    assert.equal(listen.pathname, '/api/platforms/preview');
    assert.equal(listen.searchParams.get('u'), 'https://cdnt-preview.dzcdn.net/api/1/1/11.mp3');
    // Une autre adresse avec la même signature, une signature changée, une adresse expirée : refusées.
    const forged = new URL(listen); forged.searchParams.set('u', 'https://p.scdn.co/mp3-preview/autre');
    await call('GET', forged.pathname + forged.search, { expect: 403 });
    const bad = new URL(listen); bad.searchParams.set('s', 'x'.repeat(43));
    await call('GET', bad.pathname + bad.search, { expect: 403 });
    const old = new URL(listen); old.searchParams.set('e', '1');
    await call('GET', old.pathname + old.search, { expect: 403 });
    await call('GET', `/api/platforms/preview?u=${encodeURIComponent(`${self}/p.mp3`)}&e=9999999999999&s=${'x'.repeat(43)}`, { expect: 403 });
    // Le titre d'une playlist a son adresse d'écoute ; celle d'un autre titre ne passe pas.
    const [item] = (await call('GET', '/api/me/platforms', { token: member.token })).items;
    const own = new URL(item.listen, base);
    assert.equal(own.pathname, `/api/sounds/platform-items/${item.id}/preview`);
    await call('GET', `/api/sounds/platform-items/${item.id + 1}/preview${own.search}`, { expect: 403 });
  });

  await step('comptes liés : profil Deezer (et ses playlists), Spotify, Apple Music', async () => {
    await call('PUT', '/api/me/platforms/deezer', { token: member.token, body: { url: 'https://www.deezer.com/fr/profile/556' }, expect: 404 });
    await call('PUT', '/api/me/platforms/deezer', { token: member.token, body: { url: 'https://evil.example/profile/555' }, expect: 400 });
    const d = await call('PUT', '/api/me/platforms/deezer', { token: member.token, body: { url: 'https://www.deezer.com/fr/profile/555' } });
    assert.equal(d.name, 'Nov sur Deezer');
    const lists = await call('GET', '/api/me/platforms/deezer/playlists', { token: member.token });
    assert.deepEqual([lists[0].title, lists[0].cover, lists[0].url], ['Ma playlist Deezer', null, 'https://www.deezer.com/playlist/900']);
    await call('GET', '/api/me/platforms/deezer/playlists', { token: stranger.token, expect: 404 });
    assert.equal((await call('PUT', '/api/me/platforms/spotify', { token: member.token, body: { url: 'https://open.spotify.com/user/novmusic?si=1' } })).name, 'Nov');
    assert.equal((await call('PUT', '/api/me/platforms/apple', { token: member.token, body: { url: 'https://music.apple.com/profile/nov' } })).name, 'nov');
    await call('PUT', '/api/me/platforms/tidal', { token: member.token, body: { url: 'https://tidal.com/x' }, expect: 404 });
    assert.deepEqual((await call('GET', '/api/me/platforms', { token: member.token })).accounts.map((a) => a.platform), ['deezer', 'spotify', 'apple']);
    await call('DELETE', '/api/me/platforms/spotify', { token: member.token });
    assert.deepEqual((await call('GET', '/api/me/platforms', { token: member.token })).accounts.map((a) => a.platform), ['deezer', 'apple']);
  });

  await step('compte Spotify connecté : PKCE, jeton chiffré et renouvelé, playlists privées, playlist entière', async () => {
    const conf = await call('GET', '/api/platforms/config', { token: member.token });
    assert.deepEqual([conf.spotify.clientId, conf.spotify.redirectUri, conf.apple], ['client-test', 'https://site.test/mes-sons', true]);
    await call('POST', '/api/me/platforms/spotify/connect', { token: member.token, body: { code: 'bon', verifier: 'court' }, expect: 400 });
    await call('POST', '/api/me/platforms/spotify/connect', { token: member.token, body: { code: 'mauvais', verifier: VERIFIER }, expect: 400 });
    // Par le navigateur : le state porte le membre, le serveur garde le vérificateur ; un state inconnu ou déjà servi est refusé.
    const { url: auth } = await call('POST', '/api/me/platforms/spotify/start', { token: member.token });
    const st = new URL(auth).searchParams.get('state');
    assert.ok(st.startsWith('b.'));
    await call('POST', '/api/platforms/spotify/callback', { body: { code: 'bon', state: 'b.inconnu' }, expect: 400 });
    await call('POST', '/api/platforms/spotify/callback', { body: { code: 'mauvais', state: st }, expect: 400 });
    await call('POST', '/api/platforms/spotify/callback', { body: { code: 'bon', state: st }, expect: 400 }); // usage unique
    const refused = await call('POST', '/api/me/platforms/spotify/connect', { token: member.token, body: { code: 'horsliste', verifier: VERIFIER }, expect: 403 });
    assert.match(refused.error, /5 comptes invités/);
    const c = await call('POST', '/api/me/platforms/spotify/connect', { token: member.token, body: { code: 'bon', verifier: VERIFIER } });
    assert.deepEqual([c.name, c.premium, c.connected], ['Nov', true, true]);
    // Le jeton n'est jamais renvoyé avec les comptes, et il est chiffré dans la base.
    const acc = (await call('GET', '/api/me/platforms', { token: member.token })).accounts.find((a) => a.platform === 'spotify');
    assert.deepEqual(acc, { platform: 'spotify', url: 'https://open.spotify.com/user/nov', name: 'Nov', connected: true, premium: true });
    assert.ok(!get(`SELECT token FROM sound_platform_accounts WHERE platform = 'spotify'`).token.includes('renouvelle-1'));
    // Le premier jeton expire tout de suite : le lecteur reçoit le jeton renouvelé.
    assert.equal((await call('GET', '/api/me/platforms/spotify/token', { token: member.token })).accessToken, 'acces-2');
    await call('GET', '/api/me/platforms/spotify/token', { token: stranger.token, expect: 404 });
    assert.deepEqual((await call('GET', '/api/me/platforms/spotify/playlists', { token: member.token })).map((l) => [l.title, l.count]), [['Privée', 3]]);
    const full = await call('POST', '/api/platforms/resolve', { token: member.token, body: { url: `https://open.spotify.com/playlist/${'Q'.repeat(22)}` } });
    assert.deepEqual(full.items.map((x) => x.title), ['Un', 'Deux', 'Trois']);
    // La recherche Spotify passe par le compte connecté ; sans compte, elle est refusée.
    const found = await call('GET', '/api/platforms/search?source=spotify&q=jefe', { token: member.token });
    assert.deepEqual(found.map((x) => [x.platform, x.id, x.title, x.artist]), [['spotify', SP1, 'jefe', 'Ninho']]);
    await call('GET', '/api/platforms/search?source=spotify&q=jefe', { token: stranger.token, expect: 404 });
  });

  await step('Apple Music : jeton développeur signé ES256 avec la clé de l’équipe', async () => {
    const { token } = await call('GET', '/api/platforms/apple/token', { token: member.token });
    const [h, p, sig] = token.split('.');
    const head = JSON.parse(Buffer.from(h, 'base64url')), body = JSON.parse(Buffer.from(p, 'base64url'));
    assert.deepEqual([head.alg, head.kid, body.iss], ['ES256', 'CLE1234567', 'EQUIPE1234']);
    assert.ok(body.exp - body.iat <= 12 * 3600);
    assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: apple.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
    await call('GET', '/api/platforms/apple/token', { token: client.token, expect: 403 });
  });

  await step('une playlist supprimée emporte ses titres de plateformes', async () => {
    run('DELETE FROM sound_projects WHERE id = ?', pl);
    assert.equal(get('SELECT COUNT(*) AS n FROM sound_platform_items').n, 0);
  });
  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  fake.close();
  db.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows garde parfois la base ouverte un instant */ }
}
process.exit(0);
