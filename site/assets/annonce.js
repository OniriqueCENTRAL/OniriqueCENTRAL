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
.sn-announce.tone-ember { background: linear-gradient(90deg, rgb(var(--acc-lo, 122,13,28)), rgb(var(--acc, 229,56,74)) 60%, rgb(var(--acc-lo, 122,13,28))); color: #fff; }
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

// La fenêtre « nouveauté » (réglée dans le panel admin) : une fois par visiteur et par nouveauté, à l'ouverture du site.
//   OniriquePopup(nouveauté ou null)  — appelée par /api/announce.js puis par site-nav.js (/api/site)
(() => {
  const SEEN = "onirique.popup.seen";
  let done = false;
  const seen = (id) => { try { return localStorage.getItem(SEEN) === id; } catch { return true; } };
  const make = (tag, props, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter(Boolean)); return n; };
  const style = document.createElement("style");
  style.textContent = `
.np-back { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 20px; background: rgba(5,3,4,.62); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); opacity: 0; transition: opacity .35s ease; }
.np-back.in { opacity: 1; }
.np-card { position: relative; width: min(460px, 100%); max-height: calc(100vh - 40px); overflow: auto; border-radius: 24px; border: 1px solid rgba(255,210,214,.16); background: linear-gradient(160deg, rgba(255,255,255,.07), rgba(255,255,255,.02)), #120a0c; box-shadow: 0 30px 80px rgba(0,0,0,.6), 0 0 60px rgba(var(--acc, 229,56,74),.18); color: var(--mist, #f6eeee); text-align: center; transform: translateY(14px) scale(.98); transition: transform .45s cubic-bezier(.2,.8,.2,1); }
.np-back.in .np-card { transform: none; }
.np-img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-bottom: 1px solid rgba(255,210,214,.12); }
.np-body { padding: 26px 28px 28px; display: grid; gap: 12px; justify-items: center; }
.np-kicker { padding: 7px 14px; border-radius: 999px; background: linear-gradient(180deg, rgba(var(--acc, 229,56,74),.6), rgba(var(--acc-lo, 122,13,28),.6)); border: 1px solid rgba(255,140,150,.5); font: 600 11px/1 var(--f-mono, monospace); letter-spacing: .16em; text-transform: uppercase; color: #fff; }
.np-title { margin: 4px 0 0; font: 800 clamp(24px, 6vw, 32px)/1.1 var(--f-display, system-ui); letter-spacing: .02em; }
.np-text { margin: 0; color: var(--haze, #a88f92); font: 500 15px/1.55 var(--f-body, system-ui); }
.np-cta { margin-top: 8px; display: inline-flex; align-items: center; gap: 8px; padding: 13px 24px; border-radius: 999px; background: linear-gradient(180deg, rgb(var(--acc, 229,56,74)), rgb(var(--acc-lo, 122,13,28))); color: #fff; font: 700 14px/1 var(--f-body, system-ui); letter-spacing: .04em; text-decoration: none; box-shadow: 0 10px 30px rgba(var(--acc, 229,56,74),.35); }
.np-later { border: 0; background: none; color: var(--haze, #a88f92); font: 500 13px/1 var(--f-body, system-ui); cursor: pointer; padding: 6px; }
.np-x { position: absolute; top: 12px; right: 12px; width: 36px; height: 36px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.45); color: #fff; font: 400 22px/1 system-ui; cursor: pointer; }
@media (prefers-reduced-motion: reduce) { .np-back, .np-card { transition: none; } }`;
  document.head.append(style);

  function show(p) {
    if (done || !p || !p.id || seen(p.id) || location.pathname.startsWith("/admin")) return;
    done = true;
    try { localStorage.setItem(SEEN, p.id); } catch { /* stockage fermé */ }
    const back = make("div", { className: "np-back" });
    back.setAttribute("role", "dialog");
    back.setAttribute("aria-modal", "true");
    back.setAttribute("aria-label", p.kicker || p.title);
    const close = () => { back.classList.remove("in"); setTimeout(() => back.remove(), 350); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const x = make("button", { type: "button", className: "np-x", textContent: "×", title: "Fermer" });
    x.setAttribute("aria-label", "Fermer");
    x.onclick = close;
    const card = make("div", { className: "np-card" },
      x,
      p.image ? make("img", { className: "np-img", src: p.image, alt: p.title, loading: "eager" }) : null,
      make("div", { className: "np-body" },
        p.kicker ? make("span", { className: "np-kicker", textContent: p.kicker }) : null,
        make("h2", { className: "np-title", textContent: p.title }),
        p.text ? make("p", { className: "np-text", textContent: p.text }) : null,
        p.link ? make("a", { className: "np-cta", href: p.link, textContent: (p.linkLabel || "Voir") + " →" }) : null,
        make("button", { type: "button", className: "np-later", textContent: "Plus tard", onclick: close })));
    back.append(card);
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    document.addEventListener("keydown", onKey);
    const open = () => { document.body.append(back); requestAnimationFrame(() => requestAnimationFrame(() => back.classList.add("in"))); };
    // un court instant après l'ouverture de la page, pas en même temps que son premier affichage
    const later = () => setTimeout(open, 700);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", later, { once: true }); else later();
  }
  window.OniriquePopup = (p) => show(p || null);
})();
