// La couleur du site choisie par le compte (Paramètres du compte) : les variables --acc, --acc-hi et --acc-lo de da.css,
// comme la couleur d'accent de l'application CENTRAL. Chargé dans l'en-tête de chaque page : la dernière couleur connue
// (gardée sur cet appareil) est posée avant le premier dessin, puis account.js la relit sur le compte (/api/me).
//
//   OniriqueAccent.set(hex)       →  pose cette couleur (« #rrggbb » ; vide : la braise d'origine) et la garde ici
//   OniriqueAccent.palette(hex)   →  { acc, hi, lo } : les trois teintes « r, g, b »
//   OniriqueAccent.CHOICES        →  les couleurs proposées, celles de l'application
(() => {
  const KEY = "onirique.accent", DEFAULT = "#e5384a";
  const CHOICES = [["#e5384a", "Braise"], ["#ff6a3d", "Corail"], ["#e8b33a", "Or"], ["#22c28a", "Émeraude"], ["#2bb8d6", "Lagon"],
    ["#3d7bff", "Océan"], ["#8b5cf6", "Améthyste"], ["#e64aa8", "Fuchsia"], ["#a3a3a3", "Acier"]];

  // Même calcul que l'application (app/renderer/ui.js, accentPalette) : la teinte choisie, gardée lisible sur la nuit.
  function palette(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(String(hex))) hex = DEFAULT;
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    let hue = 0, sat = 0;
    if (d) {
      sat = d / (1 - Math.abs(2 * l - 1));
      hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hue = (hue * 60 + 360) % 360;
    }
    const rgb = (H, S, L) => {
      const c = (1 - Math.abs(2 * L - 1)) * S, x = c * (1 - Math.abs(((H / 60) % 2) - 1)), m = L - c / 2;
      const [a, bb, cc] = H < 60 ? [c, x, 0] : H < 120 ? [x, c, 0] : H < 180 ? [0, c, x] : H < 240 ? [0, x, c] : H < 300 ? [x, 0, c] : [c, 0, x];
      return [a, bb, cc].map((v) => Math.round((v + m) * 255)).join(", ");
    };
    const S = sat < 0.08 ? 0 : Math.max(0.55, Math.min(0.9, sat));
    return { acc: rgb(hue, S, Math.max(0.5, Math.min(0.62, l))), hi: rgb(hue, S ? Math.min(1, S + 0.1) : 0, 0.76), lo: rgb(hue, S, 0.26) };
  }

  function apply(hex) {
    const root = document.documentElement.style;
    if (!/^#[0-9a-f]{6}$/i.test(String(hex)) || hex.toLowerCase() === DEFAULT) {
      for (const v of ["--acc", "--acc-hi", "--acc-lo"]) root.removeProperty(v); // la braise de da.css
      return;
    }
    const p = palette(hex);
    root.setProperty("--acc", p.acc); root.setProperty("--acc-hi", p.hi); root.setProperty("--acc-lo", p.lo);
  }

  function set(hex) {
    hex = /^#[0-9a-f]{6}$/i.test(String(hex)) ? hex.toLowerCase() : "";
    apply(hex);
    try { if (hex) localStorage.setItem(KEY, hex); else localStorage.removeItem(KEY); } catch { /* stockage fermé : la couleur vaut pour cette page */ }
  }

  try { apply(localStorage.getItem(KEY) || ""); } catch { /* stockage fermé : la braise */ }
  window.OniriqueAccent = { set, palette, CHOICES, DEFAULT };
})();
