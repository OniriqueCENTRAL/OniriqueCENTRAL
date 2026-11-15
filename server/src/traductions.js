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

let busy = false;
/** Traduit ce qui manque, par lots. Rien à faire, pas d'IA ou déjà en cours : ne fait rien. Rend le nombre traduit. */
export async function translateMissing({ batch = 20 } = {}) {
  if (busy || !iaReady()) return 0;
  busy = true;
  let count = 0;
  try {
    const todo = missingPieces();
    for (let i = 0; i < todo.length; i += batch) {
      const part = todo.slice(i, i + batch);
      const input = Object.fromEntries(part.map((t, n) => [String(n + 1), t]));
      const reply = await askIA({ system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(input) }], maxTokens: 8000, timeout: 90_000 });
      let out = null;
      try { out = JSON.parse(String(reply || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { out = null; }
      if (!out || typeof out !== 'object') { console.error('traductions : réponse illisible'); break; }
      part.forEach((fr, n) => {
        const en = typeof out[String(n + 1)] === 'string' ? out[String(n + 1)].trim() : '';
        // Une traduction vide ou démesurée est écartée : la phrase sera retentée au prochain passage.
        if (!en || en.length > fr.length * 3 + 40 || get('SELECT 1 FROM fiches_en WHERE fr = ?', fr)) return;
        run('INSERT INTO fiches_en (fr, en, created_at) VALUES (?, ?, ?)', fr, en, now());
        count++;
      });
    }
  } catch (e) {
    console.error('traductions :', e.message);
  } finally {
    busy = false;
  }
  if (count) console.log(`Fiches traduites en anglais : ${count} phrase${count > 1 ? 's' : ''}.`);
  return count;
}

export function mountTraductions(app) {
  // Chargé par i18n.js en anglais, juste après le dictionnaire : les phrases des fiches traduites par le serveur.
  app.get('/api/i18n-fiches.js', (_req, res) => {
    res.type('application/javascript').set('Cache-Control', 'public, max-age=300')
      .send(`window.ONIRIQUE_EN_FICHES = ${JSON.stringify(fichesEn()).replace(/</g, '\\u003c')};\n`);
  });
  // Un passage peu après le démarrage, puis toutes les 15 minutes : un plugin publié est traduit dans le quart d'heure.
  if (process.env.NODE_ENV !== 'test') {
    setTimeout(() => translateMissing(), 20_000).unref();
    setInterval(() => translateMissing(), 15 * 60_000).unref();
  }
}
