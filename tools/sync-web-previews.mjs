// Copie sur le site les interfaces web réelles des plugins qui en ont une, pour servir d'aperçu dans la boutique
// et sur la page d'accueil (à la place de la démo en images de onirique-probe) :
//
//   node tools/sync-web-previews.mjs            (depuis la racine du dépôt, les dépôts des plugins à côté)
//
// L'interface est prise telle quelle dans le dépôt du plugin : hors DAW, elle tourne en « aperçu simulé »
// (aucun son, visuels simulés). Seules les polices sont remplacées par celles du site, qui ne charge rien chez Google.
// Après une mise à jour de l'interface du plugin : relancer, enregistrer, mettre en ligne.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugins = path.resolve(root, '..');
const out = path.join(root, 'site', 'previews');

// slug du catalogue → interface web dans le dépôt du plugin, et taille de la fenêtre du plugin : la page y est
// affichée telle qu'elle est dans le DAW, puis réduite pour tenir dans la boutique (jamais tassée).
const PREVIEWS = {
  // width × height : la taille de la fenêtre du plugin (BASE_W, BASE_H dans RAW/src/plugin.cpp).
  'onirique-x-abrasion-raw': { source: 'RAW/src/ui/raw_ui.html', width: 1100, height: 760 },
};

fs.mkdirSync(out, { recursive: true });
const manifest = {};
for (const [slug, { source, width, height }] of Object.entries(PREVIEWS)) {
  const file = path.join(plugins, source);
  if (!fs.existsSync(file)) { console.log(`${slug} : ${source} introuvable, laissé tel quel`); continue; }
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, '')
    .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*">/g, '<link rel="stylesheet" href="/assets/fonts.css">');
  if (/fonts\.googleapis|fonts\.gstatic/.test(html)) throw new Error(`${slug} : une police vient encore de Google`);
  fs.writeFileSync(path.join(out, `${slug}.html`), html);
  manifest[slug] = { url: `/previews/${slug}.html`, width, height };
  console.log(`${slug} : ${Math.round(html.length / 1024)} Ko`);
}
fs.writeFileSync(path.join(out, 'previews.json'), JSON.stringify(manifest, null, 2) + '\n');
