// Le relevé automatique du Cockpit (TikTok, Spotify, radar des films), sur une base jetable et de fausses sources : node test/cockpitauto.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const DAY = 86_400_000, at = Date.parse('2026-12-02T16:30:00Z'); // 17 h 30 à Paris
// Des identifiants de vidéos TikTok dont la date est lisible (les 32 bits de poids fort = la seconde de publication).
const tiktokId = (ms) => ((BigInt(Math.floor(ms / 1000)) << 32n) + 12345n).toString();
const old = tiktokId(at - 3 * DAY), fresh = tiktokId(at - 5 * 3600_000);
const embed = (videos) => `<html><script id="__FRONTITY_CONNECT_STATE__" type="application/json">${JSON.stringify({ source: { data: { '/embed/@euhz': {
  userInfo: { uniqueId: 'euhz', followerCount: 4800, heartCount: 280000 }, videoList: videos } } } })}</script></html>`;
const videoPage = (stats) => `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { stats } } } } })}</script>`;
const calls = [];
const fake = http.createServer((req, res) => {
  calls.push(req.url);
  const send = (code, body, type = 'text/html') => { res.writeHead(code, { 'content-type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  if (req.url.startsWith('/embed/@euhz')) return send(200, embed([{ id: old, desc: 'MGL c’est juste une go', playCount: 52000 }, { id: fresh, desc: 'Nouveau', playCount: 900 }, { id: 'pas-un-id', playCount: 1 }]));
  if (req.url === `/@euhz/video/${old}`) return send(200, videoPage({ playCount: 61000, diggCount: 7000, commentCount: 120, shareCount: 900, collectCount: '1830' }));
  // La source de la page Popularité renvoie parfois son JSON encodé deux fois : c'est ce cas qui est servi ici.
  if (req.url.startsWith('/pop')) return send(200, JSON.stringify(JSON.stringify({ type: 'artist', id: '0KoKY2dWeXHbTEKf5Uwmlr', name: 'euhZ', followers: 1877, popularity: 27,
    topTracks: [{ name: 'MGL', popularity: 39, externalUrl: 'https://open.spotify.com/track/4yVEmoFQjoqVbnKk1aezu4' }] })), 'application/json');
  if (req.url.startsWith('/3/discover/movie')) return send(200, { results: new URL(req.url, 'http://x').searchParams.get('page') === '1' ? [
    { id: 1, title: 'Spider-Man : la suite', release_date: '2026-12-10', popularity: 400, genre_ids: [28, 878] },
    { id: 2, title: 'Petit film', release_date: '2027-01-20', popularity: 20, genre_ids: [99] }] : [] }, 'application/json');
  if (req.url.startsWith('/3/discover/tv')) return send(200, { results: [{ id: 9, name: 'Une série', first_air_date: '2026-12-04', popularity: 150, genre_ids: [18] }] }, 'application/json');
  if (req.url.startsWith('/3/movie/1')) return send(200, { belongs_to_collection: { name: 'Spider-Man' } }, 'application/json');
  if (req.url.startsWith('/3/movie/')) return send(200, {}, 'application/json');
  send(404, 'non');
});
await new Promise((resolve) => fake.listen(0, resolve));
const src = `http://127.0.0.1:${fake.address().port}`;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-cockpitauto-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', SMTP_HOST: 'test', MAIL_FROM: 'support@test.local',
  SITE_URL: 'https://site.test', TIKTOK_BASE: src, POPULARITY_SOURCE: src + '/pop', TMDB_TOKEN: 'k'.repeat(32), TMDB_API: src });

const { createApp } = await import('../src/app.js');
const { run, get, all } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { parseEmbed, parseVideo, scoreFilm, collectUser, collectDue, autoOf } = await import('../src/cockpitauto.js');
const { cockpitOf } = await import('../src/cockpit.js');

// ——— Les lectures de pages ———
assert.equal(parseEmbed('<html>rien</html>'), null);
const p = parseEmbed(embed([{ id: old, desc: 'a', playCount: 10 }]));
assert.equal(p.followers, 4800); assert.equal(p.videos[0].at, Math.floor((at - 3 * DAY) / 1000) * 1000, 'la date vient de l’identifiant');
assert.deepEqual(parseVideo(videoPage({ playCount: 5, diggCount: 1, commentCount: 0, shareCount: 2, collectCount: '3' })), { views: 5, likes: 1, comments: 0, shares: 2, saves: 3 });
assert.deepEqual(parseVideo('x "stats":{"diggCount":1,"playCount":50,"collectCount":"4"} y'), { views: 50, likes: 1, comments: null, shares: null, saves: 4 }, 'lecture de secours');
assert.equal(parseVideo('<html></html>'), null);
const sf = scoreFilm({ popularity: 400, saga: 'Spider-Man', genreIds: [28], day: '2026-12-10' }, 400, '2026-12-02');
assert.equal(sf.score, 100); assert.ok(sf.reasons.includes('saga : Spider-Man') && sf.reasons.some((r) => /8 jours/.test(r)));
assert.ok(scoreFilm({ popularity: 20, saga: '', genreIds: [99], day: '2027-01-20' }, 400, '2026-12-02').score < 20, 'documentaire peu attendu et lointain');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (token, method, url, body) => {
  const r = await fetch(base + '/api' + url, { method, body: body && JSON.stringify(body), headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) } });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
async function account(name, role) {
  const email = `${name}@test.local`;
  const { token } = await (await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'motdepasse1', name }) })).json();
  const link = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await fetch(base + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: link }) });
  if (role) run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}

try {
  const simple = await account('simple'), me = await account('euhz', 'founder');
  assert.equal((await call(simple.token, 'PUT', '/cockpit/settings', { tiktokHandle: 'euhz' })).status, 403);
  assert.equal((await call(me.token, 'PUT', '/cockpit/settings', { spotifyArtist: 'pas un lien' })).status, 400);
  assert.equal((await call(me.token, 'PUT', '/cockpit/settings', { tiktokHandle: 'eu hz!' })).status, 400);
  const saved = (await call(me.token, 'PUT', '/cockpit/settings', { spotifyArtist: 'https://open.spotify.com/intl-fr/artist/0KoKY2dWeXHbTEKf5Uwmlr?si=x', tiktokHandle: 'https://www.tiktok.com/@euhz' })).data;
  assert.deepEqual(saved, { spotifyArtist: '0KoKY2dWeXHbTEKf5Uwmlr', tiktokHandle: 'euhz' });

  // La légende de la vidéo cite une phrase de la banque (apostrophe typographique, sans accent près) : elle s'y rattache seule.
  const ph = (await call(me.token, 'POST', '/cockpit/phrases', { title: 'MGL', text: "c'est juste une go" })).data;
  // Une publication notée à la main 2 h après la vraie : le relevé la rattache au lieu d'en créer une autre.
  run(`INSERT INTO cockpit_posts (user_id, network, format, posted_at, created_at) VALUES (?, 'tiktok', 'Réplique → drop', ?, ?)`, me.id, at - 3 * DAY + 2 * 3600_000, at);
  const report = await collectUser(me.id, at);
  assert.equal(report.tiktok.ok, true, JSON.stringify(report.tiktok));
  assert.equal(report.tiktok.linked, 1); assert.equal(report.tiktok.added, 1, 'la vidéo du jour entre seule');
  assert.equal(report.tiktok.measured, 1, 'seule la vidéo de plus de 46 h est relevée en détail');
  assert.equal(report.spotify.ok, true);
  const posts = all('SELECT * FROM cockpit_posts WHERE user_id = ? ORDER BY posted_at', me.id);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].format, 'Réplique → drop', 'le format noté à la main reste');
  assert.equal(posts[0].phrase_id, ph.id, 'phrase reconnue dans la légende');
  assert.equal(posts[1].phrase_id, null, '« Nouveau » ne cite aucune phrase');
  assert.equal(posts[0].saves, 1830); assert.equal(posts[0].shares, 900); assert.equal(posts[0].views, 61000);
  assert.match(posts[0].url, /\/@euhz\/video\//);
  assert.equal(posts[1].saves, null); assert.equal(posts[1].views, 900);
  const aud = get('SELECT * FROM cockpit_audience WHERE user_id = ?', me.id);
  assert.equal(aud.tiktok, 4800); assert.equal(aud.spotify_followers, 1877); assert.equal(aud.spotify_popularity, 27);
  assert.equal(get('SELECT popularity FROM cockpit_tracks WHERE user_id = ?', me.id).popularity, 39);

  // Le Cockpit : une vidéo relevée seule n'est jamais « à noter », et une vidéo de moins de 48 h n'entre pas dans l'analyse.
  const c = cockpitOf(me.id, 'Europe/Paris', at);
  assert.equal(c.toFill.length, 0);
  assert.equal(c.analysis.baseline.n, 1);
  assert.equal(c.analysis.byFormat[0].shares, 15, '900 partages pour 61 000 vues');
  assert.ok(c.posts.every((x) => x.auto));

  // Un second relevé met à jour sans doublon, et ne redemande pas la page d'une vidéo relevée il y a moins de 11 h.
  calls.length = 0;
  await collectUser(me.id, at + 3600_000);
  assert.equal(all('SELECT 1 FROM cockpit_posts WHERE user_id = ?', me.id).length, 2);
  assert.ok(!calls.some((u) => u.includes('/video/')), 'pas de relevé en boucle');

  // Le planning : 5 h et 17 h (Paris), une fois chacun ; le radar se remplit.
  run('DELETE FROM settings WHERE key IN (?, ?)', 'cockpit_collect_slot', 'cockpit_films_at');
  const first = await collectDue(at);
  assert.equal(first.slot, '2026-12-02 17h'); assert.deepEqual(first.users, [me.id]);
  assert.equal(await collectDue(at + 60_000), null, 'une fois par créneau');
  assert.equal((await collectDue(Date.parse('2026-12-03T04:10:00Z'))).slot, '2026-12-03 5h');
  const auto = autoOf(me.id, at);
  assert.equal(auto.filmsReady, true);
  assert.equal(auto.films[0].title, 'Spider-Man : la suite');
  assert.ok(auto.films[0].reasons.includes('saga : Spider-Man'));
  assert.ok(auto.films.some((f) => f.kind === 'série'));
  assert.equal(auto.tracks[0].name, 'MGL');
  assert.equal(auto.settings.tiktokHandle, 'euhz');

  // « Actualiser maintenant » : six fois par heure au plus.
  for (let k = 0; k < 6; k++) assert.equal((await call(me.token, 'POST', '/cockpit/refresh')).status, 200);
  assert.equal((await call(me.token, 'POST', '/cockpit/refresh')).status, 429);

  // Une source en panne n'empêche pas les autres.
  run('UPDATE cockpit_settings SET tiktok_handle = ? WHERE user_id = ?', 'inconnu', me.id);
  const broken = await collectUser(me.id, at + 2 * DAY);
  assert.equal(broken.tiktok.ok, false); assert.equal(broken.spotify.ok, true);
  console.log('Relevé du Cockpit : tout va bien.');
} finally {
  server.close(); fake.close();
}
