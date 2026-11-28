// Le relevé automatique du Cockpit, deux fois par jour (5 h et 17 h, heure de Paris), et sur demande :
// - TikTok : la page publique d'intégration du profil (abonnés, j'aime, ~15 dernières vidéos avec leurs vues). Chaque vidéo
//   entre seule au journal (ou se rattache à la publication notée à la main à la même heure) ; à partir de 46 h, la page de
//   la vidéo donne ses enregistrements, partages, j'aime et commentaires. Pas de compte, pas de clé : des pages publiques.
// - Spotify : abonnés et score de popularité de l'artiste et de chaque titre (même source que la page Popularité). Les
//   auditeurs mensuels ne sont lisibles que dans Spotify for Artists : ils restent à noter à la main.
// - Instagram (compte relié pour les Reels) : abonnés ; les Reels publiés par CUT entrent au journal avec leurs j'aime.
// - YouTube (chaîne reliée) : abonnés ; les Shorts publiés par CUT entrent au journal avec leurs vues.
// - Le radar des films et séries (TMDB, clé posée par onirique-tmdb), noté sur 100 : intérêt du moment, saga, genre qui se
//   prête aux répliques, date proche. C'est une estimation de l'attente, pas une prévision de succès.
import { db, get, all, run, now, setting, setSetting } from './db.js';
import { HttpError, rateLimit } from './auth.js';
import { config } from './config.js';
import { testing } from './mail.js';
import { localNow } from './cut.js';
import { shift } from './cockpit.js';
import { popularity } from './popularity.js';
import { instagramAccess } from './social.js';
import { youtubeStats } from './youtube.js';

const addColumn = (table, column, type) => { if (!all(`PRAGMA table_info(${table})`).some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); };
for (const [column, type] of [['likes', 'INTEGER'], ['shares', 'INTEGER'], ['comments', 'INTEGER'], ['caption', "TEXT NOT NULL DEFAULT ''"], ['stats_at', 'INTEGER'], ['ext_id', 'TEXT']]) addColumn('cockpit_posts', column, type);
for (const column of ['spotify_followers', 'spotify_popularity', 'tiktok_likes']) addColumn('cockpit_audience', column, 'INTEGER');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS cockpit_posts_ext ON cockpit_posts (user_id, ext_id) WHERE ext_id IS NOT NULL');
db.exec(`CREATE TABLE IF NOT EXISTS cockpit_settings (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  spotify_artist TEXT,
  tiktok_handle  TEXT,
  last_run       INTEGER,
  last_report    TEXT
)`);
// La popularité Spotify de chaque titre, jour après jour (pour voir si la promo d'un titre le fait monter).
db.exec(`CREATE TABLE IF NOT EXISTS cockpit_tracks (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  track_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  popularity INTEGER NOT NULL,
  PRIMARY KEY (user_id, day, track_id)
)`);
// Les films et séries à venir (communs à tous), refaits chaque matin.
db.exec(`CREATE TABLE IF NOT EXISTS cockpit_films (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  day        TEXT NOT NULL,
  popularity REAL NOT NULL,
  genres     TEXT NOT NULL DEFAULT '',
  saga       TEXT NOT NULL DEFAULT '',
  overview   TEXT NOT NULL DEFAULT '',
  poster     TEXT NOT NULL DEFAULT '',
  score      INTEGER NOT NULL,
  reasons    TEXT NOT NULL DEFAULT '[]'
)`);

const DAY = 86_400_000, HOUR = 3_600_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, testing ? 0 : ms));
const num = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Math.max(0, Math.round(Number(x))));
const idTime = (id) => Number(BigInt(id) >> 32n) * 1000; // l'identifiant d'une vidéo TikTok contient sa date de publication
const paris = (ms) => localNow(ms, 'Europe/Paris').day;
async function page(url) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`réponse ${response.status}`);
  return response.text();
}

/** La page d'intégration d'un profil TikTok : abonnés, j'aime, dernières vidéos (id, date, légende, vues). null si illisible. */
export function parseEmbed(html) {
  const m = /<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html));
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const found = Object.values(data?.source?.data || {}).find((p) => p && p.userInfo && Array.isArray(p.videoList));
  if (!found) return null;
  return {
    followers: num(found.userInfo.followerCount), likes: num(found.userInfo.heartCount),
    videos: found.videoList.filter((v) => /^\d{15,25}$/.test(String(v?.id)) && !v.privateItem)
      .map((v) => ({ id: String(v.id), at: idTime(String(v.id)), caption: String(v.desc || '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 300), views: num(v.playCount) })),
  };
}
/** La page d'une vidéo TikTok : vues, j'aime, commentaires, partages, enregistrements. null si illisible. */
export function parseVideo(html) {
  const m = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html));
  let s = null;
  if (m) { try { const it = JSON.parse(m[1]).__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct; s = it?.statsV2 || it?.stats || null; } catch { s = null; } }
  if (!s) { const r = /"stats":(\{[^{}]*"playCount"[^{}]*\})/.exec(String(html)); if (r) { try { s = JSON.parse(r[1]); } catch { s = null; } } }
  if (!s || num(s.playCount) === null) return null;
  return { views: num(s.playCount), likes: num(s.diggCount), comments: num(s.commentCount), shares: num(s.shareCount), saves: num(s.collectCount) };
}

// Les genres qui donnent les meilleures répliques (émotion, héros, tension) : TMDB, films et séries.
const GENRES = { 16: 'animation', 28: 'action', 12: 'aventure', 18: 'drame', 10749: 'romance', 878: 'science-fiction', 14: 'fantastique', 80: 'policier',
  10759: 'action', 10765: 'science-fiction', 9648: 'mystère', 53: 'thriller' };
/** La note d'un film ou d'une série sur 100, et ses raisons. maxPopularity : la plus forte du lot. */
export function scoreFilm(film, maxPopularity, today) {
  const reasons = [];
  let score = Math.round(60 * Math.sqrt(Math.max(0, film.popularity) / Math.max(1, maxPopularity)));
  if (film.popularity >= maxPopularity * 0.5) reasons.push('très attendu');
  if (film.saga) { score += 20; reasons.push('saga : ' + film.saga); }
  const fit = [...new Set(film.genreIds.map((g) => GENRES[g]).filter(Boolean))];
  if (fit.length) { score += 10; reasons.push(fit.slice(0, 2).join(', ')); }
  const inDays = Math.round((Date.parse(film.day) - Date.parse(today)) / DAY);
  if (inDays >= -3 && inDays <= 14) { score += 10; reasons.push(inDays <= 0 ? 'sort maintenant' : `sort dans ${inDays} jour${inDays > 1 ? 's' : ''}`); }
  return { score: Math.min(100, score), reasons };
}

/** Le radar : films (sorties en France) et séries des 60 prochains jours, les plus attendus d'abord. */
export async function refreshFilms(at = now()) {
  if (!config.tmdbToken) return { ok: false, error: 'Radar automatique pas encore branché (onirique-tmdb).' };
  const bearer = config.tmdbToken.length > 60, today = paris(at), until = shift(today, 60);
  const tmdb = async (path, params = {}) => {
    const query = new URLSearchParams({ language: 'fr-FR', ...params, ...(bearer ? {} : { api_key: config.tmdbToken }) });
    const response = await fetch(`${config.tmdbApi}/3${path}?${query}`, { headers: bearer ? { Authorization: `Bearer ${config.tmdbToken}` } : {}, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`TMDB répond ${response.status}`);
    return response.json();
  };
  const films = [];
  for (const p of [1, 2]) {
    const { results = [] } = await tmdb('/discover/movie', { region: 'FR', 'release_date.gte': today, 'release_date.lte': until, with_release_type: '2|3', sort_by: 'popularity.desc', page: p });
    films.push(...results.map((r) => ({ id: 'movie:' + r.id, tmdbId: r.id, kind: 'film', title: r.title, day: r.release_date, popularity: r.popularity, genreIds: r.genre_ids || [], overview: r.overview || '', poster: r.poster_path || '' })));
  }
  const { results: series = [] } = await tmdb('/discover/tv', { 'first_air_date.gte': shift(today, -3), 'first_air_date.lte': until, sort_by: 'popularity.desc', page: 1 });
  films.push(...series.map((r) => ({ id: 'tv:' + r.id, tmdbId: r.id, kind: 'série', title: r.name, day: r.first_air_date, popularity: r.popularity, genreIds: r.genre_ids || [], overview: r.overview || '', poster: r.poster_path || '' })));
  const list = films.filter((f) => f.title && /^\d{4}-\d{2}-\d{2}$/.test(f.day || '')).sort((a, b) => b.popularity - a.popularity).slice(0, 50);
  // La saga d'un film (une suite attire le public de l'original) : demandée pour les 15 films les plus attendus.
  for (const f of list.filter((x) => x.kind === 'film').slice(0, 15)) {
    try { f.saga = (await tmdb(`/movie/${f.tmdbId}`)).belongs_to_collection?.name || ''; } catch { f.saga = ''; }
  }
  const max = Math.max(1, ...list.map((f) => f.popularity));
  db.exec('BEGIN');
  try {
    run('DELETE FROM cockpit_films');
    for (const f of list) {
      const { score, reasons } = scoreFilm({ ...f, saga: f.saga || '' }, max, today);
      run(`INSERT OR REPLACE INTO cockpit_films (id, kind, title, day, popularity, genres, saga, overview, poster, score, reasons) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        f.id, f.kind, String(f.title).slice(0, 200), f.day, f.popularity, f.genreIds.map((g) => GENRES[g]).filter(Boolean).join(', '), f.saga || '', String(f.overview).slice(0, 400), String(f.poster).slice(0, 100), score, JSON.stringify(reasons));
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  setSetting('cockpit_films_at', String(at));
  return { ok: true, count: list.length };
}

/** Une ligne d'audience du jour : seuls les chiffres relevés la remplacent (ceux notés à la main restent). */
function audience(userId, day, values) {
  run('INSERT OR IGNORE INTO cockpit_audience (user_id, day) VALUES (?, ?)', userId, day);
  for (const [column, value] of Object.entries(values)) {
    if (value != null && ['spotify_followers', 'spotify_popularity', 'tiktok', 'tiktok_likes', 'instagram', 'youtube'].includes(column)) {
      run(`UPDATE cockpit_audience SET ${column} = ? WHERE user_id = ? AND day = ?`, value, userId, day);
    }
  }
}
const plain = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/** La phrase de la banque citée dans la légende (la plus longue), si la publication n'en a pas encore. */
export function matchPhrase(userId, postId) {
  const p = get('SELECT * FROM cockpit_posts WHERE id = ?', postId);
  if (!p || p.phrase_id || !p.caption) return null;
  const caption = ` ${plain(p.caption)} `;
  const found = all('SELECT id, text FROM cockpit_phrases WHERE user_id = ?', userId).map((ph) => ({ id: ph.id, text: plain(ph.text) }))
    .filter((ph) => ph.text.length >= 8 && caption.includes(` ${ph.text} `)).sort((a, b) => b.text.length - a.text.length)[0];
  if (found) run('UPDATE cockpit_posts SET phrase_id = ? WHERE id = ?', found.id, postId);
  return found ? found.id : null;
}
/** Une publication venue d'un réseau (ext_id unique) : créée, ou rattachée à celle notée à la main dans les 12 h, ou mise à jour. */
function upsertPost(userId, network, extId, fields) {
  const known = get('SELECT * FROM cockpit_posts WHERE user_id = ? AND ext_id = ?', userId, extId);
  if (known) {
    run(`UPDATE cockpit_posts SET url = ?, caption = CASE WHEN ? != '' THEN ? ELSE caption END, views = COALESCE(?, views), likes = COALESCE(?, likes), comments = COALESCE(?, comments),
      cut_video_id = COALESCE(cut_video_id, ?) WHERE id = ?`, fields.url, fields.caption || '', fields.caption || '', fields.views ?? null, fields.likes ?? null, fields.comments ?? null, fields.cutVideoId ?? null, known.id);
    return 'updated';
  }
  const manual = get(`SELECT * FROM cockpit_posts WHERE user_id = ? AND network = ? AND ext_id IS NULL AND posted_at BETWEEN ? AND ?
    ORDER BY ABS(posted_at - ?) LIMIT 1`, userId, network, fields.at - 12 * HOUR, fields.at + 12 * HOUR, fields.at);
  if (manual) {
    run(`UPDATE cockpit_posts SET ext_id = ?, url = ?, posted_at = ?, caption = ?, views = COALESCE(?, views), likes = COALESCE(?, likes), comments = COALESCE(?, comments),
      cut_video_id = COALESCE(cut_video_id, ?) WHERE id = ?`, extId, fields.url, fields.at, fields.caption || '', fields.views ?? null, fields.likes ?? null, fields.comments ?? null, fields.cutVideoId ?? null, manual.id);
    matchPhrase(userId, manual.id);
    return 'linked';
  }
  const id = run(`INSERT INTO cockpit_posts (user_id, network, cut_video_id, url, posted_at, caption, views, likes, comments, ext_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, network, fields.cutVideoId ?? null, fields.url, fields.at, fields.caption || '', fields.views ?? null, fields.likes ?? null, fields.comments ?? null, extId, now()).lastInsertRowid;
  matchPhrase(userId, id);
  return 'added';
}

export const settingsOf = (userId) => get('SELECT * FROM cockpit_settings WHERE user_id = ?', userId) || { user_id: userId };

/** Le relevé d'un membre : chaque source à part (une source en panne n'empêche pas les autres). Rend le compte rendu. */
export async function collectUser(userId, at = now()) {
  const s = settingsOf(userId), day = paris(at), report = {};
  const attempt = async (name, fn) => { try { report[name] = { ok: true, ...(await fn()) }; } catch (error) { report[name] = { ok: false, error: String(error.message || error).slice(0, 200) }; } };
  if (s.spotify_artist) await attempt('spotify', async () => {
    const p = await popularity(`https://open.spotify.com/artist/${s.spotify_artist}`);
    audience(userId, day, { spotify_followers: p.followers, spotify_popularity: p.popularity });
    for (const t of p.tracks) {
      const id = /track\/([A-Za-z0-9]+)/.exec(t.url || '')?.[1];
      if (id) run('INSERT OR REPLACE INTO cockpit_tracks (user_id, day, track_id, name, popularity) VALUES (?, ?, ?, ?, ?)', userId, day, id, t.name, t.popularity);
    }
    return { followers: p.followers, popularity: p.popularity, tracks: p.tracks.length };
  });
  if (s.tiktok_handle) await attempt('tiktok', async () => {
    const profile = parseEmbed(await page(`${config.tiktokBase}/embed/@${encodeURIComponent(s.tiktok_handle)}`));
    if (!profile) throw new Error('page du profil illisible (TikTok a peut-être changé sa page, ou le compte est privé)');
    audience(userId, day, { tiktok: profile.followers, tiktok_likes: profile.likes });
    const counts = { added: 0, linked: 0, updated: 0 };
    for (const v of profile.videos) {
      counts[upsertPost(userId, 'tiktok', 'tiktok:' + v.id, { at: v.at, url: `https://www.tiktok.com/@${s.tiktok_handle}/video/${v.id}`, caption: v.caption, views: v.views })]++;
    }
    // Les chiffres complets (enregistrements…) à partir de 46 h, puis deux fois par jour la première semaine.
    const due = all(`SELECT * FROM cockpit_posts WHERE user_id = ? AND ext_id LIKE 'tiktok:%' AND posted_at <= ? AND posted_at >= ?
      AND (saves IS NULL OR (posted_at >= ? AND (stats_at IS NULL OR stats_at < ?))) ORDER BY posted_at DESC LIMIT 12`, userId, at - 46 * HOUR, at - 30 * DAY, at - 8 * DAY, at - 11 * HOUR);
    let measured = 0;
    for (const p of due) {
      await pause(1500);
      const stats = parseVideo(await page(`${config.tiktokBase}/@${encodeURIComponent(s.tiktok_handle)}/video/${p.ext_id.slice(7)}`).catch(() => ''));
      if (!stats) continue;
      run('UPDATE cockpit_posts SET views = ?, likes = ?, comments = ?, shares = ?, saves = ?, stats_at = ? WHERE id = ?', stats.views, stats.likes, stats.comments, stats.shares, stats.saves, at, p.id);
      measured++;
    }
    return { followers: profile.followers, ...counts, measured, due: due.length };
  });
  const ig = await instagramAccess(userId).catch(() => null);
  if (ig) await attempt('instagram', async () => {
    const q = (path, fields) => ig.call(`${ig.graph}/${path}?${new URLSearchParams({ fields, access_token: ig.token })}`);
    const me = await q('me', 'followers_count');
    audience(userId, day, { instagram: num(me.followers_count) });
    let reels = 0;
    for (const r of all(`SELECT * FROM cut_reels WHERE user_id = ? AND status = 'published' AND media_id IS NOT NULL AND publish_at >= ?`, userId, at - 30 * DAY)) {
      const m = await q(r.media_id, 'like_count,comments_count').catch(() => ({}));
      upsertPost(userId, 'instagram', 'instagram:' + r.media_id, { at: r.publish_at, url: r.permalink || '', caption: r.caption.slice(0, 300), likes: num(m.like_count), comments: num(m.comments_count), cutVideoId: r.cut_video_id });
      reels++;
    }
    return { followers: num(me.followers_count), reels };
  });
  const shorts = all(`SELECT * FROM youtube_videos WHERE user_id = ? AND status = 'published' AND youtube_id IS NOT NULL AND kind != 'beat' AND publish_at >= ?`, userId, at - 30 * DAY);
  if (get('SELECT 1 FROM youtube_accounts WHERE user_id = ?', userId)) await attempt('youtube', async () => {
    const yt = await youtubeStats(userId, shorts.map((v) => v.youtube_id));
    audience(userId, day, { youtube: yt.subscribers });
    for (const v of shorts) {
      const st = yt.videos[v.youtube_id] || {};
      upsertPost(userId, 'youtube', 'youtube:' + v.youtube_id, { at: v.publish_at, url: `https://www.youtube.com/shorts/${v.youtube_id}`, caption: v.title, views: st.views, likes: st.likes, comments: st.comments, cutVideoId: v.cut_video_id });
    }
    return { subscribers: yt.subscribers, shorts: shorts.length };
  });
  run(`INSERT INTO cockpit_settings (user_id, last_run, last_report) VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET last_run = excluded.last_run, last_report = excluded.last_report`, userId, at, JSON.stringify(report));
  return report;
}

let busy = false;
/** Vérifié chaque minute : un relevé à 5 h et un à 17 h (heure de Paris), rattrapé au démarrage s'il a été manqué. */
export async function collectDue(at = now()) {
  if (busy) return null;
  const { day, minutes } = localNow(at, 'Europe/Paris'), hour = Math.floor(minutes / 60);
  const slot = hour >= 17 ? `${day} 17h` : hour >= 5 ? `${day} 5h` : `${shift(day, -1)} 17h`;
  busy = true;
  try {
    // Le radar : refait une fois par jour (et dès que la clé vient d'être posée) ; un essai raté attend une heure.
    if (config.tmdbToken && at - Number(setting('cockpit_films_at', '0')) > 20 * HOUR && at - Number(setting('cockpit_films_try', '0')) > HOUR) {
      setSetting('cockpit_films_try', String(at));
      await refreshFilms(at).catch((error) => console.error('Radar du Cockpit :', error.message));
    }
    if (setting('cockpit_collect_slot', '') === slot) return null;
    setSetting('cockpit_collect_slot', slot);
    const done = [];
    for (const { user_id: userId } of all("SELECT s.user_id FROM cockpit_settings s JOIN users u ON u.id = s.user_id WHERE u.role IN ('vip', 'beta', 'betaf', 'admin', 'founder')")) {
      await collectUser(userId, at).catch((error) => console.error('Relevé du Cockpit :', error.message));
      done.push(userId);
    }
    return { slot, users: done };
  } finally { busy = false; }
}

/** Ce que la page montre du relevé : réglages, dernier relevé, popularité des titres, effet de la promo, radar. */
export function autoOf(userId, at = now()) {
  const s = settingsOf(userId), today = paris(at), norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const history = all('SELECT * FROM cockpit_tracks WHERE user_id = ? AND day >= ? ORDER BY day', userId, shift(today, -60));
  const byTrack = new Map();
  for (const t of history) { if (!byTrack.has(t.track_id)) byTrack.set(t.track_id, { name: t.name, points: [] }); byTrack.get(t.track_id).points.push({ day: t.day, popularity: t.popularity }); }
  const titles = all('SELECT p.title, COUNT(*) AS n FROM cockpit_posts c JOIN cockpit_phrases p ON p.id = c.phrase_id WHERE c.user_id = ? AND c.posted_at >= ? GROUP BY p.title', userId, at - 28 * DAY);
  const tracks = [...byTrack.entries()].map(([id, t]) => {
    const last = t.points.at(-1), before = [...t.points].reverse().find((x) => x.day <= shift(today, -28)) || t.points[0];
    const videos = titles.filter((x) => norm(x.title) === norm(t.name)).reduce((sum, x) => sum + x.n, 0);
    return { id, name: t.name, popularity: last.popularity, since: before.day, change: last.popularity - before.popularity, videos28: videos, points: t.points.map((x) => x.popularity) };
  }).sort((a, b) => b.popularity - a.popularity);
  const films = all('SELECT * FROM cockpit_films WHERE day >= ? ORDER BY score DESC, popularity DESC LIMIT 30', shift(today, -3)).map((f) => ({ id: f.id, kind: f.kind, title: f.title, day: f.day,
    score: f.score, reasons: JSON.parse(f.reasons), genres: f.genres, saga: f.saga, overview: f.overview, poster: f.poster ? `https://image.tmdb.org/t/p/w185${f.poster}` : null,
    followed: !!get('SELECT 1 FROM cockpit_events WHERE user_id = ? AND title = ? AND day = ?', userId, f.title, f.day) }));
  return {
    settings: { spotifyArtist: s.spotify_artist || '', tiktokHandle: s.tiktok_handle || '' },
    lastRun: s.last_run || null, report: s.last_report ? JSON.parse(s.last_report) : null, next: '5 h et 17 h (heure de Paris)',
    linked: { instagram: !!get("SELECT 1 FROM social_accounts WHERE user_id = ? AND platform IN ('instagram', 'instagram_reels')", userId), youtube: !!get('SELECT 1 FROM youtube_accounts WHERE user_id = ?', userId) },
    tracks, films, filmsReady: !!config.tmdbToken, filmsAt: Number(setting('cockpit_films_at', '')) || null,
  };
}

export function mountCockpitAuto(app, { requireUser, wrap }) {
  const member = (req, _res, next) => (['vip', 'beta', 'betaf', 'admin', 'founder'].includes(req.user.role) ? next()
    : next(new HttpError(403, 'Le Cockpit est réservé aux membres ONIRIQUE.')));
  app.get('/api/cockpit/auto', requireUser, member, (req, res) => res.json(autoOf(req.user.id)));
  // Le lien (ou l'identifiant) de l'artiste Spotify et le pseudo TikTok ; vides : la source n'est plus relevée.
  app.put('/api/cockpit/settings', requireUser, member, (req, res) => {
    const rawSpotify = String(req.body?.spotifyArtist ?? '').trim(), rawTiktok = String(req.body?.tiktokHandle ?? '').trim();
    const spotify = rawSpotify ? (/artist\/([A-Za-z0-9]{22})/.exec(rawSpotify)?.[1] || (/^[A-Za-z0-9]{22}$/.test(rawSpotify) ? rawSpotify : null)) : '';
    if (spotify === null) throw new HttpError(400, 'Colle le lien de ta page artiste Spotify (open.spotify.com/artist/…).');
    const tiktok = rawTiktok ? (/tiktok\.com\/@([A-Za-z0-9._]+)/.exec(rawTiktok)?.[1] || rawTiktok.replace(/^@/, '')) : '';
    if (tiktok && !/^[A-Za-z0-9._]{2,24}$/.test(tiktok)) throw new HttpError(400, 'Pseudo TikTok invalide (lettres, chiffres, points et _).');
    run(`INSERT INTO cockpit_settings (user_id, spotify_artist, tiktok_handle) VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET spotify_artist = excluded.spotify_artist, tiktok_handle = excluded.tiktok_handle`, req.user.id, spotify || null, tiktok || null);
    res.json({ spotifyArtist: spotify || '', tiktokHandle: tiktok || '' });
  });
  // « Actualiser maintenant » : six fois par heure au plus (les pages publiques ne doivent pas être demandées en boucle).
  app.post('/api/cockpit/refresh', requireUser, member, wrap(async (req, res) => {
    rateLimit(`cockpit-refresh:${req.user.id}`, 6, 3600_000);
    if (!get('SELECT 1 FROM cockpit_settings WHERE user_id = ?', req.user.id)) run('INSERT INTO cockpit_settings (user_id) VALUES (?)', req.user.id);
    res.json(await collectUser(req.user.id));
  }));
}
