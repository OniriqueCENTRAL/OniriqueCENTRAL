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
.np-back { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 20px; background: rgba(5,3,4,.62); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); opacity: 0; transition: opacity .35s ease; }
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

  // Les soldes (server/src/soldes.js) : une carte à part, animée. Des braises montent du fond, le pourcentage compte
  // jusqu'à sa valeur et brille, un compte à rebours tourne jusqu'à la fin de l'offre, et les meilleures affaires
  // s'affichent avec leur prix barré. Sans animation pour qui les a coupées dans son système.
  const saleStyle = document.createElement("style");
  saleStyle.textContent = `
.bf-card { position: relative; width: min(480px, 100%); max-height: calc(100vh - 40px); overflow: auto; border-radius: 26px; border: 1px solid rgba(255,140,150,.35); background: radial-gradient(120% 70% at 50% 0%, rgba(var(--acc, 229,56,74),.32), transparent 60%), linear-gradient(180deg, #160809, #070405 70%); box-shadow: 0 30px 90px rgba(0,0,0,.7), 0 0 80px rgba(var(--acc, 229,56,74),.3); color: var(--mist, #f6eeee); text-align: center; transform: translateY(18px) scale(.96); transition: transform .55s cubic-bezier(.2,.9,.2,1.15); isolation: isolate; }
.np-back.in .bf-card { transform: none; }
.bf-embers { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: -1; border-radius: inherit; }
.bf-embers i { position: absolute; bottom: -10px; width: var(--s); height: var(--s); border-radius: 50%; background: radial-gradient(circle, #ffd2a0, rgb(var(--acc, 229,56,74)) 60%, transparent 70%); box-shadow: 0 0 10px rgba(255,120,90,.9); opacity: 0; animation: bf-rise var(--d) linear var(--w) infinite; }
@keyframes bf-rise { 0% { transform: translate(0, 0); opacity: 0; } 12% { opacity: .95; } 100% { transform: translate(var(--x), -560px); opacity: 0; } }
.bf-body { padding: 30px 26px 26px; display: grid; gap: 14px; justify-items: center; }
.bf-kicker { display: inline-flex; align-items: center; gap: 9px; padding: 8px 16px; border-radius: 999px; background: #000; border: 1px solid rgba(255,140,150,.55); font: 700 12px/1 var(--f-mono, monospace); letter-spacing: .28em; color: #fff; }
.bf-kicker::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: rgb(var(--acc-hi, 255,142,154)); box-shadow: 0 0 10px rgb(var(--acc, 229,56,74)); animation: bf-pulse 1.2s ease-in-out infinite; }
@keyframes bf-pulse { 50% { opacity: .25; transform: scale(.7); } }
.bf-up { font: 600 13px/1 var(--f-mono, monospace); letter-spacing: .2em; text-transform: uppercase; color: var(--haze, #a88f92); margin-top: 4px; }
.bf-big { margin: -6px 0 0; font: 900 clamp(68px, 19vw, 112px)/.95 var(--f-display, system-ui); letter-spacing: -.02em; background: linear-gradient(100deg, #fff 0%, #ffd9dc 35%, rgb(var(--acc-hi, 255,142,154)) 48%, #fff 52%, #ffd9dc 65%, #fff 100%); background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 22px rgba(var(--acc, 229,56,74),.65)); animation: bf-shine 3.2s ease-in-out 1s infinite; }
@keyframes bf-shine { 0% { background-position: 100% 0; } 60%, 100% { background-position: -50% 0; } }
.bf-text { margin: 0; color: var(--haze, #a88f92); font: 500 15px/1.55 var(--f-body, system-ui); max-width: 380px; }
.bf-clock { display: flex; gap: 8px; justify-content: center; }
.bf-clock span { min-width: 58px; padding: 9px 6px 7px; border-radius: 12px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,210,214,.14); font: 800 22px/1 var(--f-display, system-ui); font-variant-numeric: tabular-nums; }
.bf-clock small { display: block; margin-top: 5px; font: 500 9px/1 var(--f-mono, monospace); letter-spacing: .16em; text-transform: uppercase; color: var(--haze, #a88f92); }
.bf-deals { width: 100%; display: grid; gap: 8px; margin: 4px 0 0; padding: 0; list-style: none; }
.bf-deals li { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,210,214,.1); text-align: left; opacity: 0; transform: translateY(10px); transition: opacity .5s, transform .5s cubic-bezier(.2,.8,.2,1); }
.np-back.in .bf-deals li { opacity: 1; transform: none; }
.bf-deals a { color: inherit; text-decoration: none; font: 700 14px/1.2 var(--f-display, system-ui); letter-spacing: .02em; }
.bf-deals b { white-space: nowrap; padding: 5px 8px; border-radius: 8px; background: linear-gradient(180deg, rgb(var(--acc, 229,56,74)), rgb(var(--acc-lo, 122,13,28))); font: 700 12px/1 var(--f-mono, monospace); color: #fff; }
.bf-deals .bf-price { text-align: right; font: 800 15px/1.1 var(--f-display, system-ui); white-space: nowrap; }
.bf-deals s { display: block; font: 500 11px/1.2 var(--f-body, system-ui); color: var(--haze, #a88f92); }
.bf-card .np-cta { animation: bf-glow 2.2s ease-in-out infinite; }
@keyframes bf-glow { 50% { box-shadow: 0 10px 40px rgba(var(--acc, 229,56,74),.7), 0 0 0 4px rgba(var(--acc, 229,56,74),.18); } }
@media (prefers-reduced-motion: reduce) { .bf-card, .bf-deals li { transition: none; } .bf-embers, .bf-kicker::before, .bf-big, .bf-card .np-cta { animation: none !important; } .bf-embers { display: none; } }`;
  document.head.append(saleStyle);
  const euros = (cents) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: cents % 100 ? 2 : 0 });
  function saleCard(p, x, close) {
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const embers = make("div", { className: "bf-embers" });
    for (let i = 0; i < (calm ? 0 : 26); i++) {
      const e = make("i");
      e.style.cssText = `left:${Math.random() * 100}%;--s:${2 + Math.random() * 4}px;--d:${4 + Math.random() * 5}s;--w:${-Math.random() * 8}s;--x:${(Math.random() - .5) * 120}px`;
      embers.append(e);
    }
    const top = Number((p.title.match(/(\d+)/) || [])[1]) || 0;
    const big = make("h2", { className: "bf-big", textContent: `-${calm ? top : 0} %` });
    big.setAttribute("aria-label", p.title);
    // Le pourcentage compte jusqu'à sa valeur quand la carte s'ouvre.
    if (!calm && top) setTimeout(() => { const t0 = performance.now(); const step = (t) => { const k = Math.min(1, (t - t0) / 900); big.textContent = `-${Math.round(top * (1 - (1 - k) ** 3))} %`; if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }, 950);
    const unit = (label) => { const n = make("span", { textContent: "00" }); n.append(make("small", { textContent: label })); return n; };
    const parts = [unit("jours"), unit("h"), unit("min"), unit("s")];
    const tick = () => {
      let left = Math.max(0, Math.floor((p.endsAt - Date.now()) / 1000));
      const values = [Math.floor(left / 86400), Math.floor(left / 3600) % 24, Math.floor(left / 60) % 60, left % 60];
      values.forEach((v, i) => { parts[i].firstChild.nodeValue = String(v).padStart(2, "0"); });
      if (!left) clearInterval(timer);
    };
    const timer = p.endsAt ? setInterval(tick, 1000) : null;
    if (p.endsAt) tick();
    const deals = make("ul", { className: "bf-deals" }, ...(p.deals || []).map((d, i) => {
      const li = make("li", {},
        make("b", { textContent: d.sale.label }),
        make("a", { href: d.href || "/boutique/" + encodeURIComponent(d.slug), textContent: d.name }),
        make("span", { className: "bf-price" }, make("s", { textContent: euros(d.priceCents) }), euros(d.sale.priceCents)));
      li.style.transitionDelay = `${.45 + i * .09}s`;
      return li;
    }));
    const later = make("button", { type: "button", className: "np-later", textContent: "Plus tard" });
    later.onclick = () => { clearInterval(timer); close(); };
    x.addEventListener("click", () => clearInterval(timer));
    return make("div", { className: "bf-card" }, embers, x,
      make("div", { className: "bf-body" },
        make("span", { className: "bf-kicker", textContent: p.kicker }),
        make("span", { className: "bf-up", textContent: "jusqu'à" }),
        big,
        p.text ? make("p", { className: "bf-text", textContent: p.text }) : null,
        p.endsAt ? make("div", { className: "bf-clock", role: "timer" }, ...parts) : null,
        deals,
        p.link ? make("a", { className: "np-cta", href: p.link, textContent: (p.linkLabel || "Voir") + " →" }) : null,
        later));
  }

  // Les soldes ne s'ouvrent pas à l'arrivée sur le site : seulement quand le visiteur entre dans la boutique (la page
  // boutique ou la fiche d'un plugin), une fois par visiteur. Les autres nouveautés gardent l'ouverture du site.
  const inShop = () => /^\/boutique(\.html)?(\/|$)/.test(location.pathname);
  function show(p) {
    if (done || !p || !p.id || seen(p.id) || location.pathname.startsWith("/admin")) return;
    if (p.theme === "black-friday" && !inShop()) return;
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
    const card = p.theme === "black-friday" ? saleCard(p, x, close) : make("div", { className: "np-card" },
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
