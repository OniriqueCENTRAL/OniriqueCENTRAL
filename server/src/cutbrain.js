// L'ARBORESCENCE DE ONIRIQUE CUT : ce qui fait un TikTok qui marche, rangé comme les étapes de CUT (le son, les clips, le
// style, le texte, l'image, le film, la publication). Comme ONR Neural Learning pour VOCALBOX (vocalbrain.js), rien n'y entre
// sans un fondateur.
//
// Elle part de la recette du dépôt (cut-brain.json) et se nourrit de trois choses :
//   - les TikToks faits sur CUT : à chaque export, les réglages du montage, jamais le son, les images, les textes ni qui l'a
//     fait (seulement le rôle du compte, pour séparer les fondateurs des autres) ; ceux déjà gardés dans le cloud CUT sont
//     repris une fois ;
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
import fs from 'node:fs';
import { db, get, all, run, now, setting, setSetting } from './db.js';
import { HttpError, rateLimit, can } from './auth.js';

export const TREE = JSON.parse(fs.readFileSync(new URL('./cut-brain.json', import.meta.url), 'utf8'));
for (const b of TREE.branches) for (const l of b.leaves) if (l.fonts) l.options = Object.fromEntries(TREE.fonts.map((f) => [f, f]));
const LEAVES = new Map(TREE.branches.flatMap((b) => b.leaves.map((l) => [l.key, l])));

// Une proposition : assez de TikToks, et presque tous du même avis (seuils bas tant qu'il y a peu de monde : un fondateur
// valide chacune).
export const STRONG = { tiktoks: 5, agree: 0.6 };
const CORRECTION = 3;          // un réglage corrigé après AUTOMATIQUE compte pour trois TikToks
const REFUSED_DAYS = 30;       // une proposition refusée ne revient pas avant
const KEEP_YEARS = 3;          // les réglages des TikToks sont gardés trois ans au plus (les leçons restent)

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
const overlayNow = () => setting('cut_brain_overlay', null) || { leaves: {}, refused: {}, revision: 0 };
const saveOverlay = (ov) => setSetting('cut_brain_overlay', { ...ov, revision: (ov.revision || 0) + 1 });

const purge = () => run("DELETE FROM cut_learn WHERE kind != 'note' AND created_at < ?", now() - KEEP_YEARS * 365 * 864e5);
purge();
setInterval(purge, 864e5).unref();

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

export function mountCutBrain(app, { requireUser }) {
  try { importCloudRecipes(); } catch (error) { console.error('Arborescence CUT, reprise du cloud :', error.message); }
  const member = (req, _res, next) => (can(req.user, 'sounds') ? next() : next(new HttpError(403, 'ONIRIQUE CUT est réservé aux membres ONIRIQUE et aux abonnés CLOUD.')));
  const founder = (req, _res, next) => (req.user.role === 'founder' ? next() : next(new HttpError(403, 'Réservé aux fondateurs.')));
  const rows = () => all('SELECT * FROM cut_learn ORDER BY id DESC LIMIT 5000');

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
    run('INSERT INTO cut_learn (kind, role, settings, changed, created_at) VALUES (?, ?, ?, ?, ?)',
      kind, req.user.role, JSON.stringify(settings), JSON.stringify(changed), now());
    res.json({ ok: true, kind });
  });

  app.get('/api/cut/brain', requireUser, founder, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const list = rows(), overlay = overlayNow(), stats = tally(list);
    const counts = Object.fromEntries(all('SELECT kind, COUNT(*) AS n FROM cut_learn GROUP BY kind').map((r) => [r.kind, r.n]));
    const week = Object.fromEntries(all('SELECT kind, COUNT(*) AS n FROM cut_learn WHERE created_at > ? GROUP BY kind', now() - 7 * 864e5).map((r) => [r.kind, r.n]));
    const founders = get("SELECT COUNT(*) AS n FROM cut_learn WHERE kind IN ('export', 'correction') AND role = 'founder'").n;
    const lessons = all("SELECT id, note, leaf, link, author, settings, created_at FROM cut_learn WHERE kind = 'note' ORDER BY id DESC")
      .map((r) => ({ id: r.id, text: r.note, leaf: r.leaf, link: r.link, author: r.author, settings: parse(r.settings, {}), at: r.created_at }));
    const journal = list.slice(0, 80).map((r) => ({ id: r.id, kind: r.kind, founder: r.role === 'founder', at: r.created_at,
      settings: parse(r.settings, {}), changed: parse(r.changed, []), note: r.note, leaf: r.leaf, link: r.link, author: r.author }));
    res.json({ ...published(overlay, stats), proposals: proposalsOf(overlay, stats), lessons, journal, counts, week, founders,
      revision: overlay.revision || 0 });
  });

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
