// Google aux couleurs ONIRIQUE : injecté par le navigateur dans chaque page, n'agit que sur les recherches Google.
// Google change souvent ses noms de classes : on ne s'appuie pas dessus, on recolore d'après les couleurs affichées
// (gris sombres → nuit et profondeur, bleus → l'accent, liens visités → étiquette, dégradés et bordures compris),
// seulement en thème sombre. Google pose ses couleurs au fil du chargement : la page est relue à chaque changement,
// au plus deux fois par seconde. L'accent (window.__ONIRIQUE_ACCENT) est celui choisi dans les Paramètres.
(() => {
  if (!/(^|\.)google\.[a-z.]+$/.test(location.hostname)) return;
  if (!/^\/(search|webhp)?$/.test(location.pathname)) return;
  // Seulement quand Google s'affiche en sombre (il suit le thème du navigateur) : sur fond clair, l'accent ne se lirait pas.
  if (!matchMedia("(prefers-color-scheme: dark)").matches) return;
  const ACC = window.__ONIRIQUE_ACCENT || { acc: "229, 56, 74", hi: "255, 142, 154", lo: "122, 13, 28" };
  const NUIT = "9, 8, 10", PROFONDEUR = "22, 18, 20", FILET = "rgba(255, 210, 214, .13)";

  const fond = document.createElement("style");
  fond.textContent = `html,body{background:rgb(${NUIT})!important}::selection{background:rgba(${ACC.acc},.55)!important;color:#fff!important}`;
  // Le script part avant que la page existe : le style se pose dès que la racine du document apparaît.
  const poser = () => { const racine = document.head || document.documentElement; if (racine && !fond.isConnected) racine.appendChild(fond); };
  poser();
  if (!fond.isConnected) new MutationObserver((_, o) => { poser(); if (fond.isConnected) o.disconnect(); }).observe(document, { childList: true, subtree: true });

  const rgb = (s) => (String(s).match(/[\d.]+/g) || []).map(Number);
  const ecart = (v) => Math.max(v[0], v[1], v[2]) - Math.min(v[0], v[1], v[2]);
  const gris = (v) => v.length >= 3 && (v[3] ?? 1) > 0.05 && ecart(v) < 16;
  const bleu = (v) => v.length >= 3 && (v[3] ?? 1) > 0.15 && v[2] > v[0] + 40 && v[2] > 120;
  const clair = (v) => v[0] * 0.3 + v[1] * 0.59 + v[2] * 0.11 > 150;
  const fixer = (el, prop, valeur) => { if (el.style.getPropertyValue(prop) !== valeur) el.style.setProperty(prop, valeur, "important"); };
  // Les gris de Google (surface #1f1f1f, cartes #282a2c, #303134) deviennent la nuit et la profondeur.
  const surface = (v) => (v[0] < 52 ? NUIT : PROFONDEUR);

  function teinter(el) {
    const cs = getComputedStyle(el);
    const bg = rgb(cs.backgroundColor);
    if (bg.length >= 3 && (bg[3] ?? 1) > 0.05) {
      if (gris(bg) && bg[0] < 90) fixer(el, "background-color", `rgba(${surface(bg)}, ${bg[3] ?? 1})`);
      else if (bleu(bg)) {
        if ((bg[3] ?? 1) < 0.6) fixer(el, "background-color", `rgba(${ACC.acc}, .28)`);
        else { fixer(el, "background-color", clair(bg) ? `rgb(${ACC.acc})` : `rgb(${ACC.lo})`); fixer(el, "color", "#fff"); return; }
      }
    }
    // Les dégradés (fondus en bas des encadrés, reflets) : mêmes correspondances, la transparence est gardée.
    const image = cs.backgroundImage;
    if (image && image.includes("gradient")) {
      const neuf = image.replace(/rgba?\([^)]*\)/g, (c) => {
        const v = rgb(c);
        if (gris(v) && v[0] < 90) return `rgba(${surface(v)}, ${v[3] ?? 1})`;
        if (bleu(v)) return `rgba(${ACC.acc}, ${v[3] ?? 1})`;
        return c;
      });
      if (neuf !== image) fixer(el, "background-image", neuf);
    }
    // Les contours gris ou lavande : le filet de la charte.
    for (const cote of ["top", "right", "bottom", "left"]) {
      const b = rgb(cs.getPropertyValue(`border-${cote}-color`));
      if (parseFloat(cs.getPropertyValue(`border-${cote}-width`)) > 0 && b.length >= 3 && b[0] > 40 && b[0] < 190 && ecart(b) < 60) fixer(el, `border-${cote}-color`, FILET);
    }
    const ombre = cs.boxShadow;
    if (ombre && ombre !== "none" && /rgba?\(/.test(ombre)) {
      const neuve = ombre.replace(/rgba?\([^)]*\)/g, (c) => { const v = rgb(c); return v.length >= 3 && ecart(v) < 60 && v[0] > 40 ? FILET : c; });
      if (neuve !== ombre) fixer(el, "box-shadow", neuve);
    }
    const c = rgb(cs.color);
    if (c.length >= 3) {
      if (bleu(c)) fixer(el, "color", `rgb(${ACC.hi})`);
      else if (c[0] > 150 && c[2] > 200 && c[1] < 170) fixer(el, "color", "#D9C6C9");
    }
  }

  let prevu = false, dernier = 0;
  function relire() {
    prevu = false;
    dernier = performance.now();
    document.body.querySelectorAll("*").forEach(teinter);
  }
  function plusTard() {
    if (prevu) return;
    prevu = true;
    setTimeout(() => requestAnimationFrame(relire), Math.max(0, 500 - (performance.now() - dernier)));
  }

  document.addEventListener("DOMContentLoaded", () => {
    poser();
    relire();
    new MutationObserver(plusTard).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  });
})();
