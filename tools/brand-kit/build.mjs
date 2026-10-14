// Fabrique la charte graphique d'ONIRIQUE pour les réseaux : logos, couleurs, polices, modèles prêts à publier
// et le guide en PDF, dans un dossier puis un .zip. Les images sont dessinées par Chrome à partir de pages HTML,
// avec les polices et le logo du site : elles suivent la charte du site telle qu'elle est.
//
//   node tools/brand-kit/build.mjs <dossier de sortie>
//   → <sortie>/ONIRIQUE-charte-graphique/…  et  <sortie>/ONIRIQUE-charte-graphique.zip
//
// Le .zip se dépose ensuite sur le serveur (deploy/upload-brand-kit.sh) : les fondateurs le téléchargent depuis le
// panel admin du site.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const site = path.join(repo, 'site');
const outRoot = path.resolve(process.argv[2] || path.join(repo, 'tools', 'brand-kit', 'out'));
const kit = path.join(outRoot, 'ONIRIQUE-charte-graphique');
const work = path.join(outRoot, '_pages');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

fs.rmSync(outRoot, { recursive: true, force: true });
for (const dir of ['logos', 'couleurs', 'polices', 'reseaux', 'reseaux/fonds-vides', 'motifs']) fs.mkdirSync(path.join(kit, dir), { recursive: true });
fs.mkdirSync(work, { recursive: true });

//------------------------------------------------------------------------------ La charte
const C = {
  night: ['#0D0809', 'Nuit', 'Le fond de tout : pages, visuels, interfaces.'],
  deep: ['#1A080A', 'Profondeur', 'Les cartes et panneaux posés sur la nuit.'],
  deep2: ['#2A0A0E', 'Profondeur 2', 'Le haut des panneaux, en dégradé vers Profondeur.'],
  blood: ['#5C0008', 'Sang', 'Le halo rouge en haut des pages, toujours en dégradé vers la nuit.'],
  ember: ['#E23444', 'Braise', 'La couleur d\'accent : boutons, étoile, éléments actifs. Avec parcimonie.'],
  emberText: ['#FF6B78', 'Braise claire', 'La braise pour un texte ou un lien sur fond sombre (lisible).'],
  mist: ['#F6EEEE', 'Brume', 'Le texte principal et les boutons blancs.'],
  bone: ['#FFECEE', 'Os', 'Les textes mis en valeur, les codes, les chiffres.'],
  haze: ['#A88F92', 'Voile', 'Les textes secondaires, légendes, petites étiquettes.'],
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
const FONTS = [
  ['Unbounded', 'Titres, nom de marque, prix', 'Unbounded-latin.woff2', 'https://fonts.google.com/specimen/Unbounded', 800],
  ['Grenze Gotisch', 'Le mot « rêvé » d\'un titre (une ou deux par titre, avec le halo)', 'GrenzeGotisch-latin.woff2', 'https://fonts.google.com/specimen/Grenze+Gotisch', 600],
  ['Hanken Grotesk', 'Textes courants, descriptions, boutons', 'HankenGrotesk-latin.woff2', 'https://fonts.google.com/specimen/Hanken+Grotesk', 400],
  ['JetBrains Mono', 'Petites étiquettes en capitales espacées, chiffres techniques', 'JetBrainsMono-latin.woff2', 'https://fonts.google.com/specimen/JetBrains+Mono', 500],
];

const fontFaces = fs.readFileSync(path.join(site, 'assets', 'fonts.css'), 'utf8')
  .replace(/url\(fonts\//g, `url(${pathToFileURL(path.join(site, 'assets', 'fonts')).href}/`);
const sigil = pathToFileURL(path.join(site, 'assets', 'logo.png')).href; // l'étoile-logo sur fond transparent
const logoBg = pathToFileURL(path.join(site, 'assets', 'logo-original.png')).href;

const STAR = (size, color = '#F6EEEE', glow = '#E23444') => `<svg width="${size}" height="${size}" viewBox="0 0 64 64" style="filter:drop-shadow(0 0 ${size / 6}px ${glow})"><path d="M32 2L35.6 28.4L62 32L35.6 35.6L32 62L28.4 35.6L2 32L28.4 28.4Z" fill="${color}"/></svg>`;

const page = (width, height, body, extra = '') => `<!doctype html><html lang="fr"><meta charset="utf-8"><style>
${fontFaces}
* { box-sizing: border-box; margin: 0; }
html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
body { background: ${C.night[0]}; color: ${C.mist[0]}; font-family: "Hanken Grotesk", sans-serif; -webkit-font-smoothing: antialiased; }
.sky { position: absolute; inset: 0; background: radial-gradient(120% 70% at 50% -12%, rgba(140,6,20,.95), rgba(92,0,8,.55) 38%, transparent 74%), ${C.night[0]}; }
.grain { position: absolute; inset: 0; opacity: .07; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
.word { font: 800 1em/1 "Unbounded", sans-serif; letter-spacing: .3em; }
.dream { font: 600 1em/1 "Grenze Gotisch", serif; text-shadow: 0 0 .1em rgba(255,255,255,.55), 0 0 .4em rgba(255,190,196,.45), 0 0 .9em rgba(226,52,68,.6); }
.eyebrow { font: 500 1em/1 "JetBrains Mono", monospace; letter-spacing: .2em; text-transform: uppercase; color: ${C.haze[0]}; display: flex; align-items: center; gap: .8em; }
.sigil { filter: drop-shadow(0 0 30px rgba(226,52,68,.7)); }
${extra}
</style><body>${body}</body></html>`;

const shots = [];
function shot(name, width, height, html, dest = 'reseaux') {
  const file = path.join(work, `${name}.html`);
  fs.writeFileSync(file, html);
  shots.push({ file, out: path.join(kit, dest, `${name}.png`), width, height });
}

//------------------------------------------------------------------------------ Logos
shot('logo-carre-fond-nuit-2048', 2048, 2048, page(2048, 2048,
  `<div class="sky"></div><div class="grain"></div><img class="sigil" src="${sigil}" style="position:absolute;left:224px;top:300px;width:1600px">`), 'logos');
shot('logo-avec-nom-3000x1200', 3000, 1200, page(3000, 1200,
  `<div class="sky"></div><div class="grain"></div><img class="sigil" src="${sigil}" style="position:absolute;left:140px;top:150px;width:1000px">
   <div class="word" style="position:absolute;left:1230px;top:470px;font-size:190px">ONIRIQUE</div>
   <div class="eyebrow" style="position:absolute;left:1240px;top:740px;font-size:44px">${STAR(44)}plugins audio</div>`), 'logos');
shot('nom-seul-transparent-2400x400', 2400, 400, page(2400, 400,
  `<div class="word" style="position:absolute;left:60px;top:110px;font-size:170px">ONIRIQUE</div>`, 'html, body { background: transparent !important; }'), 'logos');

//------------------------------------------------------------------------------ Réseaux : fonds vides (à garnir dans Canva) et exemples
const FORMATS = [
  ['photo-de-profil-1080', 1080, 1080, 'Photo de profil (tous réseaux)'],
  ['banniere-youtube-2560x1440', 2560, 1440, 'Bannière YouTube (zone visible partout : 1546 × 423 au centre)'],
  ['banniere-x-1500x500', 1500, 500, 'En-tête X (Twitter)'],
  ['post-instagram-1080x1350', 1080, 1350, 'Publication Instagram, format portrait 4:5'],
  ['post-carre-1080', 1080, 1080, 'Publication carrée (Instagram, Facebook, X)'],
  ['story-reel-tiktok-1080x1920', 1080, 1920, 'Story, Reel, TikTok, Short (zone sûre : 250 px libres en haut et en bas)'],
  ['miniature-youtube-1280x720', 1280, 720, 'Miniature de vidéo YouTube'],
];
for (const [name, w, h] of FORMATS) {
  shot(name, w, h, page(w, h, `<div class="sky"></div><div class="grain"></div>`), 'reseaux/fonds-vides');
}

shot('photo-de-profil-1080', 1080, 1080, page(1080, 1080,
  `<div class="sky"></div><div class="grain"></div><img class="sigil" src="${sigil}" style="position:absolute;left:115px;top:170px;width:850px">`));
shot('banniere-youtube-2560x1440', 2560, 1440, page(2560, 1440,
  `<div class="sky"></div><div class="grain"></div>
   <div style="position:absolute;left:507px;top:508px;width:1546px;height:423px;display:flex;align-items:center;gap:60px">
     <img class="sigil" src="${sigil}" style="width:440px">
     <div><div class="word" style="font-size:118px">ONIRIQUE</div>
       <div style="font:400 50px/1.3 'Hanken Grotesk';color:${C.haze[0]};margin-top:26px">Plugins audio pour la voix et le mix, <span class="dream" style="font-size:66px;color:${C.mist[0]}">faits pour rêver.</span></div></div>
   </div>`));
shot('banniere-x-1500x500', 1500, 500, page(1500, 500,
  `<div class="sky"></div><div class="grain"></div>
   <img class="sigil" src="${sigil}" style="position:absolute;right:70px;top:40px;width:470px">
   <div style="position:absolute;left:330px;top:150px">
     <div class="word" style="font-size:78px">ONIRIQUE</div>
     <div class="eyebrow" style="font-size:22px;margin-top:26px">${STAR(22)}plugins audio · onirique.store</div></div>`));
shot('post-instagram-1080x1350-exemple', 1080, 1350, page(1080, 1350,
  `<div class="sky"></div><div class="grain"></div>
   <div style="position:absolute;left:80px;top:90px;right:80px">
     <div class="eyebrow" style="font-size:24px">${STAR(24)}Nouveau plugin</div>
     <div style="font:800 104px/1.05 Unbounded;margin-top:36px">METERBOX<br><span class="dream" style="font-size:132px">est sorti.</span></div>
     <div style="font:400 34px/1.45 'Hanken Grotesk';color:${C.haze[0]};margin-top:36px;max-width:820px">Loudness, spectre, balance tonale et phase dans une seule fenêtre.</div></div>
   <img src="${pathToFileURL(path.join(repo, 'tools', 'brand-kit', 'captures', 'meterbox.png')).href}" style="position:absolute;left:80px;top:640px;width:920px;border-radius:22px;border:1px solid rgba(255,210,214,.18);box-shadow:0 40px 90px -20px rgba(0,0,0,.9),0 0 60px -10px rgba(226,52,68,.45)">
   <div style="position:absolute;left:80px;bottom:90px;display:flex;align-items:center;gap:22px">
     <span style="padding:22px 38px;border-radius:999px;background:${C.mist[0]};color:${C.night[0]};font:700 30px 'Hanken Grotesk'">onirique.store</span>
     <span style="font:500 24px 'JetBrains Mono';letter-spacing:.14em;color:${C.bone[0]}">ESSAI 7 JOURS</span></div>
   <img class="sigil" src="${sigil}" style="position:absolute;right:60px;bottom:60px;width:190px;opacity:.95">`));
shot('story-reel-tiktok-1080x1920-exemple', 1080, 1920, page(1080, 1920,
  `<div class="sky"></div><div class="grain"></div>
   <img class="sigil" src="${sigil}" style="position:absolute;left:190px;top:330px;width:700px">
   <div style="position:absolute;left:90px;right:90px;top:1000px;text-align:center">
     <div class="eyebrow" style="font-size:28px;justify-content:center">${STAR(28)}Code promo</div>
     <div style="font:800 120px/1 'JetBrains Mono';letter-spacing:.08em;color:${C.bone[0]};margin-top:40px;padding:50px 0;border:3px dashed ${C.ember[0]};border-radius:40px;background:${C.deep2[0]}">LANCEMENT20</div>
     <div style="font:400 40px/1.4 'Hanken Grotesk';color:${C.haze[0]};margin-top:44px">-20 % sur tous les plugins,<br><span class="dream" style="font-size:58px;color:${C.mist[0]}">jusqu'à dimanche.</span></div>
   </div>`));
shot('miniature-youtube-1280x720-exemple', 1280, 720, page(1280, 720,
  `<div class="sky"></div><div class="grain"></div>
   <img class="sigil" src="${sigil}" style="position:absolute;right:20px;top:100px;width:560px">
   <div style="position:absolute;left:70px;top:150px;width:720px">
     <div class="eyebrow" style="font-size:22px">${STAR(22)}Tuto</div>
     <div style="font:800 86px/1.05 Unbounded;margin-top:26px">MIXER SA VOIX<br><span class="dream" style="font-size:108px">en 5 minutes.</span></div></div>`));

//------------------------------------------------------------------------------ Couleurs
shot('palette', 1800, 1100, page(1800, 1100,
  `<div style="padding:80px;display:grid;grid-template-columns:repeat(3,1fr);gap:28px">
   ${Object.values(C).map(([hex, name, use]) => `<div style="border:1px solid rgba(255,210,214,.16);border-radius:24px;overflow:hidden;background:${C.deep[0]}">
     <div style="height:150px;background:${hex}"></div>
     <div style="padding:22px 24px"><div style="font:800 26px Unbounded">${name}</div>
     <div style="font:500 20px 'JetBrains Mono';color:${C.bone[0]};margin-top:10px">${hex} · RGB ${rgb(hex)}</div>
     <div style="font:400 18px/1.4 'Hanken Grotesk';color:${C.haze[0]};margin-top:10px">${use}</div></div></div>`).join('')}</div>`), 'couleurs');

//------------------------------------------------------------------------------ Motifs
shot('etoile-quatre-branches-1024', 1024, 1024, page(1024, 1024,
  `<div style="position:absolute;inset:0;display:grid;place-items:center">${STAR(640)}</div>`, 'html, body { background: transparent !important; }'), 'motifs');
shot('degrade-sang-nuit-1920x1080', 1920, 1080, page(1920, 1080, `<div class="sky"></div><div class="grain"></div>`), 'motifs');

//------------------------------------------------------------------------------ Le guide (PDF)
const guide = `<!doctype html><html lang="fr"><meta charset="utf-8"><style>
${fontFaces}
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; margin: 0; }
body { background: ${C.night[0]}; color: ${C.mist[0]}; font: 400 15px/1.6 "Hanken Grotesk", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
section { position: relative; width: 297mm; height: 210mm; padding: 22mm 24mm; overflow: hidden; page-break-after: always;
  background: radial-gradient(120% 60% at 50% -10%, rgba(140,6,20,.75), rgba(92,0,8,.4) 38%, transparent 72%), ${C.night[0]}; }
h1 { font: 800 54px/1.05 Unbounded; letter-spacing: .02em; }
h2 { font: 800 30px/1.1 Unbounded; margin-bottom: 8mm; }
h3 { font: 800 15px/1.3 Unbounded; letter-spacing: .04em; margin: 0 0 6px; }
.dream { font: 600 1.25em/1 "Grenze Gotisch"; text-shadow: 0 0 .1em rgba(255,255,255,.55), 0 0 .4em rgba(255,190,196,.45), 0 0 .9em rgba(226,52,68,.6); }
.eyebrow { font: 500 11px/1 "JetBrains Mono"; letter-spacing: .2em; text-transform: uppercase; color: ${C.haze[0]}; display: flex; align-items: center; gap: 10px; margin-bottom: 7mm; }
.muted { color: ${C.haze[0]}; }
.grid { display: grid; gap: 7mm; }
.card { border: 1px solid rgba(255,210,214,.16); border-radius: 14px; background: linear-gradient(180deg, ${C.deep2[0]}, ${C.deep[0]}); padding: 6mm; }
.chip { display: inline-block; padding: 7px 14px; border-radius: 999px; border: 1px solid rgba(255,210,214,.16); font: 500 11px "JetBrains Mono"; letter-spacing: .1em; }
.no { border-color: rgba(255,122,133,.5); }
.foot { position: absolute; left: 24mm; right: 24mm; bottom: 12mm; display: flex; justify-content: space-between; font: 500 10px "JetBrains Mono"; letter-spacing: .16em; color: ${C.haze[0]}; text-transform: uppercase; }
</style><body>

<section style="display:flex;align-items:center;gap:20mm">
  <img src="${sigil}" style="width:110mm;filter:drop-shadow(0 0 30px rgba(226,52,68,.7))">
  <div><div class="eyebrow">${STAR(14)}Charte graphique</div>
    <h1>ONIRIQUE</h1>
    <p style="font-size:22px;margin-top:6mm" class="muted">Plugins audio, <span class="dream" style="color:${C.mist[0]}">faits pour rêver.</span></p>
    <p class="muted" style="margin-top:12mm;max-width:120mm">Ce document et les fichiers qui l'accompagnent servent à garder les mêmes couleurs, polices et signes sur les réseaux que sur le site onirique.store et dans ONIRIQUE CENTRAL.</p></div>
  <div class="foot"><span>onirique.store</span><span>Réservé à l'équipe</span></div>
</section>

<section>
  <div class="eyebrow">${STAR(14)}01 · Le logo</div><h2>Le sceau, <span class="dream">la signature.</span></h2>
  <div class="grid" style="grid-template-columns:1.1fr 1fr">
    <div class="card" style="display:grid;place-items:center;background:${C.night[0]}"><img src="${sigil}" style="width:105mm;filter:drop-shadow(0 0 24px rgba(226,52,68,.7))"></div>
    <div class="grid" style="align-content:start;gap:5mm">
      <div class="card"><h3>Toujours sur la nuit</h3><p class="muted">Le logo est blanc, avec son halo rouge. Il se pose sur un fond sombre : la nuit, ou le dégradé sang vers nuit. Jamais sur un fond clair.</p></div>
      <div class="card"><h3>De l'air autour</h3><p class="muted">Laisser autour du logo au moins la moitié de sa hauteur libre. Taille minimale : 120 px de large à l'écran.</p></div>
      <div class="card no"><h3>À ne pas faire</h3><p class="muted">Le déformer, le recolorer, l'entourer d'un cadre, lui retirer son halo, le poser sur une photo chargée ou un fond clair.</p></div>
      <div class="card"><h3>Le nom</h3><p class="muted">ONIRIQUE s'écrit en capitales, en Unbounded très gras, avec des lettres espacées. Les partenaires : « ONIRIQUE × ABRASION », « RELIC ».</p></div>
    </div>
  </div>
  <div class="foot"><span>logos/</span><span>2</span></div>
</section>

<section>
  <div class="eyebrow">${STAR(14)}02 · Les couleurs</div><h2>Nuit, sang <span class="dream">et braise.</span></h2>
  <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:4mm">
  ${Object.values(C).map(([hex, name, use]) => `<div class="card" style="padding:0;overflow:hidden"><div style="height:16mm;background:${hex}"></div>
    <div style="padding:3.5mm 5mm"><h3>${name} <span style="font:500 11px 'JetBrains Mono';color:${C.bone[0]}">${hex}</span></h3><p class="muted" style="font-size:12px;line-height:1.4">${use}</p></div></div>`).join('')}
  </div>
  <p class="muted" style="margin-top:6mm">La proportion : beaucoup de nuit, un halo de sang, la braise en petites touches. La brume pour le texte.</p>
  <div class="foot"><span>couleurs/</span><span>3</span></div>
</section>

<section>
  <div class="eyebrow">${STAR(14)}03 · Les polices</div><h2>Quatre voix, <span class="dream">un seul ton.</span></h2>
  <div class="grid" style="grid-template-columns:1fr 1fr">
  ${FONTS.map(([name, use, , url, weight]) => `<div class="card"><div class="eyebrow" style="margin-bottom:4mm">${name}</div>
    <div style="font:${weight} ${name === 'Grenze Gotisch' ? 40 : name === 'JetBrains Mono' ? 20 : 30}px/1.15 '${name}';${name === 'Grenze Gotisch' ? 'text-shadow:0 0 .1em rgba(255,255,255,.55),0 0 .4em rgba(255,190,196,.45),0 0 .9em rgba(226,52,68,.6)' : ''}">${name === 'JetBrains Mono' ? 'PLUGINS AUDIO · 7 JOURS' : name === 'Grenze Gotisch' ? 'faits pour rêver' : name === 'Unbounded' ? 'ONIRIQUE TUNER' : 'Toute une chaîne vocale dans un seul plugin.'}</div>
    <p class="muted" style="margin-top:4mm;font-size:12.5px">${use}. Gratuite (licence SIL OFL) : ${url.replace('https://', '')}</p></div>`).join('')}
  </div>
  <p class="muted" style="margin-top:6mm">Un titre type : Unbounded en capitales, puis un ou deux mots en Grenze Gotisch avec le halo. Au-dessus, une petite étiquette en JetBrains Mono précédée de l'étoile.</p>
  <div class="foot"><span>polices/</span><span>4</span></div>
</section>

<section>
  <div class="eyebrow">${STAR(14)}04 · Les signes</div><h2>L'étoile, le halo, <span class="dream">le grain.</span></h2>
  <div class="grid" style="grid-template-columns:repeat(3,1fr)">
    <div class="card"><div style="height:34mm;display:grid;place-items:center">${STAR(90)}</div><h3>L'étoile à quatre branches</h3><p class="muted">Devant les petites étiquettes, comme repère dans un visuel. Brume avec halo braise.</p></div>
    <div class="card"><div style="height:34mm;display:grid;place-items:center"><span class="dream" style="font-size:52px">rêver</span></div><h3>Le halo</h3><p class="muted">Blanc au cœur, rose puis braise autour. Seulement sur les mots en Grenze Gotisch et sur le logo.</p></div>
    <div class="card"><div style="height:34mm;border-radius:10px;background:radial-gradient(120% 80% at 50% -10%, rgba(140,6,20,.95), rgba(92,0,8,.5) 40%, ${C.night[0]} 78%)"></div><h3>Le dégradé sang vers nuit</h3><p class="muted">Le fond de tous les visuels : rouge en haut, nuit en bas, avec un grain très léger.</p></div>
  </div>
  <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:7mm">
    <div class="card"><h3>Boutons</h3><p><span class="chip" style="background:${C.mist[0]};color:${C.night[0]};border-color:transparent;font-family:'Hanken Grotesk';font-weight:700;letter-spacing:0">onirique.store</span> &nbsp; <span class="chip" style="background:${C.ember[0]};border-color:${C.ember[0]};color:#fff">ACTIF</span> &nbsp; <span class="chip">ÉTIQUETTE</span></p><p class="muted" style="margin-top:3mm">Des pastilles arrondies. Le bouton principal est brume sur nuit.</p></div>
    <div class="card"><h3>Codes promo</h3><p style="font:800 22px 'JetBrains Mono';letter-spacing:.1em;color:${C.bone[0]};border:2px dashed ${C.ember[0]};border-radius:12px;padding:3mm 5mm;display:inline-block;background:${C.deep2[0]}">LANCEMENT20</p><p class="muted" style="margin-top:3mm">En JetBrains Mono, dans un cadre pointillé braise.</p></div>
  </div>
  <div class="foot"><span>motifs/</span><span>5</span></div>
</section>

<section>
  <div class="eyebrow">${STAR(14)}05 · Réseaux sociaux</div><h2>Les formats <span class="dream">prêts à l'emploi.</span></h2>
  <div class="grid" style="grid-template-columns:1fr 1fr;gap:5mm">
    <div class="card"><h3>Dans le dossier reseaux/</h3><p class="muted">Un exemple garni pour chaque format, et dans reseaux/fonds-vides/ le même fond sans texte, à importer dans Canva, Photoshop ou CapCut pour y écrire.</p>
      <ul class="muted" style="margin:3mm 0 0 5mm;font-size:12.5px;line-height:1.7">${FORMATS.map(([, w, h, label]) => `<li>${label} : ${w} × ${h}</li>`).join('')}</ul></div>
    <div class="grid" style="gap:5mm;align-content:start">
      <div class="card"><h3>Le ton</h3><p class="muted">Direct, chaleureux, sans jargon inutile. Le « tu » sur les réseaux et la boutique. Des phrases courtes ; un mot qui fait rêver par titre, pas plus.</p></div>
      <div class="card"><h3>Toujours</h3><p class="muted">Le lien onirique.store, l'essai gratuit de 7 jours quand il s'agit d'un plugin, et une vraie capture de l'interface du plugin plutôt qu'une maquette.</p></div>
      <div class="card"><h3>Les plugins partenaires</h3><p class="muted">ONIRIQUE × ABRASION (RAW, TAMA-VOX, MIMIC) et RELIC (BLOOM) gardent leur propre interface ; le visuel autour reste à la charte ONIRIQUE.</p></div>
    </div>
  </div>
  <div class="foot"><span>reseaux/</span><span>6</span></div>
</section>
</body></html>`;
fs.writeFileSync(path.join(work, 'guide.html'), guide);

//------------------------------------------------------------------------------ Rendu, fichiers, zip
const chrome = (args) => execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1', '--default-background-color=00000000', '--virtual-time-budget=4000', ...args], { stdio: 'ignore' });
for (const s of shots) {
  chrome([`--window-size=${s.width},${s.height}`, `--screenshot=${s.out}`, pathToFileURL(s.file).href]);
  if (!fs.existsSync(s.out)) throw new Error(`image non produite : ${s.out}`);
}
chrome(['--no-pdf-header-footer', `--print-to-pdf=${path.join(kit, 'ONIRIQUE-charte-graphique.pdf')}`, pathToFileURL(path.join(work, 'guide.html')).href]);

for (const [from, to] of [['logo.png', 'logo-etoile-transparent.png'], ['logo-original.png', 'logo-fond-degrade-1254.png'], ['logo-small.png', 'logo-petit-transparent.png'], ['favicon.png', 'icone-favicon.png']]) {
  fs.copyFileSync(path.join(site, 'assets', from), path.join(kit, 'logos', to));
}
for (const file of fs.readdirSync(path.join(site, 'assets', 'fonts'))) fs.copyFileSync(path.join(site, 'assets', 'fonts', file), path.join(kit, 'polices', file));
fs.writeFileSync(path.join(kit, 'polices', 'LISEZ-MOI.txt'),
  'Les polices du site (fichiers .woff2, pour le web).\r\n\r\nPour les installer sur un ordinateur ou dans Canva, télécharger les versions .ttf, gratuites (licence SIL Open Font License) :\r\n\r\n'
  + FONTS.map(([name, use, , url]) => `  ${name} : ${url}\r\n    ${use}`).join('\r\n') + '\r\n');
fs.writeFileSync(path.join(kit, 'couleurs', 'couleurs.txt'),
  Object.values(C).map(([hex, name, use]) => `${name.padEnd(14)} ${hex}   RGB ${rgb(hex).padEnd(13)}  ${use}`).join('\r\n') + '\r\n');
fs.writeFileSync(path.join(kit, 'couleurs', 'couleurs.css'),
  `:root {\n${Object.entries(C).map(([key, [hex, name]]) => `  --${key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}: ${hex}; /* ${name} */`).join('\n')}\n}\n`);
fs.writeFileSync(path.join(kit, 'LISEZ-MOI.txt'),
  'CHARTE GRAPHIQUE ONIRIQUE\r\n\r\n'
  + '  ONIRIQUE-charte-graphique.pdf   le guide : logo, couleurs, polices, signes, ton, formats\r\n'
  + '  logos/                          le logo (transparent, sur fond, avec le nom) et le nom seul\r\n'
  + '  couleurs/                       la palette en image, en texte et en CSS\r\n'
  + '  polices/                        les polices du site, et où trouver les versions à installer\r\n'
  + '  motifs/                         l\'étoile à quatre branches et le fond dégradé\r\n'
  + '  reseaux/                        un exemple pour chaque format de réseau social\r\n'
  + '  reseaux/fonds-vides/            les mêmes fonds sans texte, à garnir dans Canva ou Photoshop\r\n\r\n'
  + 'Réservé à l\'équipe ONIRIQUE.\r\n');
fs.rmSync(work, { recursive: true, force: true });

const zip = path.join(outRoot, 'ONIRIQUE-charte-graphique.zip');
execFileSync('python', ['-c', `import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[2], 'ONIRIQUE-charte-graphique')`, zip.replace(/\.zip$/, ''), outRoot]);
console.log(`${zip} : ${Math.round(fs.statSync(zip).size / 1024)} Ko`);
