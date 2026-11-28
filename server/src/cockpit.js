// COCKPIT (site/cockpit) : la mémoire de la promo des membres ONIRIQUE. Le journal de ce qui est publié (réseau, vidéo du
// cloud CUT, phrase des paroles, format, accroche), les deux chiffres relevés à 48 h (vues, enregistrements), la banque de
// phrases par titre, et le minimum quotidien qui colore le calendrier : 2 TikTok publiés, les réponses aux commentaires
// faites, les chiffres des vidéos de l'avant-veille notés. Tout se mesure en actions, jamais en vues espérées.
import { db, get, all, run, now } from './db.js';
import { HttpError } from './auth.js';
import { localNow } from './cut.js';

db.exec(`CREATE TABLE IF NOT EXISTS cockpit_posts (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  network      TEXT NOT NULL,
  cut_video_id INTEGER,
  phrase_id    INTEGER,
  format       TEXT NOT NULL DEFAULT '',
  hook         TEXT NOT NULL DEFAULT '',
  url          TEXT NOT NULL DEFAULT '',
  posted_at    INTEGER NOT NULL,
  views        INTEGER,
  saves        INTEGER,
  created_at   INTEGER NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS cockpit_phrases (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
// Une ligne par jour coché « réponses aux commentaires faites » (jour local AAAA-MM-JJ).
db.exec(`CREATE TABLE IF NOT EXISTS cockpit_days (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
)`);

export const NETWORKS = ['tiktok', 'instagram', 'youtube'];
export const TARGETS = { tiktoksPerDay: 2, tiktoksPerWeek: 14, producedPerWeek: 18, stockMin: 2 };
const DAY = 86_400_000;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const shift = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const monday = (day) => shift(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7));
const zone = (tz) => { try { new Intl.DateTimeFormat('fr', { timeZone: String(tz) }); return String(tz); } catch { return 'Europe/Paris'; } };

/** La couleur d'une journée : 'ok' quand le minimum est fait, 'part' quand une partie l'est, 'none' sinon. */
export function dayStatus({ tiktoks, replies, missingStats }) {
  if (tiktoks >= TARGETS.tiktoksPerDay && replies && missingStats === 0) return 'ok';
  return tiktoks > 0 || replies ? 'part' : 'none';
}

/** Les vidéos du cloud CUT pas encore postées sur TikTok : le stock d'avance. */
export const stockOf = (userId) => get(`SELECT COUNT(*) AS n FROM cut_videos v WHERE v.user_id = ?
  AND NOT EXISTS (SELECT 1 FROM cockpit_posts p WHERE p.user_id = v.user_id AND p.cut_video_id = v.id AND p.network = 'tiktok')`, userId).n;

const rate = (p) => (p.views >= 100 && p.saves != null ? Math.round((p.saves * 1000) / p.views) : null); // enregistrements pour 1 000 vues
const postView = (p) => ({ id: p.id, network: p.network, cutVideoId: p.cut_video_id, phraseId: p.phrase_id, format: p.format, hook: p.hook, url: p.url,
  postedAt: p.posted_at, views: p.views, saves: p.saves, rate: rate(p) });

/** Tout ce que montre la page, vu depuis le fuseau tz : aujourd'hui, la semaine, le calendrier de 8 semaines, le journal, la banque. */
export function cockpitOf(userId, tz, at = now()) {
  tz = zone(tz);
  const today = localNow(at, tz).day, start = shift(monday(today), -49), dayOf = (ms) => localNow(ms, tz).day;
  const posts = all('SELECT * FROM cockpit_posts WHERE user_id = ? AND posted_at >= ? ORDER BY posted_at DESC', userId, at - 60 * DAY);
  const byDay = new Map();
  for (const p of posts) { const d = dayOf(p.posted_at); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(p); }
  const replied = new Set(all('SELECT day FROM cockpit_days WHERE user_id = ? AND day >= ?', userId, start).map((r) => r.day));
  const calendar = [];
  for (let d = start; d <= shift(monday(today), 6); d = shift(d, 1)) {
    if (d > today) { calendar.push({ day: d, status: 'future' }); continue; }
    const tiktoks = (byDay.get(d) || []).filter((p) => p.network === 'tiktok').length;
    // Le chiffre à 48 h : les vidéos de l'avant-veille doivent avoir leurs vues notées.
    const missingStats = (byDay.get(shift(d, -2)) || []).filter((p) => p.views == null).length;
    const entry = { day: d, tiktoks, replies: replied.has(d), missingStats };
    calendar.push({ ...entry, status: dayStatus(entry) });
  }
  const week = calendar.filter((c) => c.day >= monday(today) && c.status !== 'future');
  const produced = all('SELECT created_at FROM cut_videos WHERE user_id = ? AND created_at >= ?', userId, at - 8 * DAY)
    .filter((v) => dayOf(v.created_at) >= monday(today)).length;
  const usage = new Map(all(`SELECT phrase_id, COUNT(*) AS n, MAX(posted_at) AS last,
      MAX(CASE WHEN views >= 100 AND saves IS NOT NULL THEN saves * 1000.0 / views END) AS best
    FROM cockpit_posts WHERE user_id = ? AND phrase_id IS NOT NULL GROUP BY phrase_id`, userId).map((u) => [u.phrase_id, u]));
  return {
    tz, today: calendar.find((c) => c.day === today), calendar, targets: TARGETS, stock: stockOf(userId),
    week: { tiktoks: week.reduce((s, c) => s + c.tiktoks, 0), daysOk: week.filter((c) => c.status === 'ok').length, days: week.length, produced },
    toFill: all('SELECT * FROM cockpit_posts WHERE user_id = ? AND views IS NULL AND posted_at <= ? ORDER BY posted_at', userId, at - 2 * DAY).map(postView),
    posts: posts.slice(0, 150).map(postView),
    phrases: all('SELECT * FROM cockpit_phrases WHERE user_id = ? ORDER BY title COLLATE NOCASE, id', userId).map((ph) => {
      const u = usage.get(ph.id);
      return { id: ph.id, title: ph.title, text: ph.text, uses: u ? u.n : 0, lastUsed: u ? u.last : null, best: u && u.best != null ? Math.round(u.best) : null };
    }),
  };
}

const text = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max) : '');
const count = (value, label) => {
  if (value === null || value === '' || value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1e10) throw new HttpError(400, `${label} : un nombre entier attendu.`);
  return n;
};
/** Les champs d'une publication, vérifiés ; p = la publication modifiée (ses valeurs restent pour ce qui n'est pas donné). */
function postFields(body, userId, p = null) {
  const has = (k) => body && Object.hasOwn(body, k);
  const network = has('network') ? String(body.network) : p ? p.network : 'tiktok';
  if (!NETWORKS.includes(network)) throw new HttpError(400, 'Réseau inconnu.');
  const url = has('url') ? text(body.url, 500) : p ? p.url : '';
  if (url && !/^https:\/\/\S+$/.test(url)) throw new HttpError(400, 'Lien attendu en https://');
  const own = (table, id, label) => {
    if (id === null || id === undefined || id === '') return null;
    const row = get(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`, Number(id) || 0, userId);
    if (!row) throw new HttpError(404, `${label} introuvable.`);
    return row.id;
  };
  const postedAt = has('postedAt') ? Number(body.postedAt) : p ? p.posted_at : now();
  if (!(postedAt > now() - 366 * DAY && postedAt < now() + 3600_000)) throw new HttpError(400, 'Date de publication invalide.');
  return {
    network, url, posted_at: postedAt,
    cut_video_id: has('cutVideoId') ? own('cut_videos', body.cutVideoId, 'Vidéo') : p ? p.cut_video_id : null,
    phrase_id: has('phraseId') ? own('cockpit_phrases', body.phraseId, 'Phrase') : p ? p.phrase_id : null,
    format: has('format') ? text(body.format, 60) : p ? p.format : '',
    hook: has('hook') ? text(body.hook, 200) : p ? p.hook : '',
    views: has('views') ? count(body.views, 'Vues') : p ? p.views : null,
    saves: has('saves') ? count(body.saves, 'Enregistrements') : p ? p.saves : null,
  };
}

export function mountCockpit(app, { requireUser }) {
  const member = (req, _res, next) => (['vip', 'beta', 'betaf', 'admin', 'founder'].includes(req.user.role) ? next()
    : next(new HttpError(403, 'Le Cockpit est réservé aux membres ONIRIQUE.')));
  const ownPost = (req) => {
    const p = get('SELECT * FROM cockpit_posts WHERE id = ? AND user_id = ?', Number(req.params.id) || 0, req.user.id);
    if (!p) throw new HttpError(404, 'Publication introuvable.');
    return p;
  };

  app.get('/api/cockpit', requireUser, member, (req, res) => res.json(cockpitOf(req.user.id, req.query.tz)));
  app.post('/api/cockpit/posts', requireUser, member, (req, res) => {
    if (get('SELECT COUNT(*) AS n FROM cockpit_posts WHERE user_id = ? AND created_at > ?', req.user.id, now() - DAY).n >= 100) throw new HttpError(429, 'Cent publications notées en un jour : c’est le maximum.');
    const f = postFields(req.body, req.user.id);
    const id = run(`INSERT INTO cockpit_posts (user_id, network, cut_video_id, phrase_id, format, hook, url, posted_at, views, saves, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, req.user.id, f.network, f.cut_video_id, f.phrase_id, f.format, f.hook, f.url, f.posted_at, f.views, f.saves, now()).lastInsertRowid;
    res.status(201).json(postView(get('SELECT * FROM cockpit_posts WHERE id = ?', id)));
  });
  app.patch('/api/cockpit/posts/:id', requireUser, member, (req, res) => {
    const p = ownPost(req), f = postFields(req.body, req.user.id, p);
    run(`UPDATE cockpit_posts SET network = ?, cut_video_id = ?, phrase_id = ?, format = ?, hook = ?, url = ?, posted_at = ?, views = ?, saves = ? WHERE id = ?`,
      f.network, f.cut_video_id, f.phrase_id, f.format, f.hook, f.url, f.posted_at, f.views, f.saves, p.id);
    res.json(postView(get('SELECT * FROM cockpit_posts WHERE id = ?', p.id)));
  });
  app.delete('/api/cockpit/posts/:id', requireUser, member, (req, res) => {
    run('DELETE FROM cockpit_posts WHERE id = ?', ownPost(req).id);
    res.json({ ok: true });
  });
  // « J'ai répondu aux commentaires » : coché ou décoché pour un jour.
  app.put('/api/cockpit/days/:day', requireUser, member, (req, res) => {
    const day = String(req.params.day);
    if (!DAY_RE.test(day)) throw new HttpError(400, 'Jour invalide.');
    if (req.body?.replies === true) run('INSERT OR IGNORE INTO cockpit_days (user_id, day) VALUES (?, ?)', req.user.id, day);
    else run('DELETE FROM cockpit_days WHERE user_id = ? AND day = ?', req.user.id, day);
    res.json({ day, replies: req.body?.replies === true });
  });
  app.post('/api/cockpit/phrases', requireUser, member, (req, res) => {
    const title = text(req.body?.title, 100), phrase = text(req.body?.text, 300);
    if (!title || !phrase) throw new HttpError(400, 'Le titre et la phrase sont attendus.');
    if (get('SELECT COUNT(*) AS n FROM cockpit_phrases WHERE user_id = ?', req.user.id).n >= 2000) throw new HttpError(400, 'Deux mille phrases au plus.');
    const id = run('INSERT INTO cockpit_phrases (user_id, title, text, created_at) VALUES (?, ?, ?, ?)', req.user.id, title, phrase, now()).lastInsertRowid;
    res.status(201).json({ id: Number(id), title, text: phrase, uses: 0, lastUsed: null, best: null });
  });
  // Une phrase retirée : les publications qui l'utilisaient restent, sans phrase.
  app.delete('/api/cockpit/phrases/:id', requireUser, member, (req, res) => {
    const ph = get('SELECT id FROM cockpit_phrases WHERE id = ? AND user_id = ?', Number(req.params.id) || 0, req.user.id);
    if (!ph) throw new HttpError(404, 'Phrase introuvable.');
    run('UPDATE cockpit_posts SET phrase_id = NULL WHERE phrase_id = ?', ph.id);
    run('DELETE FROM cockpit_phrases WHERE id = ?', ph.id);
    res.json({ ok: true });
  });
}
