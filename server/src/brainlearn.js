// ONR NEURAL LEARNING : ce que les retours des utilisateurs proposent au cerveau de VOCALBOX, et le cerveau publié.
// Fonctions pures (aucune base de données ici) : utilisées par le serveur (vocalbrain.js) et par la publication d'une version
// (deploy/publish-plugin.mjs).
//
// Rien n'entre dans le cerveau sans un fondateur : les retours deviennent des PROPOSITIONS, seulement quand la demande est
// forte (assez de mix, assez de postes différents, et presque tous dans le même sens) ; une proposition validée rejoint la
// SURCOUCHE (overlay), qui s'ajoute au cerveau du dépôt. Le cerveau publié = cerveau du dépôt + surcouche.

// Les réglages retouchés après AUTO MIX, ramenés aux « couleurs » du cerveau : combien de couleur pour une unité du réglage
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
const DEFAULT_HINT = { reverb: 0.26 };          // une couleur absente de la fiche : ce que AUTO MIX prend par défaut

// Une demande « vraiment forte »
export const STRONG = {
  // seuils bas tant qu'il y a peu d'utilisateurs : un fondateur valide chaque proposition (07/11/2026)
  artist: { mixes: 3, installs: 2, agree: 0.66, min: 0.04 },
  global: { mixes: 6, installs: 3, agree: 0.66, min: 0.04 },
  found: { hits: 2 },
  voice: { refs: 4, installs: 2 },     // une voix mesurée : 4 références au moins, de 2 postes
  chain: { chains: 5, installs: 3 },   // une chaîne de la communauté : 5 chaînes partagées, de 3 postes
  style: { chains: 6, installs: 3 },   // un style de mixage : 6 chaînes, de 3 postes
};
const STEP = 0.25;    // une proposition bouge une couleur de 0,25 au plus
const TOTAL = 0.4;    // et la surcouche, en tout, de 0,4 au plus par couleur

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^facon /, '').trim();
const round = (v) => Math.round(v * 100) / 100;
const clampHint = (k, v) => { const [lo, hi] = HINT_RANGE[k] || [0, 1]; return Math.min(hi, Math.max(lo, v)); };
const parse = (s, d) => { if (s && typeof s === 'object') return s; try { return JSON.parse(s); } catch { return d; } };

/** Ce qu'un utilisateur a changé après AUTO MIX, en couleurs : { reverb: -0.1, ... } (exemplaire 1 de chaque module). */
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
export function propose(base, overlay, rows, found, refused = new Set(), chains = []) {
  const known = new Set((base.artists || []).map((a) => norm(a.name)));
  for (const a of overlay.added || []) known.add(norm(a.name));
  const out = [];

  // 1. Les retouches, par artiste demandé (et « global » : les demandes sans artiste)
  const groups = new Map();
  for (const row of rows) {
    const deltas = hintDeltas(row);
    // les « oui » et « non » silencieux (plugin 08/11) : chaîne gardée telle quelle, ou démontée ; les retours d'avant n'en ont pas
    const outcome = parse(row.extra, {}).outcome || {};
    const implicit = outcome.result === 'kept' ? 1 : outcome.result === 'rebuilt' ? -1 : 0;
    if (!Object.keys(deltas).length && !row.rating && !implicit) continue;
    const artists = parse(row.artists, []).map(norm).filter(Boolean);
    for (const target of artists.length ? artists : ['*']) {
      const since = target === '*' ? overlay.globalAt || 0 : overlay.artists?.[target]?.at || 0;
      if (row.created_at <= since) continue;   // déjà pris en compte par une validation précédente
      if (!groups.has(target)) groups.set(target, []);
      groups.get(target).push({ deltas, rating: row.rating || 0, install: row.install, implicit, compares: Number(outcome.compares) || 0 });
    }
  }
  for (const [target, list] of groups) {
    const rule = target === '*' ? STRONG.global : STRONG.artist;
    if (target !== '*' && !known.has(target)) continue;
    const installs = new Set(list.map((x) => x.install)).size;
    if (list.length < rule.mixes || installs < rule.installs) continue;
    const yes = list.filter((x) => x.rating > 0).length, no = list.filter((x) => x.rating < 0).length;
    const kept = list.filter((x) => x.implicit > 0).length, rebuilt = list.filter((x) => x.implicit < 0).length;
    const changes = {}, detail = {};
    for (const hint of new Set(Object.values(PARAM_TO_HINT).map((m) => m[0]))) {
      const vals = list.filter((x) => x.deltas[hint] != null);
      if (vals.length < rule.mixes / 2) continue;
      // un mix noté OUI après retouche compte plus qu'un mix sans note ou noté BOF ; une retouche faite en comparant
      // avant / après (COMPARER, 2 fois au moins) un peu plus
      const w = (x) => (x.rating > 0 ? 1 : x.rating < 0 ? 0.5 : 0.7) * (x.compares >= 2 ? 1.25 : 1);
      // un mix gardé tel quel (sans retouche de cette couleur) est un vote « c'était bien » : il rend la correction plus prudente
      const keptAsIs = list.filter((x) => x.implicit > 0 && x.deltas[hint] == null).length;
      const mean = vals.reduce((s, x) => s + w(x) * x.deltas[hint], 0) / (vals.reduce((s, x) => s + w(x), 0) + 0.7 * keptAsIs);
      const agree = vals.filter((x) => Math.sign(x.deltas[hint]) === Math.sign(mean)).length / (vals.length + keptAsIs);
      const step = Math.max(-STEP, Math.min(STEP, 0.7 * mean));
      if (agree < rule.agree || Math.abs(step) < rule.min) continue;
      changes[hint] = round(step);
      detail[hint] = { mixes: vals.length, agree: round(agree) };
    }
    if (!Object.keys(changes).length) continue;
    const kind = target === '*' ? 'global' : 'tune';
    if (refused.has(`${kind}|${target}`)) continue;
    const name = target === '*' ? '' : (base.artists || []).concat(overlay.added || []).find((a) => norm(a.name) === target)?.name || target;
    out.push({ kind, target, name, changes, support: { mixes: list.length, installs, yes, no, kept, rebuilt, detail } });
  }

  // 2. Les artistes trouvés par le serveur et beaucoup demandés : à ajouter au cerveau
  for (const f of found) {
    const data = parse(f.data, {});
    const key = norm(data.name || f.name);
    if (!key || known.has(key) || (f.hits || 0) < STRONG.found.hits || refused.has(`add|${key}`)) continue;
    out.push({ kind: 'add', target: key, name: data.name || f.name, changes: { artist: data }, support: { hits: f.hits } });
  }

  // 3. LES VOIX MESURÉES : les morceaux de référence glissés pour un même artiste (mesures seulement, voix séparée par l'IA).
  //    Seulement pour un artiste qui n'a pas encore de voix mesurée : celles du dépôt (mesurées par Nov) ne sont jamais remplacées.
  const allArtists = (base.artists || []).concat(overlay.added || []);
  const voiceGroups = new Map();
  for (const row of rows) {
    const ref = parse(row.extra, {}).refProfile;
    const artists = parse(row.artists, []);
    if (!ref || ref.fromMix || !Array.isArray(ref.bands) || ref.bands.length !== CENTRES.length || artists.length !== 1) continue;
    const key = norm(artists[0]);
    if (!voiceGroups.has(key)) voiceGroups.set(key, []);
    voiceGroups.get(key).push({ ref, install: row.install });
  }
  for (const [key, list] of voiceGroups) {
    const artist = allArtists.find((a) => norm(a.name) === key);
    if (!artist || artist.voice || overlay.voices?.[key] || refused.has(`voice|${key}`)) continue;
    const installs = new Set(list.map((x) => x.install)).size;
    if (list.length < STRONG.voice.refs || installs < STRONG.voice.installs) continue;
    const bands = {};
    CENTRES.forEach((c, i) => { if (c >= 160 && c <= 8000) bands[String(Math.round(c))] = round1(median(list.map((x) => Number(x.ref.bands[i])))); });
    const voice = { source: `ONR Neural Learning : ${list.length} références de ${installs} postes`, dyn: round1(median(list.map((x) => x.ref.dyn))),
      rt60: round(median(list.map((x) => x.ref.rt60))), wet: round1(median(list.map((x) => x.ref.wet))), echo: round(median(list.map((x) => x.ref.echo))), bands };
    out.push({ kind: 'voice', target: key, name: artist.name, changes: { voice }, support: { refs: list.length, installs } });
  }

  // 4. LE MODÈLE APPRIS : des mesures de la voix vers la correction que les gens font (ou ne font pas) ; proposé à partir de
  //    200 bons mix, et de nouveau quand il y en a un quart de plus
  const model = trainModel(rows);
  if (model && !refused.has('model|model') && (!overlay.model || model.samples >= 1.25 * (overlay.model.samples || 0)))
    out.push({ kind: 'model', target: 'model', name: 'Modèle appris', changes: { model }, support: { mixes: model.samples, installs: model.installs } });

  // 5. LES CHAÎNES DE LA COMMUNAUTÉ : les chaînes partagées pour un même artiste, ramenées à une chaîne type (les modules de
  //    plus de 60 % d'entre elles, à leur place moyenne, réglages médians)
  const chainGroups = new Map();
  for (const c of chains) {
    if (c.source === 'manual') continue;   // les chaînes construites à la main n'ont pas d'artiste : elles font des styles (6.)
    const artists = parse(c.artists, []);
    const mods = parse(c.modules, []);
    if (!artists.length || !Array.isArray(mods) || mods.length < 2) continue;
    const key = norm(artists[0]);
    if (!chainGroups.has(key)) chainGroups.set(key, []);
    chainGroups.get(key).push({ mods, install: c.install });
  }
  for (const [key, list] of chainGroups) {
    const artist = allArtists.find((a) => norm(a.name) === key || (a.aliases || []).map(norm).includes(key));
    if (!artist || refused.has(`chain|${key}`)) continue;
    const installs = new Set(list.map((x) => x.install)).size;
    if (list.length < STRONG.chain.chains || installs < STRONG.chain.installs) continue;
    if (overlay.chains?.[key] && list.length < 1.5 * (overlay.chains[key].chains || 0)) continue;
    const chain = communityChainOf(list);
    if (chain.length < 2) continue;
    out.push({ kind: 'chain', target: key, name: artist.name,
      changes: { chain: { artist: artist.name, installs, chains: list.length, modules: chain } }, support: { chains: list.length, installs } });
  }

  // 6. LES STYLES DE MIXAGE : les chaînes que beaucoup de gens montent eux-mêmes. Deux sources :
  //    - les chaînes partagées sans artiste mais avec des mots de style (« rap », « sombre », « en avant ») : regroupées par
  //      ces mots, le style porte déjà son nom ;
  //    - les chaînes construites à la main (ONR Neural Learning) : regroupées par rôle et par modules ; un fondateur leur
  //      donne un nom en les validant (« Drill sombre »), et AUTO MIX les propose quand ce nom est dans la demande.
  const styleGroups = new Map();
  for (const c of chains) {
    const mods = parse(c.modules, []).filter((m) => m && m.on !== false);
    if (!Array.isArray(mods) || mods.length < 2) continue;
    let key, words = [];
    if (c.source === 'manual') key = `main:${Number(c.role) || 0}:${[...new Set(mods.map((m) => String(m.type)))].sort().join('+')}`;
    else {
      if (parse(c.artists, []).length) continue;
      words = [...new Set(parse(c.styles, []).map(norm).filter(Boolean))].sort();
      if (!words.length) continue;
      key = `mots:${words.join('+')}`;
    }
    if (!styleGroups.has(key)) styleGroups.set(key, { words, role: Number(c.role) || 0, list: [] });
    styleGroups.get(key).list.push({ mods, install: c.install });
  }
  for (const [key, g] of styleGroups) {
    if (refused.has(`style|${key}`)) continue;
    const installs = new Set(g.list.map((x) => x.install)).size;
    if (g.list.length < STRONG.style.chains || installs < STRONG.style.installs) continue;
    if (overlay.styles?.[key] && g.list.length < 1.5 * (overlay.styles[key].chains || 0)) continue;
    const modules = communityChainOf(g.list);
    if (modules.length < 2) continue;
    const name = g.words.join(' · ');
    out.push({ kind: 'style', target: key, name: name || `Style ${['LEAD', 'BACKS', 'ADLIBS', 'DOUBLES'][g.role] || 'LEAD'} construit à la main`,
      changes: { style: { name, words: g.words, role: g.role, from: key.startsWith('main:') ? 'main' : 'partage', installs, chains: g.list.length, modules } },
      support: { chains: g.list.length, installs } });
  }
  return out;
}

const STOP = new Set(['de', 'la', 'le', 'les', 'du', 'des', 'et', 'en', 'un', 'une', 'a', 'au', 'aux', 'style', 'voix', 'facon']);
/** Les mots qui font reconnaître un style dans une demande : ceux de son nom (sans les petits mots), sans accents. */
export const styleWordsOf = (name) => [...new Set(String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .split(/[^a-z0-9&]+/).filter((w) => w.length >= 2 && !STOP.has(w)))];

// les tiers d'octave du plugin (MixAnalysis.h, kCentres) : les mesures des voix arrivent dans cet ordre
const CENTRES = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000,
  5000, 6300, 8000, 10000, 12500, 16000, 20000];
const round1 = (v) => Math.round(v * 10) / 10;
function median(xs) {
  const v = xs.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return 0;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}

/** Les mesures que lit le modèle : les mêmes que le plugin (MixAnalysis.cpp, modelFeatures). */
export function modelFeatures(p) {
  const b = p.bands || [];
  const avg = (a, z) => { let s = 0; for (let i = a; i <= z; i++) s += Number(b[i]) || 0; return s / (z - a + 1); };
  const f = [1, avg(8, 11) / 6, avg(21, 23) / 6, avg(26, 28) / 6, ((Number(p.dynRange) || 6) - 6) / 4, ((Number(p.sibilance) || -10) + 10) / 10,
    Number(p.sung) || 0, Math.min(Number(p.rt60) || 0, 2)];
  return f.map((x) => Math.max(-3, Math.min(3, x)));
}
export const MODEL_OUTPUTS = ['reverb', 'delay', 'air', 'bright', 'comp', 'warm'];
export const MODEL_MIN = { samples: 200, installs: 20 };

/** Le petit modèle (régression ridge) : pour chaque couleur, la correction attendue d'après les mesures de la voix. Appris sur
 *  les mix notés OUI, gardés ou retouchés (pas les chaînes démontées ni les BOF) ; null tant qu'il n'y a pas assez de mix. */
export function trainModel(rows) {
  const X = [], Y = [], installs = new Set();
  for (const row of rows) {
    const p = parse(row.profile, {});
    if (!Array.isArray(p.bands) || p.bands.length !== CENTRES.length) continue;
    const result = parse(row.extra, {}).outcome?.result;
    if (row.rating < 0 || result === 'rebuilt' || (!(row.rating > 0) && !result)) continue;
    const d = hintDeltas(row);
    X.push(modelFeatures(p));
    Y.push(MODEL_OUTPUTS.map((k) => Math.max(-0.5, Math.min(0.5, d[k] || 0))));
    installs.add(row.install);
  }
  if (X.length < MODEL_MIN.samples || installs.size < MODEL_MIN.installs) return null;
  const n = X[0].length, lambda = 2;
  // (XᵀX + λI) w = Xᵀy, sans pénaliser le terme constant
  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => X.reduce((s, x) => s + x[i] * x[j], 0) + (i === j && i > 0 ? lambda : 0)));
  const outputs = {};
  MODEL_OUTPUTS.forEach((k, o) => {
    const b = Array.from({ length: n }, (_, i) => X.reduce((s, x, r) => s + x[i] * Y[r][o], 0));
    const w = solve(A.map((row) => row.slice()), b.slice());
    if (w) outputs[k] = w.map((v) => Math.round(v * 10000) / 10000);
  });
  return { version: 1, outputs, samples: X.length, installs: installs.size, at: Date.now() };
}
function solve(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return null;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) x[r] = (b[r] - A[r].slice(r + 1).reduce((s, v, k) => s + v * x[r + 1 + k], 0)) / A[r][r];
  return x.every(Number.isFinite) ? x : null;
}

/** La chaîne type d'un groupe de chaînes partagées : les modules (premier exemplaire) de plus de 60 % d'entre elles, rangés à
 *  leur place moyenne, chacun avec la médiane de ses réglages. */
export function communityChainOf(list) {
  const stats = new Map();
  for (const { mods } of list) {
    const seen = new Set();
    mods.forEach((m, i) => {
      const type = String(m.type || '');
      if (!type || seen.has(type) || m.on === false) return;
      seen.add(type);
      if (!stats.has(type)) stats.set(type, { n: 0, place: 0, params: {} });
      const s = stats.get(type);
      s.n++; s.place += mods.length > 1 ? i / (mods.length - 1) : 0.5;
      for (const [k, v] of Object.entries(m.params || {})) if (Number.isFinite(Number(v))) (s.params[k] ||= []).push(Number(v));
    });
  }
  return [...stats.entries()].filter(([, s]) => s.n / list.length >= 0.6).sort((a, b) => a[1].place / a[1].n - b[1].place / b[1].n)
    .map(([type, s]) => ({ type, instance: 0, params: Object.fromEntries(Object.entries(s.params).filter(([, v]) => v.length >= s.n / 2).map(([k, v]) => [k, Math.round(median(v) * 1000) / 1000])) }));
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
  } else if (p.kind === 'voice') {
    (overlay.voices ||= {})[p.target] = p.changes.voice;
    text = `${p.name} : voix mesurée (${p.changes.voice?.source || 'références'})`;
  } else if (p.kind === 'model') {
    overlay.model = p.changes.model;
    text = `Modèle appris sur ${p.changes.model?.samples || 0} mix de ${p.changes.model?.installs || 0} postes`;
  } else if (p.kind === 'style') {
    // le nom donné par le fondateur (obligatoire pour un style construit à la main) ; ses mots le font reconnaître dans les demandes
    const s = { ...p.changes.style };
    s.name = String(p.styleName || s.name || '').trim().slice(0, 40);
    s.words = s.words?.length && !p.styleName ? [...new Set(s.words.flatMap(styleWordsOf))] : styleWordsOf(s.name);
    (overlay.styles ||= {})[p.target] = s;
    text = `Style de mixage « ${s.name} » (${(s.modules || []).map((m) => m.type).join(' → ')})`;
  } else if (p.kind === 'chain') {
    (overlay.chains ||= {})[p.target] = p.changes.chain;
    text = `${p.name} : chaîne de la communauté (${(p.changes.chain?.modules || []).map((m) => m.type).join(' → ')})`;
  } else {
    // found : l'artiste vient du serveur (le plugin le dit « moins bien connu » tant qu'il n'a pas de voix mesurée)
    overlay.added = overlay.added.filter((a) => norm(a.name) !== p.target).concat([{ ...p.changes.artist, learned: true, found: true }]);
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
  // les voix mesurées par la communauté : seulement là où le dépôt n'en a pas (celles de Nov restent)
  for (const [target, voice] of Object.entries(overlay?.voices || {})) {
    const a = brain.artists.find((b) => norm(b.name) === target || (b.aliases || []).map(norm).includes(target));
    if (a && !a.voice) { a.voice = voice; a.learned = true; }
  }
  brain.corrections = { ...(brain.corrections || {}), global: { ...(overlay?.global || {}) } };
  if (overlay?.model) brain.corrections.model = overlay.model;
  if (overlay?.chains && Object.keys(overlay.chains).length) brain.corrections.chains = overlay.chains;
  // les styles de mixage validés (et nommés) : AUTO MIX les propose quand leurs mots sont dans la demande
  const styles = Object.values(overlay?.styles || {}).filter((s) => s.name && s.words?.length);
  if (styles.length) brain.corrections.styles = styles;
  brain.learned = overlay?.log || [];
  return brain;
}
