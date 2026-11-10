// Les pages de profil des membres (profil.html) : créées depuis « Mon compte » par ceux qui en veulent une, avec un
// nom d'adresse, une bio, une couleur et une bannière ; on s'y abonne (follow), on y laisse un commentaire, et on
// écrit en privé à son auteur (messages.html). Un compte sans page de profil ne reçoit pas de message.
import { db, get, all, run, now, transaction } from './db.js';
import { HttpError, rateLimit, optionalUser } from './auth.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { publicPlaylists } from './ratings.js';
import { CITY, CV_ROLES, communeById, searchPlaces } from './cities.js';

db.exec(`
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  handle     TEXT NOT NULL UNIQUE,
  bio        TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '#e5384a',
  banner     TEXT,
  comments   INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followed_id)
);
CREATE TABLE IF NOT EXISTS profile_comments (
  id         INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_messages (
  id         INTEGER PRIMARY KEY,
  from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX IF NOT EXISTS user_messages_pair ON user_messages(from_id, to_id, created_at);
CREATE INDEX IF NOT EXISTS profile_comments_page ON profile_comments(profile_id, created_at);
CREATE TABLE IF NOT EXISTS profile_comment_likes (
  comment_id INTEGER NOT NULL REFERENCES profile_comments(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);
CREATE TABLE IF NOT EXISTS user_notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  actor_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page       TEXT,
  body       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX IF NOT EXISTS user_notifications_user ON user_notifications(user_id, created_at);
`);
// Les liens d'une page (Instagram, Spotify, site…) et les réponses à un commentaire.
const column = (table, name) => db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);
if (!column('user_profiles', 'links')) db.exec(`ALTER TABLE user_profiles ADD COLUMN links TEXT NOT NULL DEFAULT '[]'`);
// La ville (carte des membres, cities.js) et le CV numérique : métiers, ce qu'on sait faire, ouvert aux collabs.
if (!column('user_profiles', 'city')) db.exec(`ALTER TABLE user_profiles ADD COLUMN city TEXT NOT NULL DEFAULT ''`);
if (!column('user_profiles', 'cv')) db.exec(`ALTER TABLE user_profiles ADD COLUMN cv TEXT NOT NULL DEFAULT '{}'`);
// Une commune de France (fr-<INSEE>) : son nom et sa position, gardés tels que l'API officielle les a donnés.
if (!column('user_profiles', 'place')) db.exec(`ALTER TABLE user_profiles ADD COLUMN place TEXT NOT NULL DEFAULT ''`);
/** Le lieu d'une page : une ville de la liste, ou la commune enregistrée ; null sans lieu. */
export const placeOf = (p) => CITY.get(p.city) || (p.city && p.place ? (() => { try { return JSON.parse(p.place); } catch { return null; } })() : null);
const cvOf = (json) => { try { const c = JSON.parse(json || '{}'); return { roles: c.roles || [], skills: c.skills || '', open: !!c.open, showLinks: !!c.showLinks }; } catch { return { roles: [], skills: '', open: false, showLinks: false }; } };
// Sa page de liens (mes-liens.html), affichée sur son profil et la carte s'il l'a choisi.
const linkPageOf = (userId) => { const h = get('SELECT handle FROM link_pages WHERE user_id = ?', userId)?.handle; return h ? `${config.linksUrl}/${h}` : null; };
// L'habillage de la page, choisi par son propriétaire : fond (image, GIF ou vidéo), police, verre, ordre des blocs.
// Les packs montrés sur la page de profil : seulement ceux que le beatmaker a choisis (rien par défaut).
if (!column('sound_projects', 'on_profile')) db.exec('ALTER TABLE sound_projects ADD COLUMN on_profile INTEGER NOT NULL DEFAULT 0');
if (!column('user_profiles', 'look')) db.exec(`ALTER TABLE user_profiles ADD COLUMN look TEXT NOT NULL DEFAULT '{}'`);
export const LOOK_FONTS = ['Hanken Grotesk', 'Unbounded', 'JetBrains Mono', 'Grenze Gotisch', 'Anton', 'Bebas Neue', 'Permanent Marker', 'Press Start 2P', 'Silkscreen', 'VT323'];
export const LOOK_BLOCKS = ['bio', 'cv', 'tabs'];
const BG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const num = (v, min, max, d) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : d);
/** L'habillage gardé : ce que la page reçoit (le fond en adresse). */
function lookOf(json) {
  let l = {};
  try { l = JSON.parse(json || '{}'); } catch { /* habillage illisible : celui par défaut */ }
  const order = Array.isArray(l.order) ? l.order.filter((b) => LOOK_BLOCKS.includes(b)) : [];
  return { font: LOOK_FONTS.includes(l.font) ? l.font : LOOK_FONTS[0], title: LOOK_FONTS.includes(l.title) ? l.title : LOOK_FONTS[1], glass: l.glass !== false,
    dim: num(l.dim, 0, 90, 45), blur: num(l.blur, 0, 40, 18), align: l.align === 'center' ? 'center' : 'left',
    order: [...new Set([...order, ...LOOK_BLOCKS])], bg: l.bg ? `/api/media/${l.bg}` : null, bgType: l.bg ? (/\.(mp4|webm)$/.test(l.bg) ? 'video' : 'image') : null };
}
/** Le fichier de fond reconnu à son contenu (pas au type annoncé). */
function bgKind(head) {
  if (head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (head.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'jpg';
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (head.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (head.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (head.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))) return 'webm';
  return null;
}
if (!column('profile_comments', 'parent_id')) db.exec('ALTER TABLE profile_comments ADD COLUMN parent_id INTEGER REFERENCES profile_comments(id) ON DELETE CASCADE');

export const PROFILE_HANDLE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
/** « Tom Gurdian » ou « Élodie ! » deviennent « tom-gurdian », « elodie » : sans majuscules, accents ni espaces. */
export const toHandle = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[^a-z0-9]+|[-._]+$/g, '').slice(0, 30);
const COLOR = /^#[0-9a-f]{6}$/i;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const media = (name) => (name ? `/api/media/${name}` : null);
const person = (u) => ({ id: u.id, name: u.name || 'Membre', avatar: media(u.avatar), handle: u.handle || null, role: u.role || null });
const linksOf = (json) => { try { return JSON.parse(json || '[]'); } catch { return []; } };
/** Jusqu'à six liens http(s), chacun avec un nom court. */
function cleanLinks(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 6).map((l) => ({ label: clean(l?.label, 40), url: clean(l?.url, 300) })).filter((l) => l.url).map((l) => {
    let url;
    try { url = new URL(/^https?:\/\//i.test(l.url) ? l.url : `https://${l.url}`); } catch { throw new HttpError(400, `Lien illisible : ${l.url}`); }
    if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, `Lien illisible : ${l.url}`);
    return { label: l.label || url.hostname.replace(/^www\./, ''), url: url.href };
  });
}
/** Prévenir quelqu'un (abonnement, commentaire, réponse) ; jamais soi-même. */
const notify = (userId, kind, actorId, page, body = '') => {
  if (userId !== actorId) run('INSERT INTO user_notifications (user_id, kind, actor_id, page, body, created_at) VALUES (?, ?, ?, ?, ?, ?)', userId, kind, actorId, page, body.slice(0, 140), now());
};

export function mountProfiles(app, { requireUser, receiveImage, receiveFile, removeMedia, wrap }) {
  const pageOf = (handle) => {
    const p = get('SELECT p.*, u.name, u.avatar, u.role FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE p.handle = ?', String(handle || '').toLowerCase());
    if (!p) throw new HttpError(404, "Cette page de profil n'existe pas.");
    return p;
  };

  // Ma page : la créer, la régler (adresse, bio, couleur, commentaires ouverts), ou la supprimer.
  app.get('/api/me/profile/page', requireUser, (req, res) => {
    const p = get('SELECT * FROM user_profiles WHERE user_id = ?', req.user.id);
    res.set('Cache-Control', 'no-store').json(p ? { handle: p.handle, bio: p.bio, color: p.color, banner: media(p.banner), comments: !!p.comments, links: linksOf(p.links), city: p.city || '', place: placeOf(p), cv: cvOf(p.cv), look: lookOf(p.look), gifSearch: !!config.klipyKey, linkPage: p ? linkPageOf(req.user.id) : null,
      // Ses packs qui ont un lien d'écoute ouvert, et ceux qu'il a choisi de montrer.
      packs: publicPlaylists(req.user.id, { kind: 'pack', where: 'p.user_id = ?', params: [req.user.id], limit: 60 }).map((x) => ({ id: x.id, title: x.title, shown: !!get('SELECT on_profile FROM sound_projects WHERE id = ?', x.id).on_profile })) } : null);
  });
  app.put('/api/me/profile/page', requireUser, wrap(async (req, res) => {
    rateLimit(`profile-edit:${req.user.id}`, 60, 3600_000);
    const handle = toHandle(req.body?.handle);
    if (!PROFILE_HANDLE.test(handle)) throw new HttpError(400, "L'adresse de ta page : 3 à 30 caractères, lettres minuscules, chiffres, point, tiret ou tiret bas.");
    const taken = get('SELECT user_id FROM user_profiles WHERE handle = ?', handle);
    if (taken && taken.user_id !== req.user.id) throw new HttpError(409, 'Cette adresse est déjà prise.');
    const color = COLOR.test(req.body?.color || '') ? req.body.color.toLowerCase() : '#e5384a';
    const links = JSON.stringify(cleanLinks(req.body?.links));
    // Le lieu : une ville de la liste, ou une commune de France vérifiée auprès de l'API officielle (gardée si elle ne change pas).
    const wanted = String(req.body?.city || '');
    const before = get('SELECT city, place FROM user_profiles WHERE user_id = ?', req.user.id);
    const place = CITY.get(wanted) || (before?.city === wanted && before.place ? JSON.parse(before.place) : await communeById(wanted, config.geoApi));
    const city = place ? wanted : '';
    const roles = Array.isArray(req.body?.cv?.roles) ? [...new Set(req.body.cv.roles.filter((r) => CV_ROLES.includes(r)))].slice(0, 6) : [];
    const cv = JSON.stringify({ roles, skills: clean(req.body?.cv?.skills, 300), open: !!req.body?.cv?.open, showLinks: !!req.body?.cv?.showLinks });
    run(`INSERT INTO user_profiles (user_id, handle, bio, color, comments, links, city, place, cv, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET handle = excluded.handle, bio = excluded.bio, color = excluded.color, comments = excluded.comments, links = excluded.links,
        city = excluded.city, place = excluded.place, cv = excluded.cv`,
      req.user.id, handle, clean(req.body?.bio, 600), color, req.body?.comments === false ? 0 : 1, links, city, place && !CITY.has(city) ? JSON.stringify(place) : '', cv, now());
    // L'habillage : le fond se change par sa propre route, le reste ici.
    if (req.body?.look && typeof req.body.look === 'object') {
      const l = req.body.look, kept = JSON.parse(get('SELECT look FROM user_profiles WHERE user_id = ?', req.user.id).look || '{}');
      run('UPDATE user_profiles SET look = ? WHERE user_id = ?', JSON.stringify({ ...kept, font: l.font, title: l.title, glass: l.glass !== false, dim: num(l.dim, 0, 90, 45),
        blur: num(l.blur, 0, 40, 18), align: l.align === 'center' ? 'center' : 'left', order: Array.isArray(l.order) ? l.order.filter((b) => LOOK_BLOCKS.includes(b)) : [] }), req.user.id);
    }
    if (Array.isArray(req.body?.packIds)) {
      const ids = req.body.packIds.map(Number).filter(Number.isInteger);
      transaction(() => {
        run(`UPDATE sound_projects SET on_profile = 0 WHERE user_id = ? AND kind = 'pack'`, req.user.id);
        for (const id of ids) run(`UPDATE sound_projects SET on_profile = 1 WHERE id = ? AND user_id = ? AND kind = 'pack'`, id, req.user.id);
      });
    }
    mapCache = null;
    res.json({ handle });
  }));
  app.put('/api/me/profile/page/banner', requireUser, wrap(async (req, res) => {
    const p = get('SELECT * FROM user_profiles WHERE user_id = ?', req.user.id);
    if (!p) throw new HttpError(404, "Crée d'abord ta page de profil.");
    rateLimit(`profile-banner:${req.user.id}`, 30, 3600_000);
    const name = await receiveImage(req, 6 * 1024 * 1024);
    run('UPDATE user_profiles SET banner = ? WHERE user_id = ?', name, req.user.id);
    if (p.banner) removeMedia(p.banner);
    res.json({ banner: media(name) });
  }));
  // Le fond de la page : une image, un GIF ou une courte vidéo (MP4 ou WebM, 30 Mo au plus), qui remplace le précédent.
  app.put('/api/me/profile/page/background', requireUser, wrap(async (req, res) => {
    const p = get('SELECT look FROM user_profiles WHERE user_id = ?', req.user.id);
    if (!p) throw new HttpError(404, "Crée d'abord ta page de profil.");
    if (!BG_TYPES[req.headers['content-type']]) throw new HttpError(400, 'Fond attendu : image PNG, JPEG, WebP, GIF, ou vidéo MP4 ou WebM.');
    rateLimit(`profile-banner:${req.user.id}`, 30, 3600_000);
    const file = await receiveFile(req, config.mediaDir, 30 * 1024 * 1024);
    res.json({ look: keepBackground(req.user.id, p, file.storedAs) });
  }));
  /** Le fichier reçu (dans media/) devient le fond, s'il est bien une image ou une vidéo ; l'ancien fond est effacé. */
  function keepBackground(userId, p, storedAs) {
    const stored = path.join(config.mediaDir, storedAs), head = Buffer.alloc(12), fd = fs.openSync(stored, 'r');
    fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
    const ext = bgKind(head);
    if (!ext) { fs.rmSync(stored, { force: true }); throw new HttpError(400, "Ce fichier n'est ni une image ni une vidéo lisible."); }
    const name = `${storedAs}.${ext}`;
    fs.renameSync(stored, path.join(config.mediaDir, name));
    const look = JSON.parse(p.look || '{}');
    if (look.bg) removeMedia(look.bg);
    run('UPDATE user_profiles SET look = ? WHERE user_id = ?', JSON.stringify({ ...look, bg: name }), userId);
    return lookOf(JSON.stringify({ ...look, bg: name }));
  }

  // Chercher un GIF de fond, comme dans Discord : KLIPY, interrogé par le serveur (la clé reste ici). Sans mot, les
  // tendances. Chaque résultat garde un aperçu léger et le fichier à prendre (vidéo MP4 de préférence : bien plus légère).
  const KLIPY_FILES = /^https:\/\/([a-z0-9-]+\.)*klipy\.com\//;
  const pickFile = (f, kinds, sizes = ['hd', 'md', 'sm', 'xs']) => {
    for (const size of sizes) for (const kind of kinds) {
      const url = f?.[size]?.[kind]?.url;
      if (typeof url === 'string' && KLIPY_FILES.test(url)) return url;
    }
    return null;
  };
  app.get('/api/me/profile/gifs', requireUser, wrap(async (req, res) => {
    if (!config.klipyKey) throw new HttpError(404, "La recherche de GIF n'est pas encore branchée.");
    rateLimit(`profile-gifs:${req.user.id}`, 120, 3600_000);
    const q = clean(req.query.q, 80), page = Math.max(1, Math.min(20, Number(req.query.page) || 1));
    const url = `${config.klipyApi}/api/v1/${encodeURIComponent(config.klipyKey)}/gifs/${q ? 'search' : 'trending'}?per_page=24&page=${page}`
      + `&customer_id=u${req.user.id}&locale=fr${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) }).catch(() => null);
    if (!r || !r.ok) throw new HttpError(502, 'La recherche de GIF ne répond pas : réessaie dans un instant.');
    const body = await r.json().catch(() => ({}));
    const items = body?.data?.data || body?.data || body?.results || [];
    res.json({ gifs: (Array.isArray(items) ? items : []).map((g) => ({ id: String(g.id ?? g.slug ?? ''), title: clean(g.title, 120),
      preview: pickFile(g.file, ['webp', 'gif'], ['sm', 'xs', 'md', 'hd']),
      file: pickFile(g.file, ['mp4', 'webm', 'gif']) })).filter((g) => g.preview && g.file) });
  }));
  // Le GIF choisi est copié chez nous (30 Mo au plus) : la page ne dépend plus de KLIPY ensuite.
  app.put('/api/me/profile/page/background-gif', requireUser, wrap(async (req, res) => {
    const p = get('SELECT look FROM user_profiles WHERE user_id = ?', req.user.id);
    if (!p) throw new HttpError(404, "Crée d'abord ta page de profil.");
    const url = String(req.body?.url || '');
    if (!KLIPY_FILES.test(url)) throw new HttpError(400, 'Choisis un GIF dans la recherche.');
    rateLimit(`profile-banner:${req.user.id}`, 30, 3600_000);
    // Un renvoi vers son réseau de diffusion est suivi, mais seulement s'il reste chez KLIPY.
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!r || !r.ok || !KLIPY_FILES.test(r.url || url)) throw new HttpError(502, "Ce GIF n'a pas pu être récupéré.");
    const chunks = [];
    let size = 0;
    for await (const chunk of r.body) {
      size += chunk.length;
      if (size > 30 * 1024 * 1024) throw new HttpError(413, 'Ce GIF est trop lourd (30 Mo au plus).');
      chunks.push(chunk);
    }
    const storedAs = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(config.mediaDir, storedAs), Buffer.concat(chunks));
    res.json({ look: keepBackground(req.user.id, p, storedAs) });
  }));
  app.delete('/api/me/profile/page/background', requireUser, (req, res) => {
    const p = get('SELECT look FROM user_profiles WHERE user_id = ?', req.user.id);
    const look = JSON.parse(p?.look || '{}');
    if (look.bg) removeMedia(look.bg);
    delete look.bg;
    if (p) run('UPDATE user_profiles SET look = ? WHERE user_id = ?', JSON.stringify(look), req.user.id);
    res.json({ look: lookOf(JSON.stringify(look)) });
  });
  app.delete('/api/me/profile/page', requireUser, (req, res) => {
    const p = get('SELECT banner, look FROM user_profiles WHERE user_id = ?', req.user.id);
    const bg = JSON.parse(p?.look || '{}').bg;
    if (bg) removeMedia(bg);
    transaction(() => {
      run('DELETE FROM user_profiles WHERE user_id = ?', req.user.id);
      run('DELETE FROM profile_comments WHERE profile_id = ?', req.user.id);
    });
    if (p?.banner) removeMedia(p.banner);
    res.json({ ok: true });
  });

  // Une page, vue par tout le monde ; le visiteur connecté voit s'il est abonné.
  app.get('/api/profiles/:handle', (req, res) => {
    const p = pageOf(req.params.handle), viewer = optionalUser(req);
    const count = (sql, ...a) => get(sql, ...a).n;
    const comments = all(`SELECT c.id, c.body, c.created_at, c.parent_id, u.id AS uid, u.name, u.avatar, u.role, pr.handle,
        (SELECT COUNT(*) FROM profile_comment_likes k WHERE k.comment_id = c.id) AS likes,
        EXISTS (SELECT 1 FROM profile_comment_likes k WHERE k.comment_id = c.id AND k.user_id = ?) AS liked
      FROM profile_comments c JOIN users u ON u.id = c.author_id LEFT JOIN user_profiles pr ON pr.user_id = u.id
      WHERE c.profile_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT 400`, viewer?.id || 0, p.user_id)
      .map((c) => ({ id: c.id, parentId: c.parent_id, body: c.body, at: c.created_at, likes: c.likes, liked: !!c.liked,
        author: person({ id: c.uid, name: c.name, avatar: c.avatar, handle: c.handle, role: c.role }), canDelete: !!(viewer && (viewer.id === c.uid || viewer.id === p.user_id)) }));
    // Les réponses sous leur commentaire, de la plus ancienne à la plus récente.
    const top = comments.filter((c) => !c.parentId);
    for (const c of top) c.replies = comments.filter((r) => r.parentId === c.id).reverse();
    res.set('Cache-Control', 'no-store').json({
      handle: p.handle, name: p.name || 'Membre', avatar: media(p.avatar), bio: p.bio, color: p.color, banner: media(p.banner), commentsOpen: !!p.comments,
      links: linksOf(p.links), since: p.created_at, role: p.role || null, city: placeOf(p), cv: cvOf(p.cv), look: lookOf(p.look),
      linkPage: cvOf(p.cv).showLinks ? linkPageOf(p.user_id) : null,
      playlists: publicPlaylists(viewer?.id, { where: 'p.user_id = ?', params: [p.user_id], limit: 60 }),
      packs: publicPlaylists(viewer?.id, { kind: 'pack', where: 'p.user_id = ? AND p.on_profile = 1', params: [p.user_id], limit: 60 }),
      followers: count('SELECT COUNT(*) AS n FROM user_follows WHERE followed_id = ?', p.user_id),
      following: count('SELECT COUNT(*) AS n FROM user_follows WHERE follower_id = ?', p.user_id),
      mine: viewer?.id === p.user_id, followed: !!(viewer && get('SELECT 1 FROM user_follows WHERE follower_id = ? AND followed_id = ?', viewer.id, p.user_id)),
      canMessage: !!(viewer && viewer.id !== p.user_id),
      followsMe: !!(viewer && get('SELECT 1 FROM user_follows WHERE follower_id = ? AND followed_id = ?', p.user_id, viewer.id)),
      comments: top,
    });
  });
  // Les abonnés d'une page, ou ses abonnements : ?side=followers|following (avec, pour le visiteur, qui il suit déjà).
  app.get('/api/profiles/:handle/follows', (req, res) => {
    const p = pageOf(req.params.handle), viewer = optionalUser(req), followers = req.query.side !== 'following';
    const rows = all(`SELECT u.id, u.name, u.avatar, u.role, pr.handle, pr.bio FROM user_follows f
        JOIN users u ON u.id = ${followers ? 'f.follower_id' : 'f.followed_id'} LEFT JOIN user_profiles pr ON pr.user_id = u.id
      WHERE ${followers ? 'f.followed_id' : 'f.follower_id'} = ? ORDER BY f.created_at DESC LIMIT 500`, p.user_id);
    const mine = new Set(viewer ? all('SELECT followed_id FROM user_follows WHERE follower_id = ?', viewer.id).map((r) => r.followed_id) : []);
    res.set('Cache-Control', 'no-store').json(rows.map((r) => ({ ...person(r), bio: (r.bio || '').slice(0, 120), followed: mine.has(r.id), me: viewer?.id === r.id })));
  });
  app.post('/api/profiles/:handle/follow', requireUser, (req, res) => {
    const p = pageOf(req.params.handle);
    if (p.user_id === req.user.id) throw new HttpError(400, "On ne s'abonne pas à sa propre page.");
    rateLimit(`profile-follow:${req.user.id}`, 120, 3600_000);
    if (run('INSERT OR IGNORE INTO user_follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)', req.user.id, p.user_id, now()).changes
      // Un seul avis par personne : se désabonner puis se réabonner ne le renvoie pas.
      && !get(`SELECT 1 FROM user_notifications WHERE user_id = ? AND kind = 'follow' AND actor_id = ?`, p.user_id, req.user.id)) notify(p.user_id, 'follow', req.user.id, p.handle);
    res.json({ followed: true });
  });
  app.delete('/api/profiles/:handle/follow', requireUser, (req, res) => {
    run('DELETE FROM user_follows WHERE follower_id = ? AND followed_id = ?', req.user.id, pageOf(req.params.handle).user_id);
    res.json({ followed: false });
  });
  app.post('/api/profiles/:handle/comments', requireUser, (req, res) => {
    const p = pageOf(req.params.handle);
    if (!p.comments && p.user_id !== req.user.id) throw new HttpError(403, "Les commentaires sont fermés sur cette page.");
    rateLimit(`profile-comment:${req.user.id}`, 30, 3600_000);
    const body = clean(req.body?.body, 1000);
    if (!body) throw new HttpError(400, 'Écris un commentaire.');
    // Une réponse se pose sous un commentaire de la même page (pas sous une autre réponse).
    const parent = req.body?.parentId ? get('SELECT * FROM profile_comments WHERE id = ? AND profile_id = ? AND parent_id IS NULL', Number(req.body.parentId) || 0, p.user_id) : null;
    if (req.body?.parentId && !parent) throw new HttpError(404, 'Ce commentaire a été retiré.');
    const id = run('INSERT INTO profile_comments (profile_id, author_id, body, created_at, parent_id) VALUES (?, ?, ?, ?, ?)', p.user_id, req.user.id, body, now(), parent?.id ?? null).lastInsertRowid;
    notify(p.user_id, parent ? 'reply' : 'comment', req.user.id, p.handle, body);
    if (parent && parent.author_id !== p.user_id) notify(parent.author_id, 'reply', req.user.id, p.handle, body);
    res.status(201).json({ id });
  });
  // Aimer un commentaire, ou ne plus l'aimer ({ like: false }).
  app.post('/api/profiles/comments/:id/like', requireUser, (req, res) => {
    const c = get('SELECT id FROM profile_comments WHERE id = ?', Number(req.params.id) || 0);
    if (!c) throw new HttpError(404, 'Commentaire introuvable.');
    if (req.body?.like === false) run('DELETE FROM profile_comment_likes WHERE comment_id = ? AND user_id = ?', c.id, req.user.id);
    else run('INSERT OR IGNORE INTO profile_comment_likes (comment_id, user_id) VALUES (?, ?)', c.id, req.user.id);
    res.json({ likes: get('SELECT COUNT(*) AS n FROM profile_comment_likes WHERE comment_id = ?', c.id).n, liked: req.body?.like !== false });
  });
  app.delete('/api/profiles/comments/:id', requireUser, (req, res) => {
    const c = get('SELECT * FROM profile_comments WHERE id = ?', Number(req.params.id) || 0);
    if (!c) throw new HttpError(404, 'Commentaire introuvable.');
    if (c.author_id !== req.user.id && c.profile_id !== req.user.id) throw new HttpError(403, "Seul son auteur ou le propriétaire de la page peut le retirer.");
    run('DELETE FROM profile_comments WHERE id = ?', c.id);
    res.json({ ok: true });
  });

  // La carte des membres : les villes, les métiers, et chaque page de profil qui a choisi sa ville.
  // La carte est la même pour tous : gardée 30 s en mémoire, et refaite dès qu'une page de profil change.
  let mapCache = null;
  app.get('/api/members/map', (req, res) => {
    if (mapCache && Date.now() - mapCache.at < 30_000) return res.set('Cache-Control', 'public, max-age=60').type('json').send(mapCache.body);
    const members = all(`SELECT p.user_id, p.handle, p.city, p.place, p.cv, p.color, u.name, u.avatar, u.role, lp.handle AS link_handle,
        (SELECT COUNT(*) FROM user_follows f WHERE f.followed_id = p.user_id) AS followers
      FROM user_profiles p JOIN users u ON u.id = p.user_id LEFT JOIN link_pages lp ON lp.user_id = p.user_id
      WHERE p.city != '' ORDER BY followers DESC LIMIT 5000`).filter((m) => placeOf(m));
    // Seuls les lieux où quelqu'un s'est recensé apparaissent sur la carte.
    const cities = [...new Map(members.map((m) => { const c = placeOf(m); return [c.id, c]; })).values()];
    // Les playlists publiques des membres de la carte, en une requête : les trois plus récentes de chacun.
    const lists = new Map();
    for (const x of publicPlaylists(0, { where: `p.user_id IN (SELECT user_id FROM user_profiles WHERE city != '')`, limit: 3000 })) {
      if (!lists.has(x.ownerHandle)) lists.set(x.ownerHandle, []);
      if (lists.get(x.ownerHandle).length < 3) lists.get(x.ownerHandle).push({ title: x.title, cover: x.cover, tracks: x.tracks, url: x.url });
    }
    const list = members.map((m) => {
      const cv = cvOf(m.cv);
      return { handle: m.handle, name: m.name || 'Membre', avatar: media(m.avatar), role: m.role, color: m.color, city: m.city, cv: { roles: cv.roles, skills: cv.skills, open: cv.open },
        followers: m.followers, playlists: lists.get(m.handle) || [], linkPage: cv.showLinks && m.link_handle ? `${config.linksUrl}/${m.link_handle}` : null };
    });
    mapCache = { at: Date.now(), body: JSON.stringify({ cities, roles: CV_ROLES, members: list }) };
    res.set('Cache-Control', 'public, max-age=60').type('json').send(mapCache.body);
  });
  app.get('/api/members/roles', (_req, res) => res.set('Cache-Control', 'public, max-age=86400').json({ roles: CV_ROLES }));
  // Chercher son lieu (page de profil) : les villes de la liste et toutes les communes de France.
  app.get('/api/places', wrap(async (req, res) => {
    rateLimit(`places:${req.ip}`, 300, 3600_000);
    res.set('Cache-Control', 'public, max-age=3600').json(await searchPlaces(String(req.query.q || '').slice(0, 60), config.geoApi));
  }));

  // Le petit logo d'un site, pour les boutons de liens des pages : demandé une fois par le serveur (le visiteur ne
  // contacte aucun autre site), gardé une semaine sur le disque. 404 si le site n'en a pas.
  const iconDir = path.join(config.dataDir, 'link-icons');
  app.get('/api/link-icon', wrap(async (req, res) => {
    const host = String(req.query.host || '').toLowerCase().replace(/^www\./, '');
    if (!/^(?=.{4,120}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) throw new HttpError(400, 'Adresse illisible.');
    const file = path.join(iconDir, `${host}.png`), miss = `${file}.none`;
    const fresh = (f) => fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 7 * 86400_000;
    if (!fresh(file) && !fresh(miss)) {
      rateLimit('link-icon', 600, 3600_000);
      const r = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`, { signal: AbortSignal.timeout(6000) }).catch(() => null);
      const body = r?.ok && /^image\//.test(r.headers.get('content-type') || '') ? Buffer.from(await r.arrayBuffer()) : null;
      fs.mkdirSync(iconDir, { recursive: true });
      if (body && body.length < 200_000) { fs.writeFileSync(file, body); fs.rmSync(miss, { force: true }); }
      else if (r) fs.writeFileSync(miss, ''); // pas de logo : pas de nouvelle demande avant une semaine
    }
    if (!fs.existsSync(file) || fresh(miss)) throw new HttpError(404, 'Pas de logo pour ce site.');
    res.set('Cache-Control', 'public, max-age=604800').type('png').sendFile(file);
  }));

  // L'activité : qui s'est abonné, a commenté ma page ou répondu à mon commentaire ; et les compteurs du menu.
  app.get('/api/me/activity', requireUser, (req, res) => {
    const rows = all(`SELECT n.*, u.name, u.avatar, pr.handle FROM user_notifications n JOIN users u ON u.id = n.actor_id
      LEFT JOIN user_profiles pr ON pr.user_id = u.id WHERE n.user_id = ? ORDER BY n.created_at DESC, n.id DESC LIMIT 100`, req.user.id);
    res.set('Cache-Control', 'no-store').json(rows.map((n) => ({ id: n.id, kind: n.kind, page: n.page, body: n.body, at: n.created_at, read: !!n.read_at,
      actor: person({ id: n.actor_id, name: n.name, avatar: n.avatar, handle: n.handle }) })));
  });
  app.post('/api/me/activity/read', requireUser, (req, res) => {
    run('UPDATE user_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now(), req.user.id);
    res.json({ ok: true });
  });
  app.get('/api/me/inbox-count', requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store').json({
      notifications: get('SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).n,
      messages: get('SELECT COUNT(*) AS n FROM user_messages WHERE to_id = ? AND read_at IS NULL', req.user.id).n,
      profile: get('SELECT handle FROM user_profiles WHERE user_id = ?', req.user.id)?.handle || null,
    });
  });

  // Les messages privés : messages.js.
}
