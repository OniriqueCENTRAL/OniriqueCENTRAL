// LE CERVEAU DE VOCALBOX (CRÉER LE MIX) côté serveur. Seuls les plugins dont l'utilisateur a allumé l'apprentissage
// (menu ⋯ → LEARNING, désactivé au départ) appellent ces routes. Rien n'identifie la personne : pas de compte, pas d'adresse IP
// gardée, jamais d'audio ; un identifiant d'installation tiré au hasard regroupe les retours d'un même poste.
//
//   GET  /api/vocalbox/artist?q=…  la fiche d'un artiste que le cerveau livré ne connaît pas : d'abord la base ; sinon une
//                                  recherche (Gemini + Google Search), faite une fois et gardée pour tout le monde.
//   POST /api/vocalbox/feedback    après CRÉER LE MIX : la demande, le portrait de la voix (des mesures), la chaîne décidée,
//                                  les retouches faites ensuite, la note 👍 / 👎. Ils serviront à corriger le cerveau.
//   GET  /api/vocalbox/brain       le cerveau publié (dépôt + validations des fondateurs), lu par les plugins une fois par jour.
//   GET  /api/vocalbox/founders    (fondateurs) tout : cerveau, propositions, retours. POST /api/vocalbox/proposals/:id : valider
//                                  ou refuser une proposition.
import fs from 'node:fs';
import { config } from './config.js';
import { db, get, all, run, now, setting, setSetting } from './db.js';
import { propose, approve, publishedBrain, describe } from './brainlearn.js';
import { HttpError, rateLimit } from './auth.js';

db.exec(`CREATE TABLE IF NOT EXISTS vocalbox_artists (
  name_norm TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  source TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS vocalbox_misses (
  query_norm TEXT PRIMARY KEY,
  tries INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS vocalbox_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  install TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  request TEXT NOT NULL DEFAULT '',
  artists TEXT NOT NULL DEFAULT '[]',
  hints TEXT NOT NULL DEFAULT '{}',
  profile TEXT NOT NULL DEFAULT '{}',
  plan TEXT NOT NULL DEFAULT '{}',
  final TEXT NOT NULL DEFAULT '{}',
  rating INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`);

// LA FICHE DE VOCALBOX (site et application : le même catalogue), refaite pour la version modulaire, CRÉER LE MIX et
// ONR Neural Learning. Posée une seule fois (réglage vocalbox_fiche) : une retouche faite ensuite dans l'admin reste.
const FICHE = {
  tagline: 'Toute ta chaîne vocale, montée pour ta voix.',
  description: `Toute la chaîne vocale dans un seul plugin : des modules que tu ajoutes et ranges dans l'ordre que tu veux, jusqu'à trois exemplaires du même.

CRÉER LE MIX : décris le mix que tu veux (« voix de SCH », « voix chantée aérienne », « façon SZA ») ou glisse un morceau de référence, puis joue ta prise. VOCALBOX écoute ta voix (boue, résonances, sifflantes, dynamique, chant ou rap) et monte la chaîne réglée pour elle, avec le compte rendu de chaque décision. Il connaît la façon de mixer la voix de plus de 50 artistes, du rap US à la nouvelle scène française.

NETTOYAGE : noise gate, noise suppressor, plosives, résonances, de-esser.
TON : EQ paramétrique 8 bandes (mode dynamique, écoute), EQ analog (LOW, MUD, HI, AIR), Saturation Lab (lampe, analog, bande, transformateur).
DYNAMIQUE : 1176 FET, LA-2A opto, multiband optique 4 bandes, compression parallèle.
EFFETS : réverbe (room, plates, hall, shimmer), delay au tempo avec ducking, doubleur, chorus, flanger, phone.

ONR Neural Learning (facultatif, désactivé au départ) : si tu l'allumes, VOCALBOX apprend de tes notes et de tes retouches, de façon anonyme et sans jamais envoyer de son, pour mieux mixer à chaque mise à jour.

Presets d'usine et presets utilisateur, comparaison A/B, suréchantillonnage 2x, couleur de l'interface au choix. VST3 et version autonome, pour Windows 64 bits.`,
};
if (!get("SELECT 1 FROM settings WHERE key = 'vocalbox_fiche'")) {
  run('UPDATE products SET tagline = ?, description = ? WHERE slug = ?', FICHE.tagline, FICHE.description, 'vocalbox');
  run("INSERT INTO settings (key, value) VALUES ('vocalbox_fiche', '2')");
}

// ---- ONR NEURAL LEARNING, sous le contrôle des fondateurs (voir brainlearn.js) : les retours deviennent des propositions,
//      seulement quand la demande est forte ; un fondateur les valide ou les refuse sur la page Neural. Le cerveau publié
//      (vocalbox_brain, téléchargé par les plugins) = le cerveau du dépôt (vocalbox_brain_base) + la surcouche validée.
db.exec(`CREATE TABLE IF NOT EXISTS vocalbox_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  changes TEXT NOT NULL,
  support TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT
)`);

const baseBrain = () => {
  const stored = setting('vocalbox_brain_base', null);
  if (stored && Array.isArray(stored.artists)) return stored;
  try { return JSON.parse(fs.readFileSync(new URL('./vocalbox-brain.json', import.meta.url), 'utf8')); } catch { return { version: 0, artists: [] }; }
};
const overlayNow = () => setting('vocalbox_overlay', null) || { revision: 0 };
/** Le cerveau publié, recalculé (après une validation, ou quand une version de VOCALBOX apporte un nouveau cerveau). */
export function republishBrain() {
  const brain = publishedBrain(baseBrain(), overlayNow());
  setSetting('vocalbox_brain', brain);
  return brain;
}

/** Les propositions : recalculées depuis tous les retours (une proposition en attente est mise à jour, pas dupliquée). */
export function refreshProposals() {
  const refused = new Set(all("SELECT kind || '|' || target AS k FROM vocalbox_proposals WHERE status = 'refused' AND decided_at > ?",
    now() - 30 * 24 * 3600_000).map((r) => r.k));
  const list = propose(baseBrain(), overlayNow(), all('SELECT * FROM vocalbox_feedback'), all('SELECT name, data, hits FROM vocalbox_artists'), refused);
  const t = now();
  const live = new Set();
  for (const p of list) {
    const pending = get("SELECT id FROM vocalbox_proposals WHERE kind = ? AND target = ? AND status = 'pending'", p.kind, p.target);
    if (pending) run('UPDATE vocalbox_proposals SET name = ?, changes = ?, support = ?, updated_at = ? WHERE id = ?', p.name, JSON.stringify(p.changes), JSON.stringify(p.support), t, pending.id);
    else run('INSERT INTO vocalbox_proposals (kind, target, name, changes, support, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      p.kind, p.target, p.name, JSON.stringify(p.changes), JSON.stringify(p.support), t, t);
    live.add(`${p.kind}|${p.target}`);
  }
  // une demande retombée (de nouveaux retours l'ont contredite) : sa proposition disparaît
  for (const r of all("SELECT id, kind, target FROM vocalbox_proposals WHERE status = 'pending'"))
    if (!live.has(`${r.kind}|${r.target}`)) run("UPDATE vocalbox_proposals SET status = 'expired', decided_at = ? WHERE id = ?", t, r.id);
}
try { refreshProposals(); } catch (error) { console.error('ONR Neural Learning :', error.message); }
setInterval(() => { try { refreshProposals(); } catch (error) { console.error('ONR Neural Learning :', error.message); } }, 3 * 3600_000).unref();
if (!setting('vocalbox_brain', null)) republishBrain();

// les retours d'apprentissage sont gardés trois ans au plus (voir la politique de confidentialité)
const purgeFeedback = () => run('DELETE FROM vocalbox_feedback WHERE created_at < ?', now() - 3 * 365 * 24 * 3600_000);
purgeFeedback();
setInterval(purgeFeedback, 24 * 3600_000).unref();

/** Minuscules, sans accents ni ponctuation : la clé d'un artiste. */
export const normArtist = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 &$]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

const NUMBERS = { bright: [0, 1], air: [0, 1], warm: [0, 1], dark: [0, 1], comp: [-1, 1], reverb: [0, 1], reverbSize: [0, 1],
  delay: [0, 1], sat: [0, 1], doubler: [0, 1], chorus: [0, 1], flanger: [0, 1], phone: [0, 1] };
const BOOLS = ['controlled', 'parallel', 'dreamy'];

/** Une fiche propre : les seuls champs du cerveau, bornés (rien d'autre de la réponse de l'IA n'arrive au plugin). */
export function cleanArtist(raw, fallbackName) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || fallbackName || '').trim().slice(0, 60);
  if (!name) return null;
  const hints = {};
  const h = raw.hints && typeof raw.hints === 'object' ? raw.hints : {};
  for (const [k, [lo, hi]] of Object.entries(NUMBERS)) {
    const v = Number(h[k]);
    if (Number.isFinite(v)) hints[k] = Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100;
  }
  const st = Number(h.satType);
  if (Number.isInteger(st) && st >= 0 && st <= 3) hints.satType = st;
  for (const k of BOOLS) if (h[k] === true) hints[k] = true;
  const aliases = [...new Set([name, ...(Array.isArray(raw.aliases) ? raw.aliases : [])]
    .map((a) => normArtist(a)).filter((a) => a.length >= 2))].slice(0, 6);
  return { name, genre: String(raw.genre || '').slice(0, 30), aliases, hints };
}

const PROMPT = (q) => `Tu es ingénieur du son spécialisé en mixage de voix. Cherche comment la VOIX de l'artiste « ${q} » est
mixée dans ses morceaux les plus connus (interviews d'ingénieurs du son, articles, analyses). Si « ${q} » n'est pas un artiste
musical identifiable, réponds exactement {"unknown": true}.
Sinon réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"name": "Nom officiel", "genre": "rap|rnb|pop|rap fr|drill|afro|latin|rock|electro", "aliases": ["surnoms courants"],
 "hints": {"bright":0..1, "air":0..1, "warm":0..1, "dark":0..1, "comp":-1..1, "reverb":0..1, "reverbSize":0..1, "delay":0..1,
 "sat":0..1, "satType":0 lampe|1 analog|2 bande|3 transformateur, "doubler":0..1, "chorus":0..1, "controlled":true|false,
 "parallel":true|false, "dreamy":true|false}}
Échelles : 0 = absent, 1 = très marqué ; comp -1 très naturel, 1 très compressé et en avant ; reverb = quantité d'espace ;
reverbSize 0 pièce, 1 grand espace ; controlled = voix très maîtrisée (multiband) ; parallel = compression parallèle épaisse.
N'inclus que les champs dont tu es raisonnablement sûr.`;

/** La recherche : Gemini avec Google Search ; si la recherche web n'est pas ouverte à la clé (offre gratuite : quota nul),
 *  Gemini répond de ce qu'il sait des artistes. null si rien n'aboutit. */
async function research(q) {
  if (!config.geminiApiKey) return null;
  const ask = (withSearch) => fetch(`${config.geminiApi}/v1beta/models/${config.geminiModel}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(45_000),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: PROMPT(q) }] }],
      ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: { maxOutputTokens: 2048, temperature: 0.2 } }),
  }).catch(() => null);
  let r = await ask(true);
  if (r && (r.status === 429 || r.status === 400 || r.status === 403)) r = await ask(false);
  const data = r && (await r.json().catch(() => null));
  const text = data?.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text || '').join('') || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!r?.ok || !m) { console.error('VocalBox cerveau :', r?.status, data?.error?.message || 'réponse illisible'); return null; }
  try {
    const obj = JSON.parse(m[0]);
    if (obj.unknown) return { unknown: true };
    return cleanArtist(obj, q);
  } catch { return null; }
}

const pending = new Map();   // une seule recherche à la fois par artiste

export function mountVocalBrain(app, { wrap, requireUser }) {
  app.get('/api/vocalbox/artist', wrap(async (req, res) => {
    rateLimit(`vbartist:${req.ip}`, 30, 60 * 60_000);
    const q = normArtist(req.query.q);
    if (q.length < 2) throw new HttpError(400, 'Artiste ?');
    res.set('Cache-Control', 'no-store');
    const known = get('SELECT data FROM vocalbox_artists WHERE name_norm = ?', q)
      || get("SELECT data FROM vocalbox_artists WHERE EXISTS (SELECT 1 FROM json_each(json_extract(data, '$.aliases')) WHERE value = ?)", q);
    if (known) {
      run('UPDATE vocalbox_artists SET hits = hits + 1 WHERE name_norm = ?', q);
      return res.json({ artist: JSON.parse(known.data) });
    }
    // un nom déjà cherché sans succès : pas de nouvelle recherche avant une semaine
    const miss = get('SELECT last_at FROM vocalbox_misses WHERE query_norm = ?', q);
    if (miss && now() - miss.last_at < 7 * 24 * 3600_000) return res.json({ unknown: true });
    if (!pending.has(q)) pending.set(q, research(q).finally(() => pending.delete(q)));
    const found = await pending.get(q);
    if (!found || found.unknown) {
      run('INSERT INTO vocalbox_misses (query_norm, tries, last_at) VALUES (?, 1, ?) ON CONFLICT (query_norm) DO UPDATE SET tries = tries + 1, last_at = excluded.last_at', q, now());
      return res.json({ unknown: true });
    }
    run('INSERT OR REPLACE INTO vocalbox_artists (name_norm, name, data, source, hits, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      normArtist(found.name), found.name, JSON.stringify(found), 'gemini', now());
    if (normArtist(found.name) !== q)   // la demande (un surnom) mène aussi à la fiche
      found.aliases = [...new Set([...found.aliases, q])];
    res.json({ artist: found });
  }));

  app.post('/api/vocalbox/feedback', wrap(async (req, res) => {
    rateLimit(`vbfeed:${req.ip}`, 60, 60 * 60_000);
    const b = req.body || {};
    const install = String(b.install || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
    if (install.length < 16) throw new HttpError(400, 'Installation ?');
    const json = (v, max) => { const s = JSON.stringify(v ?? {}); if (s.length > max) throw new HttpError(413, 'Trop gros.'); return s; };
    const rating = [-1, 0, 1].includes(Number(b.rating)) ? Number(b.rating) : 0;
    run(`INSERT INTO vocalbox_feedback (install, version, request, artists, hints, profile, plan, final, rating, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      install, String(b.version || '').slice(0, 20), String(b.request || '').slice(0, 300), json(b.artists || [], 2000),
      json(b.hints, 4000), json(b.profile, 8000), json(b.plan, 20000), json(b.final, 20000), rating, now());
    res.json({ ok: true });
  }));

  app.get('/api/vocalbox/brain', wrap(async (_req, res) => {
    const brain = setting('vocalbox_brain', '');
    res.set('Cache-Control', 'public, max-age=3600');
    if (!brain) return res.json({ version: 0 });
    res.type('application/json').send(brain);
  }));

  // LA PAGE DES FONDATEURS (site/neural.html) : tout ce qu'ONR Neural Learning a appris, en entier. Le cerveau livré dans le
  // plugin (copie de OniriqueVocalBox/Resources/vocalbox-brain.json), les artistes trouvés par le serveur, les noms introuvables,
  // et les retours des utilisateurs qui ont allumé l'option (anonymes : un identifiant d'installation tiré au hasard).
  app.get('/api/vocalbox/founders', requireUser, wrap(async (req, res) => {
    if (req.user.role !== 'founder') throw new HttpError(403, 'Réservé aux fondateurs.');
    res.set('Cache-Control', 'no-store');
    const shipped = setting('vocalbox_brain', null) || republishBrain();   // le cerveau publié : dépôt + ce que les fondateurs ont validé
    const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
    const feedback = all('SELECT * FROM vocalbox_feedback ORDER BY id DESC LIMIT 2000').map((r) => ({
      id: r.id, install: r.install, version: r.version, request: r.request, artists: parse(r.artists, []), hints: parse(r.hints, {}),
      profile: parse(r.profile, {}), plan: parse(r.plan, {}), final: parse(r.final, {}), rating: r.rating, at: r.created_at,
    }));
    const found = all('SELECT name, data, source, hits, created_at FROM vocalbox_artists ORDER BY hits DESC')
      .map((r) => ({ ...parse(r.data, {}), source: r.source, hits: r.hits, at: r.created_at }));
    const misses = all('SELECT query_norm AS query, tries, last_at AS at FROM vocalbox_misses ORDER BY last_at DESC LIMIT 300');
    const proposals = all("SELECT * FROM vocalbox_proposals WHERE status = 'pending' OR decided_at > ? ORDER BY status = 'pending' DESC, updated_at DESC LIMIT 100",
      now() - 60 * 24 * 3600_000).map((p) => ({ ...p, changes: parse(p.changes, {}), support: parse(p.support, {}), text: p.kind === 'add' ? '' : describe(parse(p.changes, {})) }));
    res.json({ shipped, base: { version: baseBrain().version || 0 }, proposals, found, misses, feedback,
      installs: get('SELECT COUNT(DISTINCT install) AS n FROM vocalbox_feedback').n });
  }));

  // un fondateur valide ou refuse une proposition ; validée, elle rejoint le cerveau publié (téléchargé par les plugins)
  app.post('/api/vocalbox/proposals/:id', requireUser, wrap(async (req, res) => {
    if (req.user.role !== 'founder') throw new HttpError(403, 'Réservé aux fondateurs.');
    const decision = req.body?.decision;
    if (!['approve', 'refuse'].includes(decision)) throw new HttpError(400, 'Valider ou refuser ?');
    const row = get("SELECT * FROM vocalbox_proposals WHERE id = ? AND status = 'pending'", Number(req.params.id));
    if (!row) throw new HttpError(404, 'Proposition introuvable ou déjà traitée.');
    const by = req.user.name || req.user.email;
    if (decision === 'approve') {
      setSetting('vocalbox_overlay', approve(overlayNow(), { ...row, changes: JSON.parse(row.changes) }, by, now()));
      republishBrain();
    }
    run('UPDATE vocalbox_proposals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?', decision === 'approve' ? 'approved' : 'refused', now(), by, row.id);
    res.json({ ok: true, revision: overlayNow().revision || 0 });
  }));
}
