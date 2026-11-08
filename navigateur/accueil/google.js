// Google aux couleurs ONIRIQUE : injecté par le navigateur dans chaque page, n'agit que sur les recherches Google.
// Google change souvent ses noms de classes : on ne s'appuie pas dessus, on recolore d'après les couleurs affichées
// (gris sombres → nuit et profondeur, liens bleus → rose, liens visités → étiquette), seulement en thème sombre.
(() => {
  if (!/(^|\.)google\.[a-z.]+$/.test(location.hostname)) return;
  if (!/^\/(search|webhp)?$/.test(location.pathname)) return;

  const fond = document.createElement("style");
  fond.textContent = "html,body{background:#09080A!important}";
  const poser = () => (document.head || document.documentElement).appendChild(fond);
  poser();

  const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const gris = ([r, g, b, a = 1]) => a > 0.5 && Math.max(r, g, b) - Math.min(r, g, b) < 14;
  const vus = new WeakSet();

  function teinter(el) {
    if (vus.has(el)) return;
    vus.add(el);
    const cs = getComputedStyle(el);
    const bg = rgb(cs.backgroundColor);
    if (bg.length >= 3 && gris(bg) && bg[0] < 90) {
      el.style.setProperty("background-color", bg[0] < 40 ? "#09080A" : bg[0] < 58 ? "#121012" : "#1d1618", "important");
    }
    const bord = rgb(cs.borderTopColor);
    if (parseFloat(cs.borderTopWidth) > 0 && bord.length >= 3 && gris(bord) && bord[0] > 50 && bord[0] < 110) {
      el.style.setProperty("border-color", "rgba(255,210,214,.14)", "important");
    }
    const [r, g, b] = rgb(cs.color);
    if (b > r + 45 && b > 170) el.style.setProperty("color", "#FF8E9A", "important");
    else if (r > 150 && b > 200 && g < 170) el.style.setProperty("color", "#D9C6C9", "important");
  }
  const tout = (racine) => { teinter(racine); racine.querySelectorAll("*").forEach(teinter); };

  document.addEventListener("DOMContentLoaded", () => {
    poser();
    // Seulement si Google s'affiche en sombre (texte clair) : sur fond clair, le rose ne se lirait pas.
    const html = rgb(getComputedStyle(document.documentElement).color);
    if (html.length >= 3 && html[0] < 128) { fond.remove(); return; }
    tout(document.body);
    let attente = null;
    const nouveaux = new Set();
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) nouveaux.add(n);
      attente ??= requestAnimationFrame(() => { attente = null; nouveaux.forEach(tout); nouveaux.clear(); });
    }).observe(document.body, { childList: true, subtree: true });
  });
})();
