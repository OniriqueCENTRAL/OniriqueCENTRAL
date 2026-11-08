// Commun aux pages du navigateur (accueil, paramètres, historique) : la couleur d'accent choisie et la liaison avec
// le navigateur. La dernière couleur connue est posée avant le premier dessin, puis le navigateur envoie la sienne.
(() => {
  const poser = (c) => {
    const r = document.documentElement.style;
    r.setProperty("--acc", c.acc);
    r.setProperty("--acc-hi", c.hi);
    r.setProperty("--acc-lo", c.lo);
  };
  try { const c = JSON.parse(localStorage.getItem("onirique.couleurs")); if (c) poser(c); } catch { /* la braise d'origine */ }
  const abonnes = [];
  window.onirique = {
    envoyer: (m) => window.chrome?.webview?.postMessage(m),
    surMessage: (f) => abonnes.push(f),
  };
  window.chrome?.webview?.addEventListener("message", (e) => {
    const m = e.data;
    if (m?.type === "etat" && m.couleurs) {
      poser(m.couleurs);
      try { localStorage.setItem("onirique.couleurs", JSON.stringify(m.couleurs)); } catch { /* rien à garder */ }
    }
    abonnes.forEach((f) => f(m));
  });
})();
