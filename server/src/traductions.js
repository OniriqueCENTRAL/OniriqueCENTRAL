// LES FICHES DES PLUGINS EN ANGLAIS, toutes seules. Le site se traduit par un dictionnaire fabriqué à la main
// (tools/i18n → site/assets/i18n-en.js), mais les fiches des plugins sont en base : un plugin ajouté ou retouché par
// un collègue restait en français sur le site anglais. Le serveur repère chaque phrase de fiche (accroche et
// paragraphes de la description) qui n'a pas de traduction, la fait traduire par l'IA (ia.js), la garde (fiches_en)
// et la sert au site : /api/i18n-fiches.js, chargé par i18n.js en anglais, et « en » dans /api/catalog pour
// l'application. Une traduction faite à la main dans tools/i18n/en garde toujours la priorité.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { all, get, run, now } from './db.js';
import { askIA, iaReady } from './ia.js';
import { rateLimit } from './auth.js';

run(`CREATE TABLE IF NOT EXISTS fiches_en (fr TEXT PRIMARY KEY, en TEXT NOT NULL, created_at INTEGER NOT NULL)`);

const plain = (s) => String(s || '').replace(/’/g, "'").replace(/\s+/g, ' ').trim();

// Le dictionnaire fait à la main, tel que le site le reçoit.
const SITE_DIRS = [process.env.SITE_DIR, path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site'), '/var/www/site'];
let manual = null;
function manualKeys() {
  if (manual) return manual;
  manual = new Set();
  const dir = SITE_DIRS.find((d) => d && fs.existsSync(path.join(d, 'assets', 'i18n-en.js')));
  if (!dir) return manual;
  try {
    const window = {};
    vm.runInNewContext(fs.readFileSync(path.join(dir, 'assets', 'i18n-en.js'), 'utf8'), { window }, { timeout: 2000 });
    for (const fr of Object.keys(window.ONIRIQUE_EN || {})) manual.add(plain(fr));
  } catch (e) {
    console.error('traductions, dictionnaire :', e.message);
  }
  return manual;
}

/** Les phrases d'une fiche, telles que les pages les affichent (un paragraphe par bloc séparé d'une ligne vide). */
export const fichePieces = (p) => [p.tagline, ...String(p.description || '').split(/\n{2,}/)].map(plain).filter((t) => /[a-zà-ÿ]{3}/i.test(t));

/** Les phrases des fiches en ligne qui n'ont encore aucune traduction. */
export function missingPieces() {
  const known = manualKeys();
  const done = new Set(all('SELECT fr FROM fiches_en').map((r) => r.fr));
  const out = new Set();
  for (const p of all('SELECT tagline, description FROM products WHERE published = 1')) {
    for (const t of fichePieces(p)) if (!known.has(t) && !done.has(t)) out.add(t);
  }
  return [...out];
}

/** Les traductions faites par le serveur : { phrase française : traduction }. */
export const fichesEn = () => Object.fromEntries(all('SELECT fr, en FROM fiches_en').map((r) => [r.fr, r.en]));

const SYSTEM = `Tu traduis en anglais les fiches de plugins audio d'ONIRIQUE (onirique.store) pour la version anglaise du site.
Ton : naturel, direct, tutoiement français → « you », comme un producteur qui parle à un autre. Pas de traduction mot à mot.
Garde tels quels : les noms de plugins et de marques (ONIRIQUE, VOCALBOX…), les noms des réglages en MAJUSCULES (ATTACK,
MIX, DELTA…), les nombres et unités (dB, Hz, ms, %), les formats (VST3, AU). Une phrase déjà en anglais reste telle quelle.
On te donne un objet JSON { "numéro": "texte français" }. Réponds uniquement avec un objet JSON { "numéro": "English text" },
mêmes numéros, sans rien autour.`;

// ——— Les textes du site ———
// Le dictionnaire fait à la main ne suit pas chaque nouvelle page ni chaque nouvel outil. En anglais, i18n.js signale au
// serveur les textes qu'il n'a pas su traduire (POST /api/i18n-manque). Le serveur ne retient que ceux écrits tels quels
// dans les fichiers du site (jamais un texte venu d'un compte : message, profil, nom de fichier…), les fait traduire par
// l'IA (site_en) et les sert avec les fiches. Au démarrage, il relève aussi tout seul les textes des pages HTML.
run(`CREATE TABLE IF NOT EXISTS site_en (fr TEXT PRIMARY KEY, en TEXT, tries INTEGER NOT NULL DEFAULT 0, asked_at INTEGER NOT NULL, created_at INTEGER)`);

const decode = (s) => s.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;|&rsquo;/g, "'").replace(/&rarr;/g, '→').replace(/&larr;/g, '←').replace(/&times;/g, '×').replace(/&middot;/g, '·')
  .replace(/&hellip;/g, '…').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»');

let index = { text: '', at: 0, pages: [] };
/** Les fichiers du site réunis en un texte où chercher (refait toutes les 10 minutes : une mise en ligne y entre vite). */
function siteIndex() {
  if (Date.now() - index.at < 10 * 60_000) return index;
  const dir = SITE_DIRS.find((d) => d && fs.existsSync(path.join(d, 'assets', 'i18n.js')));
  const parts = [], pages = [];
  const visit = (d, depth) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) {
        if (depth < 1 && !/^(media|node_modules|telechargement|vendor|fonts|img|images|docs|demos?)$/i.test(f.name)) visit(p, depth + 1);
      } else if (f.name.endsWith('.html')) {
        const s = fs.readFileSync(p, 'utf8');
        parts.push(decode(s)); pages.push(s);
      } else if (/\.m?js$/.test(f.name) && !/i18n|worker|\.min\./.test(f.name)) {
        parts.push(fs.readFileSync(p, 'utf8'));
      }
    }
  };
  try { if (dir) visit(dir, 0); } catch (e) { console.error('traductions, site :', e.message); }
  // Les échappements JavaScript et les espaces insécables ne comptent pas.
  const text = plain(parts.join('\n').replace(/\\u00a0|\\u202f/g, ' ').replace(/\\[nt]/g, ' ').replace(/\\(['"`])/g, '$1').replace(/[\u00a0\u202f]/g, ' '));
  index = { text, at: Date.now(), pages };
  return index;
}

/** Un texte à traduire : des lettres en minuscules (pas un nom de marque en capitales), pas du code. */
const looksLikeText = (t) => t.length >= 2 && t.length <= 400 && /[a-zà-ÿ]{2}/.test(t) && !/[{}<>]|=>|;\s*$|^[\w-]+$/.test(t)
  && !/^(https?:|\/|#|\.)/.test(t);

/** Les textes des pages HTML du site, comme i18n.js les voit (un nœud de texte ou un attribut à la fois). */
function pageTexts() {
  const out = new Set();
  for (const html of siteIndex().pages) {
    const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ');
    for (const m of body.matchAll(/\b(?:placeholder|title|aria-label|alt)="([^"]*)"/g)) out.add(plain(decode(m[1])));
    for (const piece of body.replace(/<[^>]+>/g, '\u0000').split('\u0000')) out.add(plain(decode(piece)));
  }
  return [...out].filter(looksLikeText);
}

let soon = null;
/** Met des textes en attente de traduction (seulement ceux du site, pas encore traduits). Rend le nombre ajouté. */
export function queueSite(texts, { checkSite = true } = {}) {
  const known = manualKeys();
  const site = checkSite ? siteIndex().text : '';
  const pending = get('SELECT COUNT(*) AS n FROM site_en WHERE en IS NULL').n;
  let added = 0;
  for (const raw of texts) {
    const t = plain(String(raw || ''));
    if (pending + added >= 3000) break;
    if (!looksLikeText(t) || known.has(t)) continue;
    if (checkSite && !site.includes(t)) continue;
    if (get('SELECT 1 AS yes FROM site_en WHERE fr = ?', t) || get('SELECT 1 AS yes FROM fiches_en WHERE fr = ?', t)) continue;
    run('INSERT INTO site_en (fr, asked_at) VALUES (?, ?)', t, now());
    added++;
  }
  // Traduit une minute plus tard : les signalements d'une même visite partent ensemble.
  if (added && !soon && process.env.NODE_ENV !== 'test') soon = setTimeout(() => { soon = null; translateMissing(); }, 60_000);
  if (soon?.unref) soon.unref();
  return added;
}

/** Les traductions des textes du site faites par le serveur. */
export const siteEn = () => Object.fromEntries(all(`SELECT fr, en FROM site_en WHERE en IS NOT NULL AND en != ''`).map((r) => [r.fr, r.en]));

const SITE_SYSTEM = `Tu traduis en anglais les textes de l'interface du site ONIRIQUE (onirique.store) : plugins audio, outils
gratuits pour musiciens (retouche photo, recadrage vidéo, mastering…), compte, boutique. Ce sont des boutons, des menus, des
titres, des aides et des phrases d'explication. Ton : naturel et direct, tutoiement → « you ». Garde la ponctuation de la
source (« … » à la fin d'un menu, deux-points, majuscule au début seulement si la source en a une) et les termes
habituels des logiciels de retouche et de musique en anglais (Gaussian Blur, Twirl, Unsharp Mask, Layer Style…). Garde
tels quels : les noms de marques et de plugins (ONIRIQUE, VOCALBOX, ROCKY…), les mots en MAJUSCULES, les nombres et
unités, les raccourcis (Ctrl+…). Un texte déjà en anglais reste tel quel.
On te donne un objet JSON { "numéro": "texte français" }. Réponds uniquement avec un objet JSON { "numéro": "English text" },
mêmes numéros, sans rien autour.`;

let busy = false;
async function translateBatch(system, part) {
  const input = Object.fromEntries(part.map((t, n) => [String(n + 1), t]));
  const reply = await askIA({ system, messages: [{ role: 'user', content: JSON.stringify(input) }], maxTokens: 8000, timeout: 90_000 });
  try { return JSON.parse(String(reply || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; }
}
const usable = (fr, en) => typeof en === 'string' && en.trim() && en.trim().length <= fr.length * 3 + 40;

/** Traduit ce qui manque (fiches, puis textes du site), par lots. Pas d'IA ou déjà en cours : rien. Rend le nombre traduit. */
export async function translateMissing({ batch = 20 } = {}) {
  if (busy || !iaReady()) return 0;
  busy = true;
  let count = 0;
  try {
    const todo = missingPieces();
    for (let i = 0; i < todo.length; i += batch) {
      const part = todo.slice(i, i + batch);
      const out = await translateBatch(SYSTEM, part);
      if (!out || typeof out !== 'object') { console.error('traductions : réponse illisible'); break; }
      part.forEach((fr, n) => {
        const en = out[String(n + 1)];
        // Une traduction vide ou démesurée est écartée : la phrase sera retentée au prochain passage.
        if (!usable(fr, en) || get('SELECT 1 FROM fiches_en WHERE fr = ?', fr)) return;
        run('INSERT INTO fiches_en (fr, en, created_at) VALUES (?, ?, ?)', fr, en.trim(), now());
        count++;
      });
    }
    // Les textes du site : trois essais au plus par texte.
    const site = all('SELECT fr FROM site_en WHERE en IS NULL AND tries < 3 ORDER BY asked_at LIMIT 600').map((r) => r.fr);
    for (let i = 0; i < site.length; i += 40) {
      const part = site.slice(i, i + 40);
      const out = await translateBatch(SITE_SYSTEM, part);
      part.forEach((fr, n) => {
        const en = out && typeof out === 'object' ? out[String(n + 1)] : null;
        if (usable(fr, en)) { run('UPDATE site_en SET en = ?, created_at = ? WHERE fr = ?', en.trim(), now(), fr); count++; }
        else run('UPDATE site_en SET tries = tries + 1 WHERE fr = ?', fr);
      });
    }
  } catch (e) {
    console.error('traductions :', e.message);
  } finally {
    busy = false;
  }
  if (count) console.log(`Traduit en anglais : ${count} texte${count > 1 ? 's' : ''}.`);
  return count;
}

export function mountTraductions(app) {
  // Chargé par i18n.js en anglais, juste après le dictionnaire : les fiches et les textes du site traduits par le serveur.
  app.get('/api/i18n-fiches.js', (_req, res) => {
    res.type('application/javascript').set('Cache-Control', 'public, max-age=300')
      .send(`window.ONIRIQUE_EN_FICHES = ${JSON.stringify({ ...siteEn(), ...fichesEn() }).replace(/</g, '\\u003c')};\n`);
  });
  // Les textes qu'une page anglaise n'a pas su traduire (i18n.js) : retenus s'ils sont écrits dans le site.
  app.post('/api/i18n-manque', (req, res) => {
    rateLimit(`i18n:${req.ip}`, 40, 60 * 60_000);
    const texts = Array.isArray(req.body?.textes) ? req.body.textes.slice(0, 80).filter((t) => typeof t === 'string') : [];
    res.json({ added: queueSite(texts) });
  });
  // Un passage peu après le démarrage (avec les textes des pages HTML), puis toutes les 15 minutes : un plugin publié ou
  // une nouvelle page est en anglais dans le quart d'heure.
  if (process.env.NODE_ENV !== 'test') {
    setTimeout(() => { try { queueSite(pageTexts(), { checkSite: false }); } catch (e) { console.error('traductions, pages :', e.message); } translateMissing(); }, 20_000).unref();
    setInterval(() => translateMissing(), 15 * 60_000).unref();
  }
}

export const _test = { pageTexts, siteIndex, looksLikeText };
