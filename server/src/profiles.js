// Les pages de profil des membres (profil.html) : créées depuis « Mon compte » par ceux qui en veulent une, avec un
// nom d'adresse, une bio, une couleur et une bannière ; on s'y abonne (follow), on y laisse un commentaire, et on
// écrit en privé à son auteur (messages.html). Un compte sans page de profil ne reçoit pas de message.
import { db, get, all, run, now, transaction } from './db.js';
import { HttpError, rateLimit, optionalUser } from './auth.js';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { publicPlaylists } from './ratings.js';
import { CITIES, CITY, CV_ROLES } from './cities.js';

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
const cvOf = (json) => { try { const c = JSON.parse(json || '{}'); return { roles: c.roles || [], skills: c.skills || '', open: !!c.open }; } catch { return { roles: [], skills: '', open: false }; } };
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

export function mountProfiles(app, { requireUser, receiveImage, removeMedia, wrap }) {
  const pageOf = (handle) => {
    const p = get('SELECT p.*, u.name, u.avatar, u.role FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE p.handle = ?', String(handle || '').toLowerCase());
    if (!p) throw new HttpError(404, "Cette page de profil n'existe pas.");
    return p;
  };

  // Ma page : la créer, la régler (adresse, bio, couleur, commentaires ouverts), ou la supprimer.
  app.get('/api/me/profile/page', requireUser, (req, res) => {
    const p = get('SELECT * FROM user_profiles WHERE user_id = ?', req.user.id);
    res.set('Cache-Control', 'no-store').json(p ? { handle: p.handle, bio: p.bio, color: p.color, banner: media(p.banner), comments: !!p.comments, links: linksOf(p.links), city: p.city || '', cv: cvOf(p.cv) } : null);
  });
  app.put('/api/me/profile/page', requireUser, (req, res) => {
    rateLimit(`profile-edit:${req.user.id}`, 60, 3600_000);
    const handle = toHandle(req.body?.handle);
    if (!PROFILE_HANDLE.test(handle)) throw new HttpError(400, "L'adresse de ta page : 3 à 30 caractères, lettres minuscules, chiffres, point, tiret ou tiret bas.");
    const taken = get('SELECT user_id FROM user_profiles WHERE handle = ?', handle);
    if (taken && taken.user_id !== req.user.id) throw new HttpError(409, 'Cette adresse est déjà prise.');
    const color = COLOR.test(req.body?.color || '') ? req.body.color.toLowerCase() : '#e5384a';
    const links = JSON.stringify(cleanLinks(req.body?.links));
    const city = CITY.has(req.body?.city) ? req.body.city : '';
    const roles = Array.isArray(req.body?.cv?.roles) ? [...new Set(req.body.cv.roles.filter((r) => CV_ROLES.includes(r)))].slice(0, 6) : [];
    const cv = JSON.stringify({ roles, skills: clean(req.body?.cv?.skills, 300), open: !!req.body?.cv?.open });
    run(`INSERT INTO user_profiles (user_id, handle, bio, color, comments, links, city, cv, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET handle = excluded.handle, bio = excluded.bio, color = excluded.color, comments = excluded.comments, links = excluded.links,
        city = excluded.city, cv = excluded.cv`,
      req.user.id, handle, clean(req.body?.bio, 600), color, req.body?.comments === false ? 0 : 1, links, city, cv, now());
    res.json({ handle });
  });
  app.put('/api/me/profile/page/banner', requireUser, wrap(async (req, res) => {
    const p = get('SELECT * FROM user_profiles WHERE user_id = ?', req.user.id);
    if (!p) throw new HttpError(404, "Crée d'abord ta page de profil.");
    rateLimit(`profile-banner:${req.user.id}`, 30, 3600_000);
    const name = await receiveImage(req, 6 * 1024 * 1024);
    run('UPDATE user_profiles SET banner = ? WHERE user_id = ?', name, req.user.id);
    if (p.banner) removeMedia(p.banner);
    res.json({ banner: media(name) });
  }));
  app.delete('/api/me/profile/page', requireUser, (req, res) => {
    const p = get('SELECT banner FROM user_profiles WHERE user_id = ?', req.user.id);
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
      links: linksOf(p.links), since: p.created_at, role: p.role || null, city: CITY.get(p.city) || null, cv: cvOf(p.cv),
      playlists: publicPlaylists(viewer?.id, { where: 'p.user_id = ?', params: [p.user_id], limit: 60 }),
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
  app.get('/api/members/map', (req, res) => {
    const members = all(`SELECT p.handle, p.city, p.cv, p.color, u.name, u.avatar, u.role,
        (SELECT COUNT(*) FROM user_follows f WHERE f.followed_id = p.user_id) AS followers
      FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE p.city != '' ORDER BY followers DESC LIMIT 5000`)
      .filter((m) => CITY.has(m.city))
      .map((m) => ({ handle: m.handle, name: m.name || 'Membre', avatar: media(m.avatar), role: m.role, color: m.color, city: m.city, cv: cvOf(m.cv), followers: m.followers }));
    res.set('Cache-Control', 'public, max-age=60').json({ cities: CITIES, roles: CV_ROLES, members });
  });

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

  // Les messages privés : les conversations (la dernière ligne et les non lus), une conversation, et l'envoi.
  const other = (req) => {
    const p = pageOf(req.params.handle);
    if (p.user_id === req.user.id) throw new HttpError(400, 'On ne s\'écrit pas à soi-même.');
    return p;
  };
  app.get('/api/me/messages', requireUser, (req, res) => {
    const u = req.user.id;
    const rows = all(`SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS other, MAX(created_at) AS at,
        SUM(CASE WHEN to_id = ? AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
      FROM user_messages WHERE from_id = ? OR to_id = ? GROUP BY other ORDER BY at DESC LIMIT 100`, u, u, u, u);
    res.set('Cache-Control', 'no-store').json(rows.map((r) => {
      const who = get('SELECT u.id, u.name, u.avatar, p.handle FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?', r.other);
      const last = get('SELECT body, from_id FROM user_messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY created_at DESC LIMIT 1', u, r.other, r.other, u);
      return who && { with: person(who), at: r.at, unread: r.unread, last: last ? (last.from_id === u ? 'Toi : ' : '') + last.body.slice(0, 120) : '' };
    }).filter(Boolean));
  });
  app.get('/api/me/messages/:handle', requireUser, (req, res) => {
    const p = other(req), u = req.user.id;
    run('UPDATE user_messages SET read_at = ? WHERE from_id = ? AND to_id = ? AND read_at IS NULL', now(), p.user_id, u);
    res.set('Cache-Control', 'no-store').json({ with: person({ id: p.user_id, name: p.name, avatar: p.avatar, handle: p.handle }),
      messages: all(`SELECT id, from_id, body, created_at FROM user_messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
        ORDER BY created_at DESC LIMIT 300`, u, p.user_id, p.user_id, u).reverse().map((m) => ({ id: m.id, mine: m.from_id === u, body: m.body, at: m.created_at })) });
  });
  app.post('/api/me/messages/:handle', requireUser, (req, res) => {
    const p = other(req);
    rateLimit(`messages:${req.user.id}`, 300, 3600_000);
    const body = clean(req.body?.body, 2000);
    if (!body) throw new HttpError(400, 'Écris un message.');
    res.status(201).json({ id: run('INSERT INTO user_messages (from_id, to_id, body, created_at) VALUES (?, ?, ?, ?)', req.user.id, p.user_id, body, now()).lastInsertRowid });
  });
}
