// Réunit les traductions (en/*.json) et les dépose là où le site et l'application les lisent :
//
//   node tools/i18n/build.mjs
//   → site/assets/i18n-en.js, app/renderer/i18n-en.js (window.ONIRIQUE_EN), app/renderer/i18n.js (copie du moteur),
//     et le numéro de version des deux fichiers dans les pages (…i18n.js?v=…), pour que les navigateurs les reprennent.
//
// Une traduction doit garder autant de parties variables {} que le texte français : sinon elle est écartée et signalée.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const dict = {};
let rejected = 0;
for (const file of fs.readdirSync(path.join(here, 'en')).sort()) {
  for (const [fr, en] of Object.entries(JSON.parse(fs.readFileSync(path.join(here, 'en', file), 'utf8')))) {
    const holes = (s) => (s.match(/\{\d*\}/g) || []).length;
    if (!/\{\d+\}/.test(en) && holes(fr) !== holes(en)) { console.log(`  écarté (${file}) : « ${fr.slice(0, 60)} » — ${holes(fr)} {} en français, ${holes(en)} en anglais`); rejected++; continue; }
    if (en && en !== fr) dict[fr] = en;
  }
}
// Les phrases coupées par une mise en forme (un mot en italique, un lien) se traduisent d'un bloc : en-html.json.
const html = {};
for (const [fr, en] of Object.entries(JSON.parse(fs.readFileSync(path.join(here, 'en-html.json'), 'utf8')))) {
  if (en && en !== fr) html[fr.replace(/\s+/g, ' ').trim()] = en;
}
const body = `// Fabriqué par tools/i18n/build.mjs à partir de tools/i18n/en/*.json et en-html.json : ne pas modifier ici.\nwindow.ONIRIQUE_EN = ${JSON.stringify(dict)};\nwindow.ONIRIQUE_EN_HTML = ${JSON.stringify(html)};\n`;
const version = crypto.createHash('sha1').update(body + fs.readFileSync(path.join(repo, 'site/assets/i18n.js'))).digest('hex').slice(0, 8);
fs.writeFileSync(path.join(repo, 'site/assets/i18n-en.js'), body);
fs.writeFileSync(path.join(repo, 'app/renderer/i18n-en.js'), body);
fs.copyFileSync(path.join(repo, 'site/assets/i18n.js'), path.join(repo, 'app/renderer/i18n.js'));

// Le numéro de version dans les pages du site (le moteur charge le dictionnaire avec le même numéro).
let pages = 0;
for (const f of fs.readdirSync(path.join(repo, 'site'))) {
  if (!/\.(html|mjs)$/.test(f)) continue;
  const p = path.join(repo, 'site', f);
  const s = fs.readFileSync(p, 'utf8');
  const t = s.replace(/assets\/i18n\.js(\?v=[\w]+)?"/g, `assets/i18n.js?v=${version}"`);
  if (t !== s) { fs.writeFileSync(p, t); pages++; }
}
console.log(`${Object.keys(dict).length} traductions, ${Object.keys(html).length} blocs${rejected ? `, ${rejected} écartées` : ''} · version ${version} · ${pages} page(s) mises à jour`);
