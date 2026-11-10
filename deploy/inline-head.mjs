// À la mise en ligne : les petits fichiers que chaque page doit lire avant son premier affichage (langue, réglages,
// bandeau d'annonce, couleur du compte, polices, charte) sont recopiés dans la page elle-même. Le navigateur n'attend
// plus six requêtes avant de dessiner. Les fichiers restent dans assets/ pour l'application et les autres pages.
//   node deploy/inline-head.mjs <dossier du site>
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage : node inline-head.mjs <dossier du site>'); process.exit(1); }
const read = (name) => fs.readFileSync(path.join(dir, 'assets', name), 'utf8');
const SCRIPTS = /<script src="(\/?assets\/(i18n|ui|annonce|accent)\.js(\?v=[\w]+)?)"><\/script>/g;
const STYLES = /<link rel="stylesheet" href="(\/?assets\/(fonts|da)\.css(\?v=[\w]+)?)">/g;
const cache = {};
const js = (name) => (cache[name] ??= read(name).replace(/<\/script/gi, '<\/script'));
// Les adresses relatives d'une feuille (url(fonts/…)) partaient de assets/ : elles le gardent une fois dans la page.
const css = (name) => (cache[name] ??= read(name).replace(/url\((['"]?)(?![a-z]+:|\/|#)/gi, 'url($1/assets/'));

let pages = 0;
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.html')) continue;
  const file = path.join(dir, f);
  const before = fs.readFileSync(file, 'utf8');
  const after = before
    // data-src : i18n.js y lit le numéro de version du dictionnaire, comme dans son adresse.
    .replace(SCRIPTS, (_m, src, name) => `<script data-src="${src}">${js(name + '.js')}</script>`)
    .replace(STYLES, (_m, _href, name) => `<style>${css(name + '.css')}</style>`);
  if (after !== before) { fs.writeFileSync(file, after); pages++; }
}
console.log(`En-têtes intégrés dans ${pages} page(s).`);
