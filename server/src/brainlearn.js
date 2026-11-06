// ONR NEURAL LEARNING : ce que les retours des utilisateurs proposent au cerveau de VOCALBOX, et le cerveau publié.
// Fonctions pures (aucune base de données ici) : utilisées par le serveur (vocalbrain.js) et par la publication d'une version
// (deploy/publish-plugin.mjs).
//
// Rien n'entre dans le cerveau sans un fondateur : les retours deviennent des PROPOSITIONS, seulement quand la demande est
// forte (assez de mix, assez de postes différents, et presque tous dans le même sens) ; une proposition validée rejoint la
// SURCOUCHE (overlay), qui s'ajoute au cerveau du dépôt. Le cerveau publié = cerveau du dépôt + surcouche.

// Les réglages retouchés après CRÉER LE MIX, ramenés aux « couleurs » du cerveau : combien de couleur pour une unité du réglage
// (l'inverse de ce que fait buildPlan : réverbe envoi = 70 × reverb, delay envoi = 10 + 18 × delay, AIR = 2 + 3 × air…).
export const PARAM_TO_HINT = {
  fxReverbMix: ['reverb', 1 / 70],
  fxDelayMix: ['delay', 1 / 18],
  air: ['air', 1 / 3],
  high: ['bright', 1 / 1.5],
  parallelAmount: ['comp', 1 / 25],
  satWarmth: ['warm', 1 / 30],
};
export const HINT_RANGE = { comp: [-1, 1] };   // les autres : 0 .. 1
const DEFAULT_HINT = { reverb: 0.26 };          // une couleur absente de la fiche : ce que CRÉER LE MIX prend par défaut

// Une demande « vraiment forte »
export const STRONG = {
  // seuils bas tant qu'il y a peu d'utilisateurs : un fondateur valide chaque proposition (07/11/2026)
  artist: { mixes: 3, installs: 2, agree: 0.66, min: 0.04 },
  global: { mixes: 6, installs: 3, agree: 0.66, min: 0.04 },
  found: { hits: 2 },
};
const STEP = 0.25;    // une proposition bouge une couleur de 0,25 au plus
const TOTAL = 0.4;    // et la surcouche, en tout, de 0,4 au plus par couleur

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^facon /, '').trim();
const round = (v) => Math.round(v * 100) / 100;
const clampHint = (k, v) => { const [lo, hi] = HINT_RANGE[k] || [0, 1]; return Math.min(hi, Math.max(lo, v)); };
const parse = (s, d) => { if (s && typeof s === 'object') return s; try { return JSON.parse(s); } catch { return d; } };

/** Ce qu'un utilisateur a changé après CRÉER LE MIX, en couleurs : { reverb: -0.1, ... } (exemplaire 1 de chaque module). */
export function hintDeltas(row) {
  const plan = parse(row.plan, {}), final = parse(row.final, {});
  const planned = {};
  for (const m of plan.modules || []) if (!m.instance) Object.assign(planned, m.params || {});
  const out = {};
  for (const [id, v] of Object.entries(final)) {
    const map = PARAM_TO_HINT[id];
    if (!map || planned[id] == null || !Number.isFinite(Number(v))) continue;
    out[map[0]] = (out[map[0]] || 0) + (Number(v) - Number(planned[id])) * map[1];
  }
  return out;
}

/** Les propositions que les retours justifient. rows : vocalbox_feedback ; found : vocalbox_artists ; overlay : la surcouche ;
 *  refused : Set des « kind|cible » refusés récemment (pas reproposés). */
export function propose(base, overlay, rows, found, refused = new Set()) {
  const known = new Set((base.artists || []).map((a) => norm(a.name)));
  for (const a of overlay.added || []) known.add(norm(a.name));
  const out = [];

  // 1. Les retouches, par artiste demandé (et « global » : les demandes sans artiste)
  const groups = new Map();
  for (const row of rows) {
    const deltas = hintDeltas(row);
    if (!Object.keys(deltas).length && !row.rating) continue;
    const artists = parse(row.artists, []).map(norm).filter(Boolean);
    for (const target of artists.length ? artists : ['*']) {
      const since = target === '*' ? overlay.globalAt || 0 : overlay.artists?.[target]?.at || 0;
      if (row.created_at <= since) continue;   // déjà pris en compte par une validation précédente
      if (!groups.has(target)) groups.set(target, []);
      groups.get(target).push({ deltas, rating: row.rating || 0, install: row.install });
    }
  }
  for (const [target, list] of groups) {
    const rule = target === '*' ? STRONG.global : STRONG.artist;
    if (target !== '*' && !known.has(target)) continue;
    const installs = new Set(list.map((x) => x.install)).size;
    if (list.length < rule.mixes || installs < rule.installs) continue;
    const yes = list.filter((x) => x.rating > 0).length, no = list.filter((x) => x.rating < 0).length;
    const changes = {}, detail = {};
    for (const hint of new Set(Object.values(PARAM_TO_HINT).map((m) => m[0]))) {
      const vals = list.filter((x) => x.deltas[hint] != null);
      if (vals.length < rule.mixes / 2) continue;
      // un mix noté OUI après retouche compte plus qu'un mix sans note ou noté BOF
      const w = (x) => (x.rating > 0 ? 1 : x.rating < 0 ? 0.5 : 0.7);
      const mean = vals.reduce((s, x) => s + w(x) * x.deltas[hint], 0) / vals.reduce((s, x) => s + w(x), 0);
      const agree = vals.filter((x) => Math.sign(x.deltas[hint]) === Math.sign(mean)).length / vals.length;
      const step = Math.max(-STEP, Math.min(STEP, 0.7 * mean));
      if (agree < rule.agree || Math.abs(step) < rule.min) continue;
      changes[hint] = round(step);
      detail[hint] = { mixes: vals.length, agree: round(agree) };
    }
    if (!Object.keys(changes).length) continue;
    const kind = target === '*' ? 'global' : 'tune';
    if (refused.has(`${kind}|${target}`)) continue;
    const name = target === '*' ? '' : (base.artists || []).concat(overlay.added || []).find((a) => norm(a.name) === target)?.name || target;
    out.push({ kind, target, name, changes, support: { mixes: list.length, installs, yes, no, detail } });
  }

  // 2. Les artistes trouvés par le serveur et beaucoup demandés : à ajouter au cerveau
  for (const f of found) {
    const data = parse(f.data, {});
    const key = norm(data.name || f.name);
    if (!key || known.has(key) || (f.hits || 0) < STRONG.found.hits || refused.has(`add|${key}`)) continue;
    out.push({ kind: 'add', target: key, name: data.name || f.name, changes: { artist: data }, support: { hits: f.hits } });
  }
  return out;
}

/** Une proposition validée rejoint la surcouche (qui est renvoyée, modifiée). */
export function approve(overlay, p, by, at = Date.now()) {
  overlay.revision = (overlay.revision || 0) + 1;
  overlay.artists ||= {}; overlay.added ||= []; overlay.global ||= {}; overlay.log ||= [];
  const add = (slot, changes) => {
    for (const [k, v] of Object.entries(changes)) slot[k] = round(Math.max(-TOTAL, Math.min(TOTAL, (slot[k] || 0) + v)));
  };
  let text;
  if (p.kind === 'tune') {
    const slot = overlay.artists[p.target] ||= { hints: {} };
    add(slot.hints, p.changes); slot.at = at;
    text = `${p.name} : ${describe(p.changes)}`;
  } else if (p.kind === 'global') {
    add(overlay.global, p.changes); overlay.globalAt = at;
    text = `Toutes les demandes : ${describe(p.changes)}`;
  } else {
    overlay.added = overlay.added.filter((a) => norm(a.name) !== p.target).concat([{ ...p.changes.artist, learned: true }]);
    text = `${p.name} ajouté au cerveau`;
  }
  overlay.log = [{ revision: overlay.revision, at, by, text }, ...overlay.log].slice(0, 50);
  return overlay;
}

const LABEL = { reverb: 'réverbe', delay: 'delay', air: 'air', bright: 'brillance', comp: 'compression', warm: 'chaleur' };
export const describe = (changes) => Object.entries(changes).map(([k, v]) => `${LABEL[k] || k} ${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`).join(', ');

/** Le cerveau publié : le cerveau du dépôt (base) + la surcouche validée. */
export function publishedBrain(base, overlay) {
  const brain = JSON.parse(JSON.stringify(base || { version: 0, artists: [] }));
  brain.revision = overlay?.revision || 0;
  brain.artists ||= [];
  for (const a of overlay?.added || []) if (!brain.artists.some((b) => norm(b.name) === norm(a.name))) brain.artists.push(a);
  for (const [target, slot] of Object.entries(overlay?.artists || {})) {
    const a = brain.artists.find((b) => norm(b.name) === target || (b.aliases || []).map(norm).includes(target));
    if (!a) continue;
    a.hints ||= {};
    for (const [k, d] of Object.entries(slot.hints || {})) a.hints[k] = round(clampHint(k, (a.hints[k] ?? DEFAULT_HINT[k] ?? 0) + d));
    a.learned = true;
  }
  brain.corrections = { ...(brain.corrections || {}), global: { ...(overlay?.global || {}) } };
  brain.learned = overlay?.log || [];
  return brain;
}
