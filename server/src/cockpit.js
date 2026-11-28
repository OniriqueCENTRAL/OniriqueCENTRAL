// COCKPIT (site/cockpit) : la mémoire de la promo des membres ONIRIQUE. Le journal de ce qui est publié (réseau, vidéo du
// cloud CUT, phrase des paroles, format, accroche), les chiffres relevés à 48 h (vues, enregistrements), la banque de
// phrases par titre, le minimum quotidien qui colore le calendrier, les modes de la semaine (Normal, Sortie, Réduit, Pause),
// les points, le joker et le rattrapage, l'analyse de ce qui marche (formats, titres, heures, accroches), l'usure d'un
// format, le plan de la semaine, les sorties (S-3 à S+4), l'audience, les contacts, le radar des films et les bilans.
// Tout se mesure en actions, jamais en vues espérées ; les chiffres d'analyse disent quand ils sont trop peu nombreux.
import { db, get, all, run, now } from './db.js';
import { HttpError } from './auth.js';
import { localNow } from './cut.js';
import { push } from './push.js';

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
// La semaine (son lundi) : le mode choisi, le joker posé, le bilan du lundi fait, le stock vu en dernier (pour ses points).
db.exec(`CREATE TABLE IF NOT EXISTS cockpit_weeks (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week      TEXT NOT NULL,
  mode      TEXT,
  joker_day TEXT,
  reviewed  INTEGER NOT NULL DEFAULT 0,
  stock_end INTEGER,
  PRIMARY KEY (user_id, week)
)`);
// Le bilan du soir : la vidéo qui a le mieux marché et pourquoi, une leçon.
db.exec(`CREATE TABLE IF NOT EXISTS cockpit_evenings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  best    TEXT NOT NULL DEFAULT '',
  lesson  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, day)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS cockpit_releases (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  day        TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS cockpit_audience (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,
  spotify   INTEGER,
  tiktok    INTEGER,
  instagram INTEGER,
  youtube   INTEGER,
  PRIMARY KEY (user_id, day)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS cockpit_contacts (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'à contacter',
  last_contact TEXT,
  next_action  TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
)`);
// Le radar : les sorties de films, séries ou jeux autour desquelles préparer des répliques.
db.exec(`CREATE TABLE IF NOT EXISTS cockpit_events (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  day        TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
)`);
// Les rappels déjà envoyés (un par sorte et par jour).
db.exec(`CREATE TABLE IF NOT EXISTS cockpit_alerts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,
  day     TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, day)
)`);

export const NETWORKS = ['tiktok', 'instagram', 'youtube'];
export const MODES = {
  normal: { label: 'Normal', perDay: 2, perWeek: 14 },
  sortie: { label: 'Sortie', perDay: 3, perWeek: 20 },
  reduit: { label: 'Réduit', perDay: 1, perWeek: 7 },
  pause: { label: 'Pause annoncée', perDay: 0, perWeek: 0 },
};
export const TARGETS = { tiktoksPerDay: 2, tiktoksPerWeek: 14, producedPerWeek: 18, stockMin: 2, hooksPerWeek: 3, weekKept: 110, weekMax: 151, reliable: 5 };
export const LEVELS = [50, 100, 200, 374]; // 374 : les vidéos TikTok de Priilick en 10 mois
export const CONTACT_STATUSES = ['à contacter', 'en discussion', 'en cours', 'fait'];
// Les semaines d'une sortie, autour de sa semaine S0 : objectif de vidéos de ce titre et ce qu'on y fait.
export const RELEASE_PLAN = [
  { s: -3, target: 6, todo: 'Extrait « ça sort ou pas ? », 3 accroches différentes' },
  { s: -2, target: 8, todo: 'Les 2 meilleures accroches sur 4 habillages chacune ; annonce de la date' },
  { s: -1, target: 6, todo: 'Pré-sauvegarde, coulisses du studio, une prise de parole' },
  { s: 0, target: 7, todo: '« Dispo partout » + les 3 meilleures vidéos reprises avec la mention' },
  { s: 1, target: 3, todo: 'Recyclage des gagnantes tant que la médiane tient' },
  { s: 2, target: 3, todo: 'Recyclage, Reels et Shorts' },
  { s: 3, target: 3, todo: 'Recyclage, nouvelle accroche sur la meilleure vidéo' },
  { s: 4, target: 3, todo: 'Le titre rejoint le catalogue' },
];
export const CANDIDATES = ['Réplique → drop', 'Univers visuel en série', 'Le son naît dans ONIRIQUE'];
const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const SPEAK = ['L’histoire d’une phrase', 'Réponse à un commentaire'].map(norm); // les formats qui sont une prise de parole
const BORROWED = ['Réplique → drop', 'Remix d’un thème connu'].map(norm); // les œuvres des autres : un tiers au plus
const DAY = 86_400_000;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const shift = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const monday = (day) => shift(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7));
const weeksBetween = (a, b) => Math.round((Date.parse(monday(b)) - Date.parse(monday(a))) / (7 * DAY)); // semaines de a à b
const zone = (tz) => { try { new Intl.DateTimeFormat('fr', { timeZone: String(tz) }); return String(tz); } catch { return 'Europe/Paris'; } };
export const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const rate = (p) => (p.views >= 100 && p.saves != null ? Math.round((p.saves * 1000) / p.views) : null); // enregistrements pour 1 000 vues

/** La couleur d'une journée : 'ok' quand le minimum est fait, 'part' quand une partie l'est, 'none' sinon. */
export function dayStatus({ tiktoks, replies, missingStats, perDay = TARGETS.tiktoksPerDay }) {
  if (tiktoks >= perDay && replies && missingStats === 0) return 'ok';
  return tiktoks > 0 || replies ? 'part' : 'none';
}

/** Les points d'une semaine (151 au plus ; tenue à 110). */
export function weekPoints({ daysOk, produced, newHooks, spoke, reviewed, stockOk }) {
  const parts = { days: Math.min(7, daysOk) * 10, produced: Math.min(TARGETS.producedPerWeek, produced) * 2, hooks: Math.min(TARGETS.hooksPerWeek, newHooks) * 5,
    spoke: spoke ? 10 : 0, reviewed: reviewed ? 10 : 0, stock: stockOk ? 10 : 0 };
  return { parts, total: Object.values(parts).reduce((s, x) => s + x, 0) };
}

const hourBand = (h) => (h < 6 || h >= 23 ? 'Nuit (23 h–6 h)' : h < 12 ? 'Matin (6 h–12 h)' : h < 15 ? 'Midi (12 h–15 h)' : h < 19 ? 'Après-midi (15 h–19 h)' : 'Soir (19 h–23 h)');
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
/** Ce qui marche : médianes des vues et des enregistrements pour 1 000 vues, par format, titre, réseau, heure, jour, accroche.
 *  measured = publications dont les vues sont notées, chacune avec day, hour, title et text. */
export function analysisOf(measured) {
  const group = (keyOf) => {
    const groups = new Map();
    for (const p of measured) { const k = keyOf(p); if (!k) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    return [...groups].map(([key, ps]) => ({ key, n: ps.length, views: median(ps.map((p) => p.views)), rate: median(ps.map(rate)), reliable: ps.length >= TARGETS.reliable }))
      .sort((a, b) => (b.reliable - a.reliable) || ((b.rate ?? -1) - (a.rate ?? -1)) || (b.views - a.views));
  };
  // Les tests d'accroches : une même phrase publiée avec au moins deux accroches différentes.
  const byPhrase = new Map();
  for (const p of measured) {
    if (!p.phrase_id || !p.hook) continue;
    if (!byPhrase.has(p.phrase_id)) byPhrase.set(p.phrase_id, { phraseId: p.phrase_id, title: p.title, text: p.text, posts: [] });
    byPhrase.get(p.phrase_id).posts.push(p);
  }
  const hooks = [...byPhrase.values()].map((g) => {
    const byHook = new Map();
    for (const p of g.posts) { const k = norm(p.hook); if (!byHook.has(k)) byHook.set(k, { hook: p.hook, ps: [] }); byHook.get(k).ps.push(p); }
    const tests = [...byHook.values()].map((h) => ({ hook: h.hook, n: h.ps.length, views: median(h.ps.map((p) => p.views)), rate: median(h.ps.map(rate)) }))
      .sort((a, b) => ((b.rate ?? -1) - (a.rate ?? -1)) || (b.views - a.views));
    return { phraseId: g.phraseId, title: g.title, text: g.text, tests };
  }).filter((g) => g.tests.length >= 2);
  return {
    baseline: { n: measured.length, views: median(measured.map((p) => p.views)), rate: median(measured.map(rate)) },
    byFormat: group((p) => p.format), byTitle: group((p) => p.title), byNetwork: group((p) => p.network),
    byHour: group((p) => hourBand(p.hour)), byWeekday: group((p) => WEEKDAYS[(new Date(p.day + 'T12:00:00Z').getUTCDay() + 6) % 7]),
    months: group((p) => p.day.slice(0, 7)).sort((a, b) => (a.key < b.key ? -1 : 1)),
    hooks,
  };
}

/** L'usure : un format dont la médiane des 5 dernières vidéos tombe sous la moitié de sa meilleure série de 5. */
export function wearOf(measured) {
  const byFormat = new Map();
  for (const p of [...measured].sort((a, b) => a.posted_at - b.posted_at)) { if (!p.format) continue; if (!byFormat.has(p.format)) byFormat.set(p.format, []); byFormat.get(p.format).push(p.views); }
  const alerts = [];
  for (const [format, views] of byFormat) {
    if (views.length < 10) continue;
    let best = 0;
    for (let i = 0; i + 5 <= views.length; i++) best = Math.max(best, median(views.slice(i, i + 5)));
    const last = median(views.slice(-5));
    if (last < best / 2) alerts.push({ format, best, now: last, n: views.length });
  }
  return alerts;
}

/** Le plan des jours qui restent dans la semaine : pour chaque publication prévue, une phrase et un format.
 *  Règles du dossier : une gagnante, puis un test ; jamais la même phrase deux jours de suite ; au plus 40 % sur un format
 *  et un tiers d'œuvres empruntées ; pendant une sortie, une publication sur deux sur son titre. */
export function planWeek({ today, perDay, postedToday = 0, phrases, formats, releaseTitle = null }) {
  const days = [];
  for (let d = today; d <= shift(monday(today), 6); d = shift(d, 1)) days.push({ day: d, slots: Math.max(0, perDay - (d === today ? postedToday : 0)) });
  const total = days.reduce((s, d) => s + d.slots, 0);
  if (!total) return { items: [], formats: [] };
  // Les formats : les 3 meilleurs mesurés (5 vidéos au moins), complétés par les 3 formats-candidats du dossier.
  const top = formats.filter((f) => f.reliable).slice(0, 3).map((f) => f.key);
  for (const c of CANDIDATES) if (top.length < 3 && !top.some((f) => norm(f) === norm(c))) top.push(c);
  const weights = [0.4, 0.35, 0.25], cap = Math.ceil(total * 0.4), isBorrowed = (f) => BORROWED.includes(norm(f));
  // Les formats-candidats à soi s'ajoutent en réserve, pour recevoir ce que les œuvres empruntées n'ont pas le droit de prendre.
  const list = [...top, ...CANDIDATES.filter((c) => !isBorrowed(c) && !top.some((f) => norm(f) === norm(c)))];
  const counts = list.map((_, i) => (i < top.length ? Math.floor(total * weights[i]) : 0));
  for (let i = 0; counts.reduce((s, x) => s + x, 0) < total; i = (i + 1) % top.length) counts[i]++;
  // Un tiers au plus d'œuvres empruntées : le surplus passe aux formats à soi, chacun jusqu'à 40 %.
  let surplus = Math.max(0, list.reduce((s, f, i) => s + (isBorrowed(f) ? counts[i] : 0), 0) - Math.floor(total / 3));
  for (let i = list.length - 1; i >= 0 && surplus > 0; i--) if (isBorrowed(list[i])) { const cut = Math.min(counts[i], surplus); counts[i] -= cut; surplus -= cut; }
  const own = list.map((f, i) => (isBorrowed(f) ? -1 : i)).filter((i) => i >= 0);
  // Les places libérées vont aux formats à soi les moins remplis ; au-delà de 40 % seulement s'il n'y a pas d'autre choix.
  for (let missing = total - counts.reduce((s, x) => s + x, 0); missing > 0 && own.length; missing--) {
    const room = own.filter((i) => counts[i] < cap), pool = room.length ? room : own;
    counts[pool.reduce((a, b) => (counts[b] < counts[a] ? b : a))]++;
  }
  const sequence = [], left = [...counts];
  for (let k = 0; k < total; k++) { const i = left.indexOf(Math.max(...left)); sequence.push(list[i]); left[i]--; }
  // Les phrases : gagnantes (meilleur taux) et tests (jamais utilisées, puis les plus anciennes).
  const winners = phrases.filter((p) => p.best != null).sort((a, b) => b.best - a.best);
  const tests = [...phrases].sort((a, b) => (a.uses > 0) - (b.uses > 0) || (a.lastUsed || 0) - (b.lastUsed || 0));
  const release = releaseTitle ? phrases.filter((p) => norm(p.title) === norm(releaseTitle)) : [];
  const used = new Map(); // phrase → dernier jour prévu
  const pick = (list, day) => list.find((p) => used.get(p.id) !== shift(day, -1) && used.get(p.id) !== day) || list.find((p) => used.get(p.id) !== day) || null;
  const items = [];
  let k = 0;
  for (const { day, slots } of days) {
    for (let s = 0; s < slots; s++, k++) {
      let phrase = null, why = '';
      if (release.length && k % 2 === 0) { phrase = pick(release, day); why = phrase ? 'sortie de ' + releaseTitle : ''; }
      if (!phrase && k % 2 === 0 && winners.length) { phrase = pick(winners, day); why = phrase ? `gagnante (${Math.round(phrase.best)} pour 1 000)` : ''; }
      if (!phrase) { phrase = pick(tests, day); why = phrase ? (phrase.uses ? 'la moins utilisée récemment' : 'jamais testée') : ''; }
      if (phrase) used.set(phrase.id, day);
      items.push({ day, format: sequence[k], phraseId: phrase ? phrase.id : null, title: phrase ? phrase.title : null, text: phrase ? phrase.text : null, why: why || 'ajoute des phrases à la banque' });
    }
  }
  return { items, formats: list.map((f, i) => ({ format: f, count: counts[i] })).filter((f) => f.count > 0) };
}

/** Les vidéos du cloud CUT pas encore postées sur TikTok : le stock d'avance. */
export const stockOf = (userId) => get(`SELECT COUNT(*) AS n FROM cut_videos v WHERE v.user_id = ?
  AND NOT EXISTS (SELECT 1 FROM cockpit_posts p WHERE p.user_id = v.user_id AND p.cut_video_id = v.id AND p.network = 'tiktok')`, userId).n;

const postView = (p) => ({ id: p.id, network: p.network, cutVideoId: p.cut_video_id, phraseId: p.phrase_id, format: p.format, hook: p.hook, url: p.url,
  postedAt: p.posted_at, views: p.views, saves: p.saves, rate: rate(p) });

/** Tout ce que montre la page, vu depuis le fuseau tz. */
export function cockpitOf(userId, tz, at = now()) {
  tz = zone(tz);
  const local = (ms) => localNow(ms, tz), today = local(at).day, thisWeek = monday(today), start = shift(thisWeek, -49);
  const phraseRows = all('SELECT * FROM cockpit_phrases WHERE user_id = ? ORDER BY title COLLATE NOCASE, id', userId);
  const phraseById = new Map(phraseRows.map((p) => [p.id, p]));
  const posts = all('SELECT * FROM cockpit_posts WHERE user_id = ? ORDER BY posted_at DESC LIMIT 5000', userId).map((p) => {
    const l = local(p.posted_at), ph = phraseById.get(p.phrase_id);
    return { ...p, day: l.day, hour: Math.floor(l.minutes / 60), title: ph ? ph.title : null, text: ph ? ph.text : null };
  });
  const byDay = new Map();
  for (const p of posts) { if (!byDay.has(p.day)) byDay.set(p.day, []); byDay.get(p.day).push(p); }
  const tiktoksOn = (d) => (byDay.get(d) || []).filter((p) => p.network === 'tiktok').length;
  const replied = new Set(all('SELECT day FROM cockpit_days WHERE user_id = ? AND day >= ?', userId, shift(start, -7)).map((r) => r.day));
  const weekRows = new Map(all('SELECT * FROM cockpit_weeks WHERE user_id = ?', userId).map((w) => [w.week, w]));
  const releases = all('SELECT * FROM cockpit_releases WHERE user_id = ? ORDER BY day', userId);
  const releaseOf = (week) => releases.find((r) => { const s = weeksBetween(r.day, week); return s >= -3 && s <= 0; }) || null;
  const modeOf = (week) => weekRows.get(week)?.mode || (releaseOf(week) ? 'sortie' : 'normal');
  const videos = all('SELECT created_at FROM cut_videos WHERE user_id = ? AND created_at >= ?', userId, at - 70 * DAY).map((v) => local(v.created_at).day);
  const stock = stockOf(userId);
  // Le premier jour où chaque accroche a servi (pour compter les accroches nouvelles de la semaine).
  const firstHook = new Map();
  for (const p of [...posts].reverse()) if (p.hook && !firstHook.has(norm(p.hook))) firstHook.set(norm(p.hook), p.day);

  const entry = (d, perDay, joker) => {
    const tiktoks = tiktoksOn(d), replies = replied.has(d), missingStats = (byDay.get(shift(d, -2)) || []).filter((p) => p.views == null).length;
    const status = d > today ? 'future' : perDay === 0 ? 'pause' : joker === d ? 'joker' : dayStatus({ tiktoks, replies, missingStats, perDay });
    return { day: d, tiktoks, replies, missingStats, perDay, status, caught: false };
  };
  const weekOf = (week, mode) => {
    const row = weekRows.get(week) || {}, end = shift(week, 6), perDay = MODES[mode].perDay;
    const days = Array.from({ length: 7 }, (_, i) => entry(shift(week, i), perDay, row.joker_day));
    const past = days.filter((e) => e.status !== 'future'), inWeek = (d) => d >= week && d <= end;
    const daysOk = past.filter((e) => ['ok', 'joker', 'pause'].includes(e.status)).length;
    const newHooks = [...firstHook.values()].filter(inWeek).length;
    const spoke = posts.some((p) => inWeek(p.day) && SPEAK.includes(norm(p.format)));
    const stockEnd = week === thisWeek ? stock : row.stock_end;
    const produced = videos.filter(inWeek).length;
    const points = weekPoints({ daysOk, produced, newHooks, spoke, reviewed: !!row.reviewed, stockOk: stockEnd != null && stockEnd >= TARGETS.stockMin });
    return { week, mode, label: MODES[mode].label, perDay, perWeek: MODES[mode].perWeek, days, tiktoks: past.reduce((s, e) => s + e.tiktoks, 0),
      daysOk, daysPast: past.length, produced, newHooks, spoke, reviewed: !!row.reviewed, joker: row.joker_day || null, points: points.total, parts: points.parts };
  };
  // Mode Réduit automatique : deux semaines d'affilée sous 110 points (après 3 semaines de journal), sauf mode choisi.
  let mode = modeOf(thisWeek), autoReduced = false;
  const oldest = posts.length ? posts.at(-1).day : today;
  if (!weekRows.get(thisWeek)?.mode && mode === 'normal' && oldest <= shift(thisWeek, -14)) {
    const low = [-7, -14].every((k) => { const w = shift(thisWeek, k); return weekOf(w, modeOf(w)).points < TARGETS.weekKept; });
    if (low) { mode = 'reduit'; autoReduced = true; }
  }
  const weeks = Array.from({ length: 8 }, (_, i) => { const w = shift(start, i * 7); return weekOf(w, w === thisWeek ? mode : modeOf(w)); });
  const current = weeks.at(-1), todayEntry = current.days.find((d) => d.day === today), allDays = weeks.flatMap((w) => w.days);
  // Rattrapage : un jour manqué redevient « en partie » si ses publications sont faites dans les 48 h, en plus de celles de
  // ces jours-là. Chaque publication en trop ne rattrape qu'un jour (le plus récent d'abord).
  const usedSurplus = new Map(), dayIndex = new Map(allDays.map((e) => [e.day, e]));
  for (const e of [...allDays].reverse()) {
    if (e.status !== 'none' || e.day >= today) continue;
    let need = e.perDay - e.tiktoks;
    for (const k of [1, 2]) {
      const next = dayIndex.get(shift(e.day, k));
      if (!next || next.status === 'future' || need <= 0) continue;
      const take = Math.min(need, Math.max(0, next.tiktoks - next.perDay - (usedSurplus.get(next.day) || 0)));
      usedSurplus.set(next.day, (usedSurplus.get(next.day) || 0) + take);
      need -= take;
    }
    if (need <= 0) { e.status = 'part'; e.caught = true; }
  }

  const usage = new Map();
  for (const p of posts) {
    if (!p.phrase_id) continue;
    const u = usage.get(p.phrase_id) || { n: 0, last: 0, best: null };
    u.n++; u.last = Math.max(u.last, p.posted_at);
    const r = rate(p); if (r != null) u.best = Math.max(u.best ?? 0, r);
    usage.set(p.phrase_id, u);
  }
  const phrases = phraseRows.map((ph) => { const u = usage.get(ph.id); return { id: ph.id, title: ph.title, text: ph.text, uses: u ? u.n : 0, lastUsed: u ? u.last : null, best: u ? u.best : null }; });
  const measured = posts.filter((p) => p.views != null);
  const analysis = analysisOf(measured), wear = wearOf(measured);
  const release = releaseOf(thisWeek);
  const plan = planWeek({ today, perDay: MODES[mode].perDay, postedToday: todayEntry.tiktoks, phrases, formats: analysis.byFormat, releaseTitle: release ? release.title : null });

  const releasesView = releases.map((r) => ({ id: r.id, title: r.title, day: r.day, weeks: RELEASE_PLAN.map((step) => {
    const week = shift(monday(r.day), step.s * 7), end = shift(week, 6);
    const done = posts.filter((p) => p.day >= week && p.day <= end && norm(p.title) === norm(r.title)).length;
    return { ...step, week, done, current: week === thisWeek, past: end < today };
  }) }));
  const audience = all('SELECT day, spotify, tiktok, instagram, youtube FROM cockpit_audience WHERE user_id = ? ORDER BY day', userId);
  const contacts = all("SELECT * FROM cockpit_contacts WHERE user_id = ? ORDER BY (status = 'fait'), COALESCE(last_contact, ''), name COLLATE NOCASE", userId).map((c) => ({
    id: c.id, name: c.name, role: c.role, status: c.status, lastContact: c.last_contact, nextAction: c.next_action,
    overdue: c.status !== 'fait' && (!c.last_contact || c.last_contact < shift(today, -30)) }));
  const events = all('SELECT * FROM cockpit_events WHERE user_id = ? AND day >= ? ORDER BY day', userId, shift(today, -7)).map((e) => ({ id: e.id, title: e.title, day: e.day, note: e.note,
    inDays: Math.round((Date.parse(e.day) - Date.parse(today)) / DAY) }));
  const evenings = all('SELECT * FROM cockpit_evenings WHERE user_id = ? ORDER BY day DESC LIMIT 14', userId);
  const toFill = posts.filter((p) => p.views == null && p.posted_at <= at - 2 * DAY).reverse().map(postView);
  const tiktokTotal = posts.filter((p) => p.network === 'tiktok').length;

  // Les alertes du jour, de la plus urgente à la moins urgente.
  const alerts = [], dayAt = (d) => allDays.find((e) => e.day === d);
  const missed1 = dayAt(shift(today, -1))?.status === 'none', missed2 = dayAt(shift(today, -2))?.status === 'none';
  if (missed1 && posts.length) alerts.push({ level: missed2 ? 'high' : 'mid',
    text: missed2 ? 'Deux jours manqués : aujourd’hui, seulement le minimum, rien d’autre.' : 'Hier manqué : rattrape-le dans les 48 h (ses publications en plus de celles du jour).' });
  if (stock < TARGETS.stockMin) alerts.push({ level: 'high', text: `Stock à ${stock} : la prochaine séance de montage passe avant tout le reste.` });
  if (autoReduced) alerts.push({ level: 'mid', text: 'Deux semaines sous 110 points : mode Réduit cette semaine (1 TikTok par jour). On baisse la cible au lieu d’abandonner.' });
  for (const w of wear) alerts.push({ level: 'mid', text: `Usure : « ${w.format} » est passé de ${Math.round(w.best).toLocaleString('fr-FR')} à ${Math.round(w.now).toLocaleString('fr-FR')} vues médianes. Garde-le en appoint et relance 2 formats-candidats.` });
  if (toFill.length) alerts.push({ level: 'low', text: `${toFill.length} vidéo${toFill.length > 1 ? 's attendent leurs' : ' attend ses'} chiffres à 48 h.` });
  if (today === thisWeek && !current.reviewed) alerts.push({ level: 'mid', text: 'Lundi : fais le bilan de la semaine (onglet Semaine).' });
  if (!audience.some((a) => a.day >= thisWeek)) alerts.push({ level: 'low', text: 'Note tes chiffres d’audience de la semaine (onglet Audience).' });
  for (const e of events) if (e.inDays >= 0 && e.inDays <= 7) alerts.push({ level: 'low', text: `Radar : « ${e.title} » ${e.inDays === 0 ? 'sort aujourd’hui' : `sort dans ${e.inDays} jour${e.inDays > 1 ? 's' : ''}`}, prépare tes répliques.` });
  const overdue = contacts.filter((c) => c.overdue).length;
  if (overdue) alerts.push({ level: 'low', text: `${overdue} contact${overdue > 1 ? 's' : ''} à relancer (plus de 30 jours).` });

  return {
    tz, today: todayEntry, mode: { key: mode, ...MODES[mode], auto: autoReduced }, modes: MODES, targets: TARGETS, stock, alerts,
    week: current, weeks: weeks.map(({ days, ...w }) => w), calendar: allDays,
    level: { count: tiktokTotal, levels: LEVELS, next: LEVELS.find((l) => l > tiktokTotal) || null },
    plan, release: release ? { title: release.title, day: release.day, s: weeksBetween(release.day, thisWeek) } : null,
    analysis, wear, toFill, posts: posts.slice(0, 150).map(postView), phrases, releases: releasesView, releasePlan: RELEASE_PLAN,
    audience, contacts, contactStatuses: CONTACT_STATUSES, events, evenings: evenings.map((e) => ({ day: e.day, best: e.best, lesson: e.lesson })),
  };
}

/** Les rappels du Cockpit (vérifiés chaque minute), pour qui a réglé son rappel CUT (on connaît alors son fuseau) :
 *  à 13 h si rien n'est publié, à 21 h si le minimum n'est pas fait, le lundi à 10 h pour le bilan. Une fois par jour chacun. */
export function remindCockpit(at = now()) {
  const sent = [];
  for (const r of all("SELECT r.user_id, r.tz FROM cut_reminders r JOIN users u ON u.id = r.user_id WHERE u.role IN ('vip', 'beta', 'betaf', 'admin', 'founder')")) {
    const { day, minutes } = localNow(at, r.tz), hour = Math.floor(minutes / 60);
    const kind = hour === 13 ? 'midi' : hour === 21 ? 'soir' : hour === 10 && monday(day) === day ? 'lundi' : null;
    if (!kind || get('SELECT 1 FROM cockpit_alerts WHERE user_id = ? AND kind = ? AND day = ?', r.user_id, kind, day)) continue;
    run('INSERT OR IGNORE INTO cockpit_alerts (user_id, kind, day) VALUES (?, ?, ?)', r.user_id, kind, day);
    const c = cockpitOf(r.user_id, r.tz, at);
    let body = null;
    if (kind === 'midi' && c.today.tiktoks === 0 && c.mode.perDay > 0) body = `Rien de publié aujourd'hui : ${c.mode.perDay} TikTok t'attendent (stock : ${c.stock}).`;
    if (kind === 'soir' && !['ok', 'pause', 'joker'].includes(c.today.status)) {
      const left = [c.today.tiktoks < c.mode.perDay && `${c.today.tiktoks}/${c.mode.perDay} TikTok`, !c.today.replies && 'les commentaires', c.today.missingStats > 0 && 'les chiffres à 48 h'].filter(Boolean);
      body = `Minimum pas encore fait : ${left.join(', ')}.` + (c.calendar.find((d) => d.day === shift(day, -1))?.status === 'none' ? ' Jamais deux jours de suite.' : '');
    }
    if (kind === 'lundi') body = `Bilan du lundi : ${c.weeks.at(-2).points} points la semaine dernière (tenue à 110). Choisis le mode de la semaine.`;
    if (!body) continue;
    push(r.user_id, { title: 'ONIRIQUE COCKPIT', body, url: '/cockpit' });
    sent.push({ userId: r.user_id, kind });
  }
  return sent;
}

const text = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max) : '');
const count = (value, label) => {
  if (value === null || value === '' || value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1e10) throw new HttpError(400, `${label} : un nombre entier attendu.`);
  return n;
};
const dayOrNull = (value, label) => {
  if (value === null || value === undefined || value === '') return null;
  if (!DAY_RE.test(String(value))) throw new HttpError(400, `${label} : jour invalide.`);
  return String(value);
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
// Une cellule CSV : entre guillemets si besoin ; une formule (= + - @) est désamorcée pour le tableur.
export const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function mountCockpit(app, { requireUser }) {
  const member = (req, _res, next) => (['vip', 'beta', 'betaf', 'admin', 'founder'].includes(req.user.role) ? next()
    : next(new HttpError(403, 'Le Cockpit est réservé aux membres ONIRIQUE.')));
  const own = (table, label) => (req) => {
    const row = get(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`, Number(req.params.id) || 0, req.user.id);
    if (!row) throw new HttpError(404, `${label} introuvable.`);
    return row;
  };
  const ownPost = own('cockpit_posts', 'Publication'), ownContact = own('cockpit_contacts', 'Contact');
  const limit = (table, userId, max, label) => { if (get(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, userId).n >= max) throw new HttpError(400, `${label} : ${max} au plus.`); };
  const dayParam = (req) => { const day = dayOrNull(req.params.day, 'Jour'); if (!day) throw new HttpError(400, 'Jour invalide.'); return day; };

  app.get('/api/cockpit', requireUser, member, (req, res) => {
    const c = cockpitOf(req.user.id, req.query.tz);
    // Le stock vu en dernier pendant la semaine compte pour ses points, une fois la semaine passée.
    run('INSERT INTO cockpit_weeks (user_id, week, stock_end) VALUES (?, ?, ?) ON CONFLICT (user_id, week) DO UPDATE SET stock_end = excluded.stock_end', req.user.id, c.week.week, c.stock);
    res.json(c);
  });
  // Le journal en CSV (pour un tableur) : séparateur « ; », comme Excel en français.
  app.get('/api/cockpit/export.csv', requireUser, member, (req, res) => {
    const phrases = new Map(all('SELECT id, title, text FROM cockpit_phrases WHERE user_id = ?', req.user.id).map((p) => [p.id, p]));
    const rows = all('SELECT * FROM cockpit_posts WHERE user_id = ? ORDER BY posted_at', req.user.id);
    const lines = [['date', 'réseau', 'titre', 'phrase', 'format', 'accroche', 'lien', 'vues', 'enregistrements', 'pour 1000 vues']]
      .concat(rows.map((p) => [new Date(p.posted_at).toISOString(), p.network, phrases.get(p.phrase_id)?.title, phrases.get(p.phrase_id)?.text, p.format, p.hook, p.url, p.views, p.saves, rate(p)]));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="cockpit-journal.csv"' });
    res.send('﻿' + lines.map((l) => l.map(csvCell).join(';')).join('\r\n'));
  });

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
    const day = dayParam(req);
    if (req.body?.replies === true) run('INSERT OR IGNORE INTO cockpit_days (user_id, day) VALUES (?, ?)', req.user.id, day);
    else run('DELETE FROM cockpit_days WHERE user_id = ? AND day = ?', req.user.id, day);
    res.json({ day, replies: req.body?.replies === true });
  });
  // La semaine : le mode (null : celui par défaut), le joker (un jour de la semaine, ou null), le bilan du lundi fait.
  app.put('/api/cockpit/weeks/:day', requireUser, member, (req, res) => {
    const week = dayParam(req);
    if (monday(week) !== week) throw new HttpError(400, 'Une semaine se désigne par son lundi.');
    const row = get('SELECT * FROM cockpit_weeks WHERE user_id = ? AND week = ?', req.user.id, week) || {};
    const body = req.body || {};
    const mode = Object.hasOwn(body, 'mode') ? body.mode ?? null : row.mode ?? null;
    if (mode !== null && !Object.hasOwn(MODES, mode)) throw new HttpError(400, 'Mode inconnu.');
    if (mode === 'pause' && row.mode !== 'pause' && get(`SELECT 1 FROM cockpit_weeks WHERE user_id = ? AND mode = 'pause' AND week != ? AND week > ?`, req.user.id, week, shift(week, -84))) {
      throw new HttpError(400, 'Une seule semaine de pause par trimestre : la dernière date de moins de 12 semaines.');
    }
    const joker = Object.hasOwn(body, 'joker') ? dayOrNull(body.joker, 'Joker') : row.joker_day ?? null;
    if (joker && (joker < week || joker > shift(week, 6))) throw new HttpError(400, 'Le joker se pose sur un jour de cette semaine.');
    const reviewed = Object.hasOwn(body, 'reviewed') ? (body.reviewed ? 1 : 0) : row.reviewed ?? 0;
    run(`INSERT INTO cockpit_weeks (user_id, week, mode, joker_day, reviewed) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, week) DO UPDATE SET mode = excluded.mode, joker_day = excluded.joker_day, reviewed = excluded.reviewed`, req.user.id, week, mode, joker, reviewed);
    res.json({ week, mode, joker, reviewed: !!reviewed });
  });
  app.put('/api/cockpit/evenings/:day', requireUser, member, (req, res) => {
    const day = dayParam(req), best = text(req.body?.best, 500), lesson = text(req.body?.lesson, 500);
    run('INSERT INTO cockpit_evenings (user_id, day, best, lesson) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, day) DO UPDATE SET best = excluded.best, lesson = excluded.lesson', req.user.id, day, best, lesson);
    res.json({ day, best, lesson });
  });

  app.post('/api/cockpit/phrases', requireUser, member, (req, res) => {
    const title = text(req.body?.title, 100), phrase = text(req.body?.text, 300);
    if (!title || !phrase) throw new HttpError(400, 'Le titre et la phrase sont attendus.');
    limit('cockpit_phrases', req.user.id, 2000, 'Phrases');
    const id = run('INSERT INTO cockpit_phrases (user_id, title, text, created_at) VALUES (?, ?, ?, ?)', req.user.id, title, phrase, now()).lastInsertRowid;
    res.status(201).json({ id: Number(id), title, text: phrase, uses: 0, lastUsed: null, best: null });
  });
  // Une phrase retirée : les publications qui l'utilisaient restent, sans phrase.
  app.delete('/api/cockpit/phrases/:id', requireUser, member, (req, res) => {
    const ph = own('cockpit_phrases', 'Phrase')(req);
    run('UPDATE cockpit_posts SET phrase_id = NULL WHERE phrase_id = ?', ph.id);
    run('DELETE FROM cockpit_phrases WHERE id = ?', ph.id);
    res.json({ ok: true });
  });

  app.post('/api/cockpit/releases', requireUser, member, (req, res) => {
    const title = text(req.body?.title, 100), day = dayOrNull(req.body?.day, 'Date de sortie');
    if (!title || !day) throw new HttpError(400, 'Le titre et la date de sortie sont attendus.');
    limit('cockpit_releases', req.user.id, 200, 'Sorties');
    const id = run('INSERT INTO cockpit_releases (user_id, title, day, created_at) VALUES (?, ?, ?, ?)', req.user.id, title, day, now()).lastInsertRowid;
    res.status(201).json({ id: Number(id), title, day });
  });
  app.delete('/api/cockpit/releases/:id', requireUser, member, (req, res) => {
    run('DELETE FROM cockpit_releases WHERE id = ?', own('cockpit_releases', 'Sortie')(req).id);
    res.json({ ok: true });
  });

  app.put('/api/cockpit/audience/:day', requireUser, member, (req, res) => {
    const day = dayParam(req);
    const v = { spotify: count(req.body?.spotify, 'Spotify'), tiktok: count(req.body?.tiktok, 'TikTok'), instagram: count(req.body?.instagram, 'Instagram'), youtube: count(req.body?.youtube, 'YouTube') };
    if (Object.values(v).every((x) => x == null)) throw new HttpError(400, 'Au moins un chiffre attendu.');
    run(`INSERT INTO cockpit_audience (user_id, day, spotify, tiktok, instagram, youtube) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, day) DO UPDATE SET spotify = excluded.spotify, tiktok = excluded.tiktok, instagram = excluded.instagram, youtube = excluded.youtube`, req.user.id, day, v.spotify, v.tiktok, v.instagram, v.youtube);
    res.json({ day, ...v });
  });
  app.delete('/api/cockpit/audience/:day', requireUser, member, (req, res) => {
    run('DELETE FROM cockpit_audience WHERE user_id = ? AND day = ?', req.user.id, dayParam(req));
    res.json({ ok: true });
  });

  const contactFields = (body, c = {}) => {
    const has = (k) => body && Object.hasOwn(body, k);
    const name = has('name') ? text(body.name, 100) : c.name;
    if (!name) throw new HttpError(400, 'Un nom est attendu.');
    const status = has('status') ? String(body.status) : c.status || 'à contacter';
    if (!CONTACT_STATUSES.includes(status)) throw new HttpError(400, 'Statut inconnu.');
    return { name, status, role: has('role') ? text(body.role, 100) : c.role || '', nextAction: has('nextAction') ? text(body.nextAction, 300) : c.next_action || '',
      lastContact: has('lastContact') ? dayOrNull(body.lastContact, 'Dernier contact') : c.last_contact ?? null };
  };
  app.post('/api/cockpit/contacts', requireUser, member, (req, res) => {
    limit('cockpit_contacts', req.user.id, 1000, 'Contacts');
    const f = contactFields(req.body);
    const id = run('INSERT INTO cockpit_contacts (user_id, name, role, status, last_contact, next_action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      req.user.id, f.name, f.role, f.status, f.lastContact, f.nextAction, now()).lastInsertRowid;
    res.status(201).json({ id: Number(id), ...f });
  });
  app.patch('/api/cockpit/contacts/:id', requireUser, member, (req, res) => {
    const c = ownContact(req), f = contactFields(req.body, c);
    run('UPDATE cockpit_contacts SET name = ?, role = ?, status = ?, last_contact = ?, next_action = ? WHERE id = ?', f.name, f.role, f.status, f.lastContact, f.nextAction, c.id);
    res.json({ id: c.id, ...f });
  });
  app.delete('/api/cockpit/contacts/:id', requireUser, member, (req, res) => {
    run('DELETE FROM cockpit_contacts WHERE id = ?', ownContact(req).id);
    res.json({ ok: true });
  });

  app.post('/api/cockpit/events', requireUser, member, (req, res) => {
    const title = text(req.body?.title, 120), day = dayOrNull(req.body?.day, 'Date'), note = text(req.body?.note, 300);
    if (!title || !day) throw new HttpError(400, 'Le titre et la date sont attendus.');
    limit('cockpit_events', req.user.id, 1000, 'Radar');
    const id = run('INSERT INTO cockpit_events (user_id, title, day, note, created_at) VALUES (?, ?, ?, ?, ?)', req.user.id, title, day, note, now()).lastInsertRowid;
    res.status(201).json({ id: Number(id), title, day, note });
  });
  app.delete('/api/cockpit/events/:id', requireUser, member, (req, res) => {
    run('DELETE FROM cockpit_events WHERE id = ?', own('cockpit_events', 'Événement')(req).id);
    res.json({ ok: true });
  });
}
