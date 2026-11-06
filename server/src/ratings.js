// Les notes et les « ups » d'ONIRIQUE CLOUD, pour les playlists et leurs sons : une note de 1 à 5 étoiles par membre
// (la moyenne et le nombre de notes en détail), un up par membre, par playlist ou par son, et par jour, et le top 3 de
// la semaine (les playlists qui ont reçu le plus d'ups en sept jours, parmi celles qui ont un lien d'écoute ouvert).
// Une playlist ou un son se note quand on le voit : le sien, une collab, un lien d'écoute enregistré ou ouvert.
import { db, get, all, run, now } from './db.js';
import { config } from './config.js';
import { HttpError, rateLimit, can, optionalUser } from './auth.js';

db.exec(`
CREATE TABLE IF NOT EXISTS sound_ratings (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  target_id  INTEGER NOT NULL,
  stars      INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, target_id)
);
CREATE TABLE IF NOT EXISTS sound_ups (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  target_id  INTEGER NOT NULL,
  day        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, target_id, day)
);
CREATE INDEX IF NOT EXISTS sound_ups_recent ON sound_ups(kind, created_at);
`);
// Le créateur d'une playlist autorise (ou non) les autres membres à en ajouter les sons à leurs propres playlists.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_projects') WHERE name = 'members_add'`).get()) {
  db.exec('ALTER TABLE sound_projects ADD COLUMN members_add INTEGER NOT NULL DEFAULT 0');
}
// Une playlist publique (par défaut) apparaît dans « Découvrir », le top de la semaine et sur la page de profil de son
// créateur ; privée, seuls ceux qui ont son lien la voient.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_projects') WHERE name = 'public'`).get()) {
  db.exec('ALTER TABLE sound_projects ADD COLUMN public INTEGER NOT NULL DEFAULT 1');
}

const KINDS = ['playlist', 'track'];
const today = () => new Date(now()).toISOString().slice(0, 10);
// Ce que voit le membre : ses projets et ses collabs (hors corbeille), et ce qu'il a enregistré depuis un lien.
const MINE = `(p.kind != 'trash' AND p.trashed_at IS NULL AND (p.user_id = ? OR p.id IN (SELECT project_id FROM sound_collabs WHERE user_id = ?)))`;
const SAVED = `(SELECT l.project_id FROM sound_saves s JOIN sound_links l ON l.id = s.link_id WHERE s.user_id = ? AND l.project_id IS NOT NULL)`;
const SAVED_TRACKS = `(SELECT l.track_id FROM sound_saves s JOIN sound_links l ON l.id = s.link_id WHERE s.user_id = ? AND l.track_id IS NOT NULL)`;

/** Le lien d'écoute ouvert (sans mot de passe, pas expiré) qui désigne ce token, ou null. */
const openLink = (token) => {
  const l = get('SELECT * FROM sound_links WHERE token = ?', String(token || ''));
  return l && !l.password_hash && (!l.expires_at || l.expires_at > now()) ? l : null;
};
/** Le membre voit-il cette playlist ou ce son (ou un lien qui y mène) ? */
function visible(user, kind, targetId, token) {
  const link = token ? openLink(token) : null;
  if (kind === 'playlist') {
    if (link && link.project_id === targetId) return !!get(`SELECT 1 FROM sound_projects WHERE id = ? AND kind = 'playlist'`, targetId);
    return !!get(`SELECT 1 FROM sound_projects p WHERE p.id = ? AND p.kind = 'playlist' AND (${MINE} OR p.id IN ${SAVED})`, targetId, user.id, user.id, user.id);
  }
  if (link && (link.track_id === targetId || (link.project_id && get('SELECT 1 FROM sound_tracks WHERE id = ? AND project_id = ?', targetId, link.project_id)))) return true;
  return !!get(`SELECT 1 FROM sound_tracks t JOIN sound_projects p ON p.id = t.project_id WHERE t.id = ? AND (${MINE} OR p.id IN ${SAVED} OR t.id IN ${SAVED_TRACKS})`,
    targetId, user.id, user.id, user.id, user.id);
}

/** Les notes et les ups de ces playlists et de ces sons : moyenne, nombre de notes, la note du membre, ups, up du jour. */
export function statsOf(userId, kind, ids) {
  if (!ids.length) return {};
  const list = ids.map(Number).filter(Number.isFinite).slice(0, 2000), marks = list.map(() => '?').join(',');
  const out = Object.fromEntries(list.map((id) => [id, { avg: 0, count: 0, mine: 0, ups: 0, upped: false }]));
  for (const r of all(`SELECT target_id, AVG(stars) AS avg, COUNT(*) AS n FROM sound_ratings WHERE kind = ? AND target_id IN (${marks}) GROUP BY target_id`, kind, ...list)) {
    Object.assign(out[r.target_id], { avg: Math.round(r.avg * 10) / 10, count: r.n });
  }
  for (const r of all(`SELECT target_id, stars FROM sound_ratings WHERE kind = ? AND user_id = ? AND target_id IN (${marks})`, kind, userId, ...list)) out[r.target_id].mine = r.stars;
  for (const r of all(`SELECT target_id, COUNT(*) AS n FROM sound_ups WHERE kind = ? AND target_id IN (${marks}) GROUP BY target_id`, kind, ...list)) out[r.target_id].ups = r.n;
  for (const r of all(`SELECT target_id FROM sound_ups WHERE kind = ? AND user_id = ? AND day = ? AND target_id IN (${marks})`, kind, userId, today(), ...list)) out[r.target_id].upped = true;
  return out;
}

/**
 * Les playlists publiques (un lien d'écoute ouvert, au moins un son, hors corbeille) : leur titre, leur créateur et sa
 * page de profil, leurs notes et leurs ups. where / params filtrent, order trie (SQL écrit ici, jamais par l'appelant).
 */
export function publicPlaylists(viewerId, { where = '1', params = [], order = 'p.created_at DESC', limit = 12, since = 0 } = {}) {
  const rows = all(`SELECT * FROM (SELECT p.id, p.title, p.cover, p.user_id, p.created_at, u.name AS owner, pr.handle AS owner_handle,
      (SELECT token FROM sound_links l WHERE l.project_id = p.id AND l.password_hash IS NULL AND (l.expires_at IS NULL OR l.expires_at > ?) ORDER BY l.created_at DESC LIMIT 1) AS token,
      (SELECT COUNT(*) FROM sound_tracks t WHERE t.project_id = p.id) + (SELECT COUNT(*) FROM sound_platform_items i WHERE i.project_id = p.id) AS tracks,
      (SELECT COUNT(*) FROM sound_ups x WHERE x.kind = 'playlist' AND x.target_id = p.id AND x.created_at >= ?) AS ups,
      (SELECT AVG(stars) FROM sound_ratings r WHERE r.kind = 'playlist' AND r.target_id = p.id) AS avg_stars,
      (SELECT COUNT(*) FROM sound_ratings r WHERE r.kind = 'playlist' AND r.target_id = p.id) AS notes
    FROM sound_projects p JOIN users u ON u.id = p.user_id LEFT JOIN user_profiles pr ON pr.user_id = p.user_id
    WHERE p.kind = 'playlist' AND p.trashed_at IS NULL AND p.public != 0 AND ${where}) p
    WHERE token IS NOT NULL AND tracks > 0 ORDER BY ${order} LIMIT ?`, now(), since, ...params, limit);
  const stats = statsOf(viewerId || 0, 'playlist', rows.map((r) => r.id));
  return rows.map((r) => ({ id: r.id, title: r.title, cover: r.cover ? `/api/media/${r.cover}` : null, owner: r.owner || 'Membre', ownerHandle: r.owner_handle || null,
    tracks: r.tracks, ups: r.ups, avg: stats[r.id].avg, count: stats[r.id].count, mine: stats[r.id].mine, at: r.created_at, url: `${config.siteUrl}/ecoute?t=${r.token}` }));
}

export function mountRatings(app, { requireUser }) {
  const member = (req, _res, next) => (can(req.user, 'sounds') ? next() : next(new HttpError(403, 'ONIRIQUE CLOUD demande un abonnement.')));
  const me = [requireUser, member];
  const target = (req) => {
    const kind = String(req.body?.kind || ''), targetId = Number(req.body?.id);
    if (!KINDS.includes(kind) || !Number.isInteger(targetId)) throw new HttpError(400, 'Élément illisible.');
    if (!visible(req.user, kind, targetId, req.body?.token)) throw new HttpError(404, kind === 'playlist' ? 'Playlist introuvable.' : 'Son introuvable.');
    return { kind, targetId };
  };

  // Les notes et ups d'une page : ?playlists=1,2&tracks=3,4 (ce que le membre ne voit pas est ignoré).
  app.get('/api/me/sounds/ratings', ...me, (req, res) => {
    const ids = (v) => String(v || '').split(',').filter(Boolean).map(Number).filter(Number.isInteger).slice(0, 2000);
    const token = req.query.token;
    const keep = (kind, list) => list.filter((x) => visible(req.user, kind, x, token));
    res.set('Cache-Control', 'no-store').json({
      playlist: statsOf(req.user.id, 'playlist', keep('playlist', ids(req.query.playlists))),
      track: statsOf(req.user.id, 'track', keep('track', ids(req.query.tracks))),
    });
  });
  // Noter : 1 à 5 étoiles ; 0 retire sa note.
  app.post('/api/me/sounds/rate', ...me, (req, res) => {
    rateLimit(`sounds-rate:${req.user.id}`, 600, 3600_000);
    const { kind, targetId } = target(req);
    const stars = Number(req.body?.stars);
    if (!Number.isInteger(stars) || stars < 0 || stars > 5) throw new HttpError(400, 'Une note va de 1 à 5 étoiles.');
    if (stars) run(`INSERT INTO sound_ratings (user_id, kind, target_id, stars, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, kind, target_id) DO UPDATE SET stars = excluded.stars, updated_at = excluded.updated_at`, req.user.id, kind, targetId, stars, now());
    else run('DELETE FROM sound_ratings WHERE user_id = ? AND kind = ? AND target_id = ?', req.user.id, kind, targetId);
    res.json(statsOf(req.user.id, kind, [targetId])[targetId]);
  });
  // Un up : une fois par jour par playlist ou par son.
  app.post('/api/me/sounds/up', ...me, (req, res) => {
    rateLimit(`sounds-up:${req.user.id}`, 600, 3600_000);
    const { kind, targetId } = target(req);
    const done = run('INSERT OR IGNORE INTO sound_ups (user_id, kind, target_id, day, created_at) VALUES (?, ?, ?, ?, ?)', req.user.id, kind, targetId, today(), now()).changes;
    if (!done) throw new HttpError(409, 'Un up par jour : reviens demain.');
    res.json(statsOf(req.user.id, kind, [targetId])[targetId]);
  });
  // Le top 3 de la semaine : les playlists aux ups des sept derniers jours, qui ont un lien d'écoute ouvert.
  app.get('/api/me/sounds/top-week', ...me, (req, res) => {
    const since = now() - 7 * 86400_000;
    const rows = all(`SELECT p.id, p.title, p.cover, u.name AS owner, COUNT(*) AS ups,
        (SELECT token FROM sound_links l WHERE l.project_id = p.id AND l.password_hash IS NULL AND (l.expires_at IS NULL OR l.expires_at > ?) ORDER BY l.created_at DESC LIMIT 1) AS token
      FROM sound_ups x JOIN sound_projects p ON p.id = x.target_id JOIN users u ON u.id = p.user_id
      WHERE x.kind = 'playlist' AND x.created_at >= ? AND p.kind = 'playlist' AND p.trashed_at IS NULL AND p.public != 0
      GROUP BY p.id HAVING token IS NOT NULL ORDER BY ups DESC, p.id DESC LIMIT 3`, now(), since);
    const stats = statsOf(req.user.id, 'playlist', rows.map((r) => r.id));
    res.set('Cache-Control', 'no-store').json(rows.map((r) => ({ id: r.id, title: r.title, cover: r.cover ? `/api/media/${r.cover}` : null, owner: r.owner || 'Membre',
      ups: r.ups, avg: stats[r.id].avg, count: stats[r.id].count, url: `${config.siteUrl}/ecoute?t=${r.token}` })));
  });
  // « Découvrir », en haut d'ONIRIQUE CLOUD : le top de la semaine (ups des sept derniers jours), les mieux notées
  // (au moins deux notes), les nouveautés, et les playlists des membres auxquels on est abonné.
  app.get('/api/me/sounds/discover', ...me, (req, res) => {
    const u = req.user.id, week = now() - 7 * 86400_000;
    res.set('Cache-Control', 'no-store').json({
      week: publicPlaylists(u, { since: week, where: `EXISTS (SELECT 1 FROM sound_ups x WHERE x.kind = 'playlist' AND x.target_id = p.id AND x.created_at >= ?)`, params: [week], order: 'ups DESC, id DESC', limit: 10 }),
      best: publicPlaylists(u, { where: `(SELECT COUNT(*) FROM sound_ratings r WHERE r.kind = 'playlist' AND r.target_id = p.id) >= 2`, order: 'avg_stars DESC, notes DESC, id DESC', limit: 10 }),
      fresh: publicPlaylists(u, { where: 'p.user_id != ?', params: [u], limit: 12 }),
      following: publicPlaylists(u, { where: 'p.user_id IN (SELECT followed_id FROM user_follows WHERE follower_id = ?)', params: [u], limit: 20 }),
    });
  });
  // Le créateur autorise les autres membres à ajouter les sons de sa playlist à leurs playlists (clic droit, « Ajouter à »).
  app.post('/api/me/sounds/projects/:id/members-add', ...me, (req, res) => {
    const p = get(`SELECT * FROM sound_projects WHERE id = ? AND user_id = ? AND kind = 'playlist'`, Number(req.params.id) || 0, req.user.id);
    if (!p) throw new HttpError(404, 'Playlist introuvable.');
    run('UPDATE sound_projects SET members_add = ? WHERE id = ?', req.body?.open ? 1 : 0, p.id);
    res.json({ open: !!req.body?.open });
  });
  // Publique ou privée (le créateur seulement).
  app.post('/api/me/sounds/projects/:id/visibility', ...me, (req, res) => {
    const p = get(`SELECT id FROM sound_projects WHERE id = ? AND user_id = ? AND kind = 'playlist'`, Number(req.params.id) || 0, req.user.id);
    if (!p) throw new HttpError(404, 'Playlist introuvable.');
    run('UPDATE sound_projects SET public = ? WHERE id = ?', req.body?.public === false ? 0 : 1, p.id);
    res.json({ public: req.body?.public !== false });
  });
  // Qui a enregistré ma playlist (ou mon projet) depuis un de ses liens : le créateur et ses collaborateurs le voient.
  app.get('/api/me/sounds/projects/:id/savers', ...me, (req, res) => {
    const id = Number(req.params.id) || 0;
    if (!get(`SELECT 1 FROM sound_projects p WHERE p.id = ? AND ${MINE}`, id, req.user.id, req.user.id)) throw new HttpError(404, 'Projet introuvable.');
    res.set('Cache-Control', 'no-store').json(all(`SELECT u.id, u.name, u.avatar, u.role, pr.handle, MIN(s.created_at) AS at
      FROM sound_saves s JOIN sound_links l ON l.id = s.link_id JOIN users u ON u.id = s.user_id LEFT JOIN user_profiles pr ON pr.user_id = u.id
      WHERE l.project_id = ? GROUP BY u.id ORDER BY at DESC LIMIT 500`, id)
      .map((r) => ({ id: r.id, name: r.name || 'Membre', avatar: r.avatar ? `/api/media/${r.avatar}` : null, role: r.role, handle: r.handle || null, at: r.at })));
  });
  // Sur la page d'écoute : la playlist autorise-t-elle l'ajout de ses sons ? (sans compte : non)
  app.get('/api/sounds/share/:token/members-add', (req, res) => {
    const l = openLink(req.params.token), p = l && l.project_id ? get('SELECT kind, members_add, user_id FROM sound_projects WHERE id = ?', l.project_id) : null;
    const user = optionalUser(req);
    res.json({ open: !!(p && user && (p.kind !== 'playlist' || p.members_add || p.user_id === user.id)), projectId: l?.project_id || null, playlist: p?.kind === 'playlist' });
  });
}
