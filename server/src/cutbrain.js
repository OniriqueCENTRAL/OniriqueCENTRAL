// L'ARBORESCENCE DE ONIRIQUE CUT : ce qui fait un TikTok qui marche, rangé comme les étapes de CUT (le son, les clips, le
// style, le texte, l'image, le film, la publication). Comme ONR Neural Learning pour VOCALBOX (vocalbrain.js), rien n'y entre
// sans un fondateur.
//
// Elle part de la recette du dépôt (cut-brain.json) et se nourrit de trois choses :
//   - les TikToks faits sur CUT : à chaque export, les réglages du montage et son contenu (trois images réduites, le rythme
//     et l'énergie du passage, jamais le son lui-même, et les textes : réplique, paroles affichées, description, titre),
//     sans dire qui l'a fait (seulement le rôle du compte) ; les montages déjà gardés dans le cloud CUT sont repris une fois
//     (leur contenu seulement pour ceux des fondateurs) ;
//   - les corrections : un fondateur qui retouche un TikTok fait par AUTOMATIQUE puis le réexporte ; ce qu'il a changé compte
//     triple ;
//   - les leçons des fondateurs (menu « Arborescence » de CUT), qui peuvent régler une feuille tout de suite.
// Quand les TikToks penchent nettement pour un autre réglage que celui de l'arbre, c'est une proposition qu'un fondateur valide
// ou refuse. AUTOMATIQUE (CUT, fondateurs) monte un TikTok avec les réglages de l'arbre.
//
//   GET    /api/cut/learn               les réglages qu'un export envoie (les clés des feuilles)
//   POST   /api/cut/learn               un export : { kind: 'export' | 'auto', settings, auto? }
//   GET    /api/cut/brain               (fondateurs) l'arbre et ses réglages, les propositions, le journal
//   POST   /api/cut/brain/notes         (fondateurs) une leçon : { leaf, text, value?, link? }
//   DELETE /api/cut/brain/notes/:id     (fondateurs) retirer une leçon, et le réglage qu'elle avait posé
//   POST   /api/cut/brain/proposals     (fondateurs) { key, value, decision: 'approve' | 'refuse' }
//   POST   /api/cut/brain/agent         (fondateurs) demander l'avis du superviseur (cutagent.js), en arrière-plan
// Le lien TikTok d'une leçon est lu par le serveur (description, auteur, vues, j'aime, musique, couverture), pour l'arbre et le superviseur.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import sharp from 'sharp';
import { db, get, all, run, now, setting, setSetting } from './db.js';
import { HttpError, rateLimit, can } from './auth.js';
import { testing } from './mail.js';
import { runAgent, agentState, agentRunning } from './cutagent.js';
import { tiktokUrl, ytdlpCommand } from './downloader.js';

export const TREE = JSON.parse(fs.readFileSync(new URL('./cut-brain.json', import.meta.url), 'utf8'));
for (const b of TREE.branches) for (const l of b.leaves) if (l.fonts) l.options = Object.fromEntries(TREE.fonts.map((f) => [f, f]));
const LEAVES = new Map(TREE.branches.flatMap((b) => b.leaves.map((l) => [l.key, l])));

// Une proposition : assez de TikToks, et presque tous du même avis (seuils bas tant qu'il y a peu de monde : un fondateur
// valide chacune).
export const STRONG = { tiktoks: 5, agree: 0.6 };
const CORRECTION = 3;          // un réglage corrigé après AUTOMATIQUE compte pour trois TikToks
const REFUSED_DAYS = 30;       // une proposition refusée ne revient pas avant
const KEEP_YEARS = 3;          // les réglages des TikToks sont gardés trois ans au plus (les leçons restent)
const CONTENT_YEARS = 1;       // leurs images et leurs textes, un an
const THUMB_MAX = 40_000;      // une image réduite (JPEG en base64)

const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

/** La valeur d'une feuille, propre (undefined si elle ne lui va pas) : les nombres arrondis à leur pas ou à leur case. */
export function valueOf(leaf, v) {
  if (leaf.type === 'bool') return typeof v === 'boolean' ? v : undefined;
  if (leaf.type === 'color') return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined;
  if (leaf.type === 'number') {
    const n = Number(v);
    if (v === '' || v === null || !Number.isFinite(n)) return undefined;
    if (leaf.buckets) return leaf.buckets.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
    return Math.min(leaf.max, Math.max(leaf.min, Math.round(n / leaf.step) * leaf.step));
  }
  return Object.hasOwn(leaf.options, String(v)) ? String(v) : undefined;
}

/** Les seuls réglages des feuilles, propres : rien d'autre d'un montage n'arrive dans la base. */
export function cleanSettings(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, leaf] of LEAVES) {
    const v = raw[key] === undefined ? undefined : valueOf(leaf, raw[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Ce que les TikToks ont choisi, feuille par feuille : { clé: { n, w, values: { valeur JSON: poids } } }. Les TikToks
 *  d'AUTOMATIQUE ne votent pas (l'arbre ne s'apprend pas lui-même) ; une correction pèse triple. */
export function tally(rows) {
  const stats = {};
  for (const row of rows) {
    if (row.kind !== 'export' && row.kind !== 'correction') continue;
    const changed = new Set(parse(row.changed, []).map((c) => c.key));
    for (const [key, v] of Object.entries(parse(row.settings, {}))) {
      const st = stats[key] ||= { n: 0, w: 0, values: {} };
      const w = changed.has(key) ? CORRECTION : 1, id = JSON.stringify(v);
      st.n++; st.w += w; st.values[id] = (st.values[id] || 0) + w;
    }
  }
  return stats;
}

const num = (v, lo, hi) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 1000) / 1000)) : undefined; };
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u0009\u000b-\u001f]+/g, ' ').trim().slice(0, max) : undefined);
/** Le contenu d'un montage, propre : des mesures bornées et des textes coupés, rien d'autre. */
export function cleanContent(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}, so = r.sound || {}, im = r.image || {}, tx = r.text || {};
  const out = {
    sound: { bpm: num(so.bpm, 40, 260), start: num(so.start, 0, 1), length: num(so.length, 0, 600), song: num(so.song, 0, 3600),
      drop: typeof so.drop === 'boolean' ? so.drop : undefined, energy: num(so.energy, 0, 10),
      envelope: Array.isArray(so.envelope) ? so.envelope.slice(0, 64).map((v) => num(v, 0, 1) ?? 0) : undefined },
    image: { luma: num(im.luma, 0, 1), sat: num(im.sat, 0, 1), cool: num(im.cool, -1, 1), cuts: num(im.cuts, 0, 2000), shot: num(im.shot, 0, 120),
      clips: num(im.clips, 0, 500), photos: num(im.photos, 0, 500), names: Array.isArray(im.names) ? im.names.slice(0, 12).map((x) => str(x, 80)).filter(Boolean) : undefined },
    text: { replica: str(tx.replica, 800), replicaLen: num(tx.replicaLen, 0, 120), lyrics: str(tx.lyrics, 2000), caption: str(tx.caption, 2200), title: str(tx.title, 100) },
  };
  return JSON.parse(JSON.stringify(out));
}
/** Les images réduites d'un montage (trois au plus, JPEG). */
export const cleanThumbs = (list) => (Array.isArray(list) ? list : []).slice(0, 3)
  .filter((x) => typeof x === 'string' && x.length <= THUMB_MAX && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(x));

const STOP = new Set(('avec dans pour mais plus tout toute tous toutes cette comme elle elles nous vous leur leurs sans sous tres bien fait faire etre avoir '
  + 'etait suis sont peut veux vais quand alors aussi encore meme parce quoi juste deja ceux celle cela ici voila donc moins trop cest quil quelle votre notre '
  + 'ouais avais avait sais sait faut yeah ouai hein dans mais moi toi lui fond clip video film scene extrait copie final edit export onirique tiktok').split(' '));
const wordsOf = (text) => new Set(String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/)
  .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)));
const median = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
/** Ce que l'arbre apprend du contenu des TikToks (pas ceux d'AUTOMATIQUE) : le son, les images, les textes. */
export function learnFromContent(rows) {
  const list = rows.filter((r) => ['export', 'correction', 'archive'].includes(r.kind)).map((r) => parse(r.content, {})).filter((c) => c.sound || c.image || c.text);
  const words = new Map(), tags = new Map(), films = new Map(), count = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const c of list) {
    for (const w of wordsOf([c.text?.replica, c.text?.lyrics].join(' '))) count(words, w);
    for (const h of new Set((c.text?.caption || '').toLowerCase().match(/#[\p{L}\p{N}_]+/gu) || [])) count(tags, h);
    for (const w of new Set((c.image?.names || []).flatMap((n) => [...wordsOf(n.replace(/\.[a-z0-9]+$/i, ''))]))) count(films, w);
  }
  const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([value, n]) => ({ value, n }));
  const drops = list.filter((c) => typeof c.sound?.drop === 'boolean'), replicas = list.filter((c) => c.text?.replica);
  const round = (v) => (v == null ? null : Math.round(v * 100) / 100);
  return { n: list.length, bpm: median(list.map((c) => c.sound?.bpm)), length: median(list.map((c) => c.sound?.length)), start: round(median(list.map((c) => c.sound?.start))),
    drops: drops.length, dropShare: drops.length ? round(drops.filter((c) => c.sound.drop).length / drops.length) : null,
    replicas: replicas.length, replicaLen: median(list.map((c) => c.text?.replicaLen)),
    questions: replicas.length ? round(replicas.filter((c) => /\?\s*$/.test(c.text.replica)).length / replicas.length) : null,
    luma: round(median(list.map((c) => c.image?.luma))), cool: round(median(list.map((c) => c.image?.cool))), shot: round(median(list.map((c) => c.image?.shot))),
    words: top(words, 30), tags: top(tags, 12), films: top(films, 12) };
}

const current = (leaf, overlay) => (Object.hasOwn(overlay.leaves || {}, leaf.key) ? overlay.leaves[leaf.key].value : leaf.value);

/** Les propositions : une feuille dont les TikToks préfèrent nettement un autre réglage que celui de l'arbre. */
export function proposalsOf(overlay, stats, at = now()) {
  const out = [];
  for (const [key, leaf] of LEAVES) {
    const st = stats[key];
    if (!st || st.n < STRONG.tiktoks) continue;
    const [id, w] = Object.entries(st.values).sort((a, b) => b[1] - a[1])[0];
    const value = JSON.parse(id), share = w / st.w, from = current(leaf, overlay);
    if (share < STRONG.agree || value === from) continue;
    if (at - (overlay.refused?.[key + '|' + id] || 0) < REFUSED_DAYS * 864e5) continue;
    out.push({ key, value, from, share: Math.round(share * 100) / 100, n: st.n });
  }
  return out;
}

/** L'arbre tel qu'AUTOMATIQUE le suit : chaque feuille avec son réglage, d'où il vient, et ce que les TikToks ont choisi. */
export function published(overlay, stats = {}) {
  const values = {};
  const branches = TREE.branches.map((b) => ({ id: b.id, label: b.label, lessons: b.lessons, leaves: b.leaves.map((l) => {
    const st = stats[l.key];
    values[l.key] = current(l, overlay);
    return { key: l.key, label: l.label, type: l.type, unit: l.unit || '', options: l.options || null, why: l.why || '', value: values[l.key],
      min: l.min, max: l.max, step: l.step, buckets: l.buckets,
      base: l.value, source: overlay.leaves?.[l.key] || null,
      stats: st ? { n: st.n, values: Object.entries(st.values).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([id, w]) => ({ value: JSON.parse(id), share: Math.round((w / st.w) * 100) / 100 })) } : null };
  }) }));
  return { source: TREE.source, branches, values };
}

db.exec(`CREATE TABLE IF NOT EXISTS cut_learn (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL,                -- export | correction | auto | note
  role       TEXT NOT NULL DEFAULT '',     -- le rôle du compte, jamais qui
  settings   TEXT NOT NULL DEFAULT '{}',   -- les réglages des feuilles (ou celui qu'une leçon pose)
  changed    TEXT NOT NULL DEFAULT '[]',   -- correction : [{ key, from, to }] (AUTOMATIQUE → le fondateur)
  note       TEXT NOT NULL DEFAULT '',     -- leçon : son texte
  leaf       TEXT NOT NULL DEFAULT '',     -- leçon : la feuille ou la branche qu'elle nourrit ('' : tout l'arbre)
  link       TEXT NOT NULL DEFAULT '',     -- leçon : un TikTok d'exemple
  author     TEXT NOT NULL DEFAULT '',     -- leçon : le fondateur qui l'a écrite
  created_at INTEGER NOT NULL
)`);
// le contenu des montages (21/11/2026) : mesures et textes (content), images réduites (thumbs) ; kind 'archive' : un montage du
// cloud CUT repris pour son contenu (ses réglages l'ont déjà été, comme un export)
for (const col of ["content TEXT NOT NULL DEFAULT '{}'", "thumbs TEXT NOT NULL DEFAULT '[]'"])
  try { db.exec('ALTER TABLE cut_learn ADD COLUMN ' + col); } catch { /* déjà là */ }
const overlayNow = () => setting('cut_brain_overlay', null) || { leaves: {}, refused: {}, revision: 0 };
const saveOverlay = (ov) => setSetting('cut_brain_overlay', { ...ov, revision: (ov.revision || 0) + 1 });

const purge = () => {
  run("DELETE FROM cut_learn WHERE kind != 'note' AND created_at < ?", now() - KEEP_YEARS * 365 * 864e5);
  run("UPDATE cut_learn SET content = '{}', thumbs = '[]' WHERE kind != 'note' AND created_at < ? AND (content != '{}' OR thumbs != '[]')", now() - CONTENT_YEARS * 365 * 864e5);
  run("DELETE FROM cut_learn WHERE kind = 'archive' AND content = '{}' AND thumbs = '[]'");
};
purge();
setInterval(purge, 864e5).unref();

/** Ce qu'on peut savoir d'un TikTok public : par yt-dlp (description, auteur, vues, j'aime, musique, durée), sinon par la
 *  page d'intégration de TikTok ; et sa couverture, réduite. Rien si le lien n'est pas une vidéo TikTok. Lent et sans urgence :
 *  yt-dlp passe en priorité basse. */
export async function readTiktok(link) {
  const url = tiktokUrl(link);
  if (!url) return null;
  const info = {};
  try {
    const [cmd, extra] = await ytdlpCommand();
    const args = [...extra, '-j', '--no-download', '--no-warnings', '--socket-timeout', '20', url];
    const out = await new Promise((resolve, reject) => execFile(process.platform === 'win32' ? cmd : 'nice', process.platform === 'win32' ? args : ['-n', '19', cmd, ...args],
      { timeout: 90_000, maxBuffer: 30e6 }, (error, stdout) => (error ? reject(error) : resolve(stdout))));
    const j = JSON.parse(out);
    Object.assign(info, { title: j.description || j.title, author: j.uploader || j.creator || j.channel, views: j.view_count, likes: j.like_count,
      comments: j.comment_count, shares: j.repost_count, duration: j.duration, music: [j.artist, j.track].filter(Boolean).join(' - '),
      date: j.timestamp ? j.timestamp * 1000 : undefined, cover: j.thumbnail });
  } catch { /* yt-dlp bloqué ou absent : la page d'intégration */ }
  if (!info.title) {
    try {
      const r = await fetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(20_000) });
      const j = r.ok ? await r.json() : {};
      Object.assign(info, { title: j.title, author: j.author_name, cover: info.cover || j.thumbnail_url });
    } catch { /* TikTok ne répond pas */ }
  }
  const tiktok = JSON.parse(JSON.stringify({ url, title: str(info.title, 1000), author: str(info.author, 80), views: num(info.views, 0, 1e12),
    likes: num(info.likes, 0, 1e12), comments: num(info.comments, 0, 1e12), shares: num(info.shares, 0, 1e12), duration: num(info.duration, 0, 3600),
    music: str(info.music, 160), date: num(info.date, 0, 1e14), read: now() }));
  let cover = [];
  if (/^https:\/\/[^\s]+$/.test(info.cover || '')) {
    try {
      const r = await fetch(info.cover, { signal: AbortSignal.timeout(20_000) });
      const raw = Buffer.from(await r.arrayBuffer());
      if (r.ok && raw.length < 8e6) cover = cleanThumbs(['data:image/jpeg;base64,' + (await sharp(raw).resize(240, 426, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer()).toString('base64')]);
    } catch { /* pas de couverture */ }
  }
  return { tiktok, cover };
}
let reading = Promise.resolve();
/** Lit le TikTok d'une leçon en arrière-plan (un à la fois), puis le garde avec elle. */
function readLessonTiktok(id, link) {
  if (testing || !tiktokUrl(link)) return;
  reading = reading.then(async () => {
    const got = await readTiktok(link).catch(() => null);
    if (got) run('UPDATE cut_learn SET content = ?, thumbs = ? WHERE id = ?', JSON.stringify({ tiktok: got.tiktok }), JSON.stringify(got.cover), id);
  });
}

/** Les TikToks déjà gardés dans le cloud CUT (leur recette), repris une seule fois comme des exports. */
export function importCloudRecipes() {
  if (setting('cut_brain_import', 0)) return 0;
  let n = 0;
  for (const v of all('SELECT v.edit, v.created_at, u.role FROM cut_videos v JOIN users u ON u.id = v.user_id WHERE v.edit IS NOT NULL')) {
    const settings = cleanSettings(parse(v.edit, {})?.prefs);
    if (!Object.keys(settings).length) continue;
    run("INSERT INTO cut_learn (kind, role, settings, created_at) VALUES ('export', ?, ?, ?)", v.role, JSON.stringify(settings), v.created_at);
    n++;
  }
  setSetting('cut_brain_import', 1);
  return n;
}

/** Le contenu des montages des fondateurs déjà gardés dans le cloud CUT (textes, tempo, noms des fonds, aperçu), une fois. */
export function importCloudContent(libDir) {
  if (setting('cut_brain_import_content', 0)) return 0;
  let n = 0;
  for (const v of all("SELECT v.*, u.role FROM cut_videos v JOIN users u ON u.id = v.user_id WHERE u.role = 'founder'")) {
    const edit = parse(v.edit, null) || {}, prefs = edit.prefs || {};
    const replica = String(prefs.introLyrics || '').split('\n').map((l) => l.replace(/\[[^\]]*\]|<[^>]*>|\{[23]\}|\*\*/g, '').trim()).filter(Boolean).join('\n');
    const content = cleanContent({ sound: { bpm: edit.bpm, length: prefs.duration }, image: { names: (edit.clips || []).map((c) => c.name) },
      text: { replica, replicaLen: prefs.introOn ? prefs.introLen : undefined, caption: v.caption, title: edit.title || v.name } });
    let thumbs = [];
    try { const jpg = fs.readFileSync(`${libDir}/${v.stored_as}.jpg`); thumbs = cleanThumbs(['data:image/jpeg;base64,' + jpg.toString('base64')]); } catch { /* pas d'aperçu */ }
    run("INSERT INTO cut_learn (kind, role, content, thumbs, created_at) VALUES ('archive', 'founder', ?, ?, ?)", JSON.stringify(content), JSON.stringify(thumbs), v.created_at);
    n++;
  }
  setSetting('cut_brain_import_content', 1);
  return n;
}

export function mountCutBrain(app, { requireUser, libDir }) {
  try { importCloudContent(libDir); } catch (error) { console.error('Arborescence CUT, reprise du contenu :', error.message); }
  try { importCloudRecipes(); } catch (error) { console.error('Arborescence CUT, reprise du cloud :', error.message); }
  const member = (req, _res, next) => (can(req.user, 'sounds') ? next() : next(new HttpError(403, 'ONIRIQUE CUT est réservé aux membres ONIRIQUE et aux abonnés CLOUD.')));
  const founder = (req, _res, next) => (req.user.role === 'founder' ? next() : next(new HttpError(403, 'Réservé aux fondateurs.')));
  const rows = () => all('SELECT id, kind, role, settings, changed, note, leaf, link, author, content, created_at FROM cut_learn ORDER BY id DESC LIMIT 5000');

  app.get('/api/cut/learn', requireUser, member, (_req, res) => res.json({ keys: [...LEAVES.keys()] }));
  app.post('/api/cut/learn', requireUser, member, (req, res) => {
    rateLimit(`cut-learn:${req.user.id}`, 60, 3600_000);
    const settings = cleanSettings(req.body?.settings);
    if (!Object.keys(settings).length) throw new HttpError(400, 'Réglages attendus.');
    const isFounder = req.user.role === 'founder';
    let kind = req.body?.kind === 'auto' && isFounder ? 'auto' : 'export', changed = [];
    // Réexporté après AUTOMATIQUE : ce que le fondateur a changé dans ce qu'AUTOMATIQUE avait réglé.
    if (kind === 'export' && isFounder && req.body?.auto) {
      const auto = cleanSettings(req.body.auto);
      changed = Object.keys(settings).filter((k) => k in auto && auto[k] !== settings[k]).map((k) => ({ key: k, from: auto[k], to: settings[k] }));
      if (changed.length) kind = 'correction';
    }
    run('INSERT INTO cut_learn (kind, role, settings, changed, content, thumbs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      kind, req.user.role, JSON.stringify(settings), JSON.stringify(changed), JSON.stringify(cleanContent(req.body?.content)), JSON.stringify(cleanThumbs(req.body?.thumbs)), now());
    res.json({ ok: true, kind });
  });

  // Tout ce que l'arbre sait, pour le menu Arborescence et pour le superviseur.
  const state = () => {
    const list = rows(), overlay = overlayNow(), stats = tally(list);
    const counts = Object.fromEntries(all('SELECT kind, COUNT(*) AS n FROM cut_learn GROUP BY kind').map((r) => [r.kind, r.n]));
    const week = Object.fromEntries(all('SELECT kind, COUNT(*) AS n FROM cut_learn WHERE created_at > ? GROUP BY kind', now() - 7 * 864e5).map((r) => [r.kind, r.n]));
    const founders = get("SELECT COUNT(*) AS n FROM cut_learn WHERE kind IN ('export', 'correction') AND role = 'founder'").n;
    const lessons = all("SELECT id, note, leaf, link, author, settings, content, thumbs, created_at FROM cut_learn WHERE kind = 'note' ORDER BY id DESC")
      .map((r) => ({ id: r.id, text: r.note, leaf: r.leaf, link: r.link, author: r.author, settings: parse(r.settings, {}), at: r.created_at,
        tiktok: parse(r.content, {}).tiktok || null, thumbs: parse(r.thumbs, []) }));
    const journal = list.slice(0, 80).map((r) => ({ id: r.id, kind: r.kind, founder: r.role === 'founder', at: r.created_at,
      settings: parse(r.settings, {}), changed: parse(r.changed, []), note: r.note, leaf: r.leaf, link: r.link, author: r.author }));
    const gallery = all("SELECT id, kind, role, content, thumbs, created_at FROM cut_learn WHERE thumbs != '[]' OR content != '{}' ORDER BY id DESC LIMIT 24")
      .map((r) => ({ id: r.id, kind: r.kind, founder: r.role === 'founder', at: r.created_at, content: parse(r.content, {}), thumbs: parse(r.thumbs, []) }));
    return { ...published(overlay, stats), proposals: proposalsOf(overlay, stats), lessons, journal, counts, week, founders,
      content: learnFromContent(list), gallery, revision: overlay.revision || 0 };
  };
  app.get('/api/cut/brain', requireUser, founder, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ...state(), agent: { ...agentState(), usage: undefined, running: agentRunning() } });
  });

  // Le superviseur : seulement quand un fondateur le demande (la réponse part tout de suite, l'avis arrive en arrière-plan).
  app.post('/api/cut/brain/agent', requireUser, founder, (req, res) => {
    rateLimit(`cut-agent:${req.user.id}`, 6, 3600_000);
    runAgent(state).catch(() => {});
    res.status(202).json({ ok: true });
  });
  // Les liens TikTok des leçons pas encore lus (leçons d'avant cette lecture, ou TikTok qui ne répondait pas) : relus au démarrage.
  if (!testing) setTimeout(() => {
    for (const r of all("SELECT id, link FROM cut_learn WHERE kind = 'note' AND link != '' AND content = '{}'")) readLessonTiktok(r.id, r.link);
  }, 60_000).unref();

  // Une leçon d'un fondateur : un texte, un TikTok d'exemple, et, pour une feuille, le réglage à prendre (posé tout de suite).
  app.post('/api/cut/brain/notes', requireUser, founder, (req, res) => {
    const target = String(req.body?.leaf || '');
    const leaf = LEAVES.get(target);
    if (target && !leaf && !TREE.branches.some((b) => b.id === target)) throw new HttpError(400, 'Feuille inconnue.');
    const text = String(req.body?.text || '').replace(/[\u0000-\u0009\u000b-\u001f]+/g, '').trim().slice(0, 600);
    const link = String(req.body?.link || '').trim();
    if (link && !/^https:\/\/[^\s<>"']{4,300}$/.test(link)) throw new HttpError(400, 'Le lien doit commencer par https://.');
    const value = leaf && req.body?.value !== undefined && req.body.value !== '' ? valueOf(leaf, req.body.value) : undefined;
    if (leaf && req.body?.value !== undefined && req.body.value !== '' && value === undefined) throw new HttpError(400, 'Ce réglage ne va pas à cette feuille.');
    if (!text && value === undefined) throw new HttpError(400, 'Écris la leçon, ou choisis un réglage.');
    const author = req.user.name || req.user.email;
    const id = run("INSERT INTO cut_learn (kind, role, settings, note, leaf, link, author, created_at) VALUES ('note', ?, ?, ?, ?, ?, ?, ?)",
      req.user.role, JSON.stringify(value === undefined ? {} : { [target]: value }), text, target, link, author, now()).lastInsertRowid;
    if (value !== undefined) {
      const ov = overlayNow();
      ov.leaves = { ...ov.leaves, [target]: { value, from: 'note', note: Number(id), by: author, at: now(), why: text } };
      saveOverlay(ov);
    }
    readLessonTiktok(Number(id), link);
    res.status(201).json({ ok: true, id: Number(id) });
  });
  app.delete('/api/cut/brain/notes/:id', requireUser, founder, (req, res) => {
    const row = get("SELECT id, leaf FROM cut_learn WHERE id = ? AND kind = 'note'", Number(req.params.id) || 0);
    if (!row) throw new HttpError(404, 'Leçon introuvable.');
    run('DELETE FROM cut_learn WHERE id = ?', row.id);
    const ov = overlayNow();
    if (ov.leaves?.[row.leaf]?.note === row.id) { delete ov.leaves[row.leaf]; saveOverlay(ov); }   // son réglage part avec elle
    res.json({ ok: true });
  });

  app.post('/api/cut/brain/proposals', requireUser, founder, (req, res) => {
    const leaf = LEAVES.get(String(req.body?.key || ''));
    if (!leaf) throw new HttpError(404, 'Feuille inconnue.');
    const value = valueOf(leaf, req.body?.value), decision = req.body?.decision;
    if (value === undefined || !['approve', 'refuse'].includes(decision)) throw new HttpError(400, 'Valider ou refuser quel réglage ?');
    const ov = overlayNow(), by = req.user.name || req.user.email;
    if (decision === 'approve') {
      const st = tally(rows())[leaf.key], share = st ? (st.values[JSON.stringify(value)] || 0) / st.w : 0;
      ov.leaves = { ...ov.leaves, [leaf.key]: { value, from: 'proposal', by, at: now(), why: st ? `${Math.round(share * 100)} % de ${st.n} TikToks` : '' } };
    } else ov.refused = { ...ov.refused, [leaf.key + '|' + JSON.stringify(value)]: now() };
    saveOverlay(ov);
    res.json({ ok: true });
  });
}
