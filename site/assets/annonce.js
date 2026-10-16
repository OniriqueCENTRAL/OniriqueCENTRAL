// Le bandeau d'annonce du site (réglé en direct dans le panel admin), au-dessus de l'en-tête, qu'on peut fermer.
// Chargé dans <head> : le dernier bandeau connu est posé dès que la page commence, avant son premier affichage.
// Posé après coup, il faisait descendre toute la page sous les yeux du visiteur.
// site-nav.js transmet ensuite la réponse du serveur, qui confirme, change ou retire le bandeau :
//   OniriqueAnnounce(annonce ou null)
// Un nouveau texte a un nouveau numéro : il réapparaît chez ceux qui avaient fermé le précédent.
(() => {
  const KEY = "onirique.announce", CLOSED = "onirique.announce.closed";
  const style = document.createElement("style");
  style.textContent = `
.sn-announce { position: relative; z-index: 60; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 10px 48px; font: 600 14px/1.4 var(--f-body, system-ui); text-align: center; }
.sn-announce p { margin: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px 16px; }
.sn-announce span { letter-spacing: .02em; }
.sn-announce a { color: inherit; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
.sn-announce-x { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); width: 32px; height: 32px; border: 0; border-radius: 999px; background: rgba(0,0,0,.18); color: inherit; font: 400 20px/1 var(--f-body, system-ui); cursor: pointer; }
.sn-announce.tone-ember { background: linear-gradient(90deg, #8c0614, #e23444 60%, #8c0614); color: #fff; }
.sn-announce.tone-gold { background: linear-gradient(90deg, #b8862b, #f2c46d 55%, #b8862b); color: #1a0d02; }
.sn-announce.tone-calm { background: var(--deep-2, #2a0a0e); color: var(--mist, #f6eeee); border-bottom: 1px solid var(--line, rgba(255,210,214,.16)); }`;
  document.head.append(style);

  const closed = (a) => { try { return localStorage.getItem(CLOSED) === a.id; } catch { return false; } };
  const make = (tag, props) => Object.assign(document.createElement(tag), props);

  function build(a) {
    const bar = make("div", { className: "sn-announce tone-" + (a.tone || "ember") });
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Annonce");
    const body = make("p", {});
    body.append(make("span", { textContent: a.text }));
    if (a.link) body.append(make("a", { href: a.link, textContent: (a.linkLabel || "Voir") + " →" }));
    const close = make("button", { type: "button", className: "sn-announce-x", textContent: "×", title: "Fermer l'annonce" });
    close.setAttribute("aria-label", "Fermer l'annonce");
    close.onclick = () => { try { localStorage.setItem(CLOSED, a.id); } catch { /* stockage fermé */ } bar.remove(); };
    bar.append(body, close);
    return bar;
  }

  function place(a) {
    document.querySelector(".sn-announce")?.remove();
    if (!a || !a.text || (a.endsAt && a.endsAt < Date.now()) || closed(a)) return;
    const bar = build(a);
    if (document.body) { document.body.prepend(bar); return; }
    // <body> n'existe pas encore : posé dès qu'il apparaît, avant le premier affichage.
    new MutationObserver((_, observer) => {
      if (!document.body) return;
      observer.disconnect();
      document.body.prepend(bar);
    }).observe(document.documentElement, { childList: true });
  }

  let known = null;
  try { known = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { /* stockage fermé : rien de connu */ }
  place(known);

  window.OniriqueAnnounce = (a) => {
    a = a || null;
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* stockage fermé */ }
    if (JSON.stringify(a) !== JSON.stringify(known)) { known = a; place(a); }
  };
})();
