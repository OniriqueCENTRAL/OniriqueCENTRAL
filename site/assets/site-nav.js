// La navigation commune à toutes les pages du site :
//   - sur téléphone (et sur un écran étroit), un bouton menu ouvre un panneau avec toutes les rubriques, les outils,
//     les réseaux d'ONIRIQUE et le compte ;
//   - « Nos réseaux » (YouTube, Instagram, TikTok…) : les adresses réglées dans le panel admin (/api/site),
//     dans l'en-tête de la page d'accueil, dans le panneau et en pied de page.
// À charger après tools-menu.js (la liste des outils) et account.js.
(() => {
  const home = /(^\/$|\/(index|onirique)(\.html)?$)/.test(location.pathname);
  const at = (hash) => (home ? hash : "/" + hash);
  // L'ordre des rubriques, partout : celui de l'en-tête de la page d'accueil.
  const SECTIONS = [
    ["Boutique", "boutique.html"], ["Téléchargement", at("#telechargement")], ["Outils", "outils.html"],
    ["Crédits", at("#credits")], ["FAQ", at("#faq")], ["Support", "support.html"],
  ];
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter((c) => c !== null && c !== undefined));
    return node;
  };
  const svg = (markup) => { const span = el("span", { className: "sn-icon" }); span.innerHTML = markup; return span; };

  // Des pictogrammes simples, d'un seul trait, à la couleur du texte.
  const ICONS = {
    youtube: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/></svg>',
    instagram: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24"><path d="M14 3.5v11.2a3.8 3.8 0 1 1-3.8-3.8M14 3.5c.4 2.6 2.2 4.4 5 4.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M4.5 4.5l15 15M19.5 4.5l-15 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    spotify: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 9.6c3-1 6.4-.8 9 .7M8 12.6c2.6-.7 5.2-.5 7.4.7M8.6 15.4c2-.5 3.9-.3 5.6.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    soundcloud: '<svg viewBox="0 0 24 24"><path d="M9 17.5h9a3.5 3.5 0 0 0 0-7 5.5 5.5 0 0 0-9.4-2.6M3.5 17.5v-4M6 17.5v-6.5M8.5 17.5V9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    discord: '<svg viewBox="0 0 24 24"><path d="M7 7.5c3.3-1.4 6.7-1.4 10 0 1.6 2.5 2.4 5.2 2.3 8.2-1.4 1.1-2.9 1.8-4.5 2.2l-1-1.7m-3.6 0l-1 1.7C7.6 17.5 6.1 16.8 4.7 15.7c-.1-3 .7-5.7 2.3-8.2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="9.5" cy="12.5" r="1.3" fill="currentColor"/><circle cx="14.5" cy="12.5" r="1.3" fill="currentColor"/></svg>',
    twitch: '<svg viewBox="0 0 24 24"><path d="M5 3.5h15v10.5l-4 4h-3.5l-3 3v-3H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M11 8v4M15.5 8v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    facebook: '<svg viewBox="0 0 24 24"><path d="M14.5 8.5H17V5h-2.5a4 4 0 0 0-4 4v2.5H8V15h2.5v6h3.5v-6H17l.5-3.5H14V9.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  };

  document.head.append(el("style", { textContent: `
.sn-burger { display: none; flex: none; width: 44px; height: 44px; align-items: center; justify-content: center; padding: 0; border-radius: 999px; border: 1px solid var(--line, rgba(255,210,214,.16)); background: rgba(255,255,255,.04); color: var(--mist, #f6eeee); cursor: pointer; }
.sn-burger svg { width: 20px; height: 20px; }
.sn-burger:hover, .sn-burger:focus-visible { border-color: var(--ember, #e23444); }
.sn-panel { position: fixed; inset: 0; z-index: 200; display: flex; flex-direction: column; padding: calc(env(safe-area-inset-top, 0px) + 14px) max(16px, env(safe-area-inset-right, 0px)) calc(env(safe-area-inset-bottom, 0px) + 20px) max(16px, env(safe-area-inset-left, 0px));
  background: radial-gradient(120% 60% at 50% -10%, rgba(140,6,20,.85), rgba(92,0,8,.45) 40%, transparent 75%), var(--night, #0d0809); overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.sn-panel[hidden] { display: none; }
.sn-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.sn-top b { font: 800 16px/1 var(--f-display, "Arial Black", sans-serif); letter-spacing: .2em; color: var(--mist, #f6eeee); }
.sn-links { display: grid; gap: 2px; }
.sn-links > a, .sn-links > button { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 54px; padding: 0 6px; border: 0; border-bottom: 1px solid var(--line, rgba(255,210,214,.13)); background: none; color: var(--mist, #f6eeee); font: 700 21px/1.2 var(--f-display, "Arial Black", sans-serif); letter-spacing: .02em; text-align: left; text-decoration: none; cursor: pointer; }
.sn-links > a::after { content: "→"; font: 400 18px var(--f-body, system-ui); color: var(--haze, #a88f92); }
.sn-links > button::after { content: "+"; font: 400 24px var(--f-body, system-ui); color: var(--haze, #a88f92); }
.sn-links > button[aria-expanded="true"]::after { content: "−"; }
.sn-tools { display: grid; gap: 14px; padding: 12px 6px 16px; border-bottom: 1px solid var(--line, rgba(255,210,214,.13)); }
.sn-tools[hidden] { display: none; }
.sn-tools h3 { margin: 0 0 4px; font: 500 11px/1.4 var(--f-mono, ui-monospace, monospace); letter-spacing: .16em; text-transform: uppercase; color: var(--haze, #a88f92); }
.sn-tools a { display: block; padding: 8px 0; color: var(--mist, #f6eeee); font: 500 16px/1.3 var(--f-body, system-ui); text-decoration: none; }
.sn-title { margin: 26px 6px 10px; font: 500 11px/1 var(--f-mono, ui-monospace, monospace); letter-spacing: .18em; text-transform: uppercase; color: var(--haze, #a88f92); }
.sn-socials { display: flex; flex-wrap: wrap; gap: 10px; }
.sn-socials a { display: inline-flex; align-items: center; gap: 9px; min-height: 44px; padding: 0 16px 0 12px; border-radius: 999px; border: 1px solid var(--line, rgba(255,210,214,.16)); background: rgba(255,255,255,.03); color: var(--mist, #f6eeee); font: 600 14px/1 var(--f-body, system-ui); text-decoration: none; }
.sn-socials a:hover, .sn-socials a:focus-visible { border-color: var(--ember, #e23444); outline: none; }
.sn-icon { display: inline-flex; width: 20px; height: 20px; flex: none; }
.sn-icon svg { width: 100%; height: 100%; }
.sn-account { display: flex; gap: 10px; margin-top: 26px; }
.sn-account a { flex: 1; display: inline-flex; justify-content: center; align-items: center; min-height: 50px; border-radius: 999px; font: 600 15px/1 var(--f-body, system-ui); text-decoration: none; }
.sn-account .sn-primary { background: var(--mist, #f6eeee); color: var(--night, #0d0809); }
.sn-account .sn-ghost { border: 1px solid var(--line, rgba(255,210,214,.16)); color: var(--mist, #f6eeee); }
html.sn-lock, html.sn-lock body { overflow: hidden; }
/* iPhone : pas d'agrandissement du texte en paysage, et pas de zoom automatique quand on touche un champ
   (Safari zoome sur tout champ écrit en moins de 16 px, et la page reste ensuite décalée). */
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
@media (max-width: 760px) { input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea { font-size: max(16px, 1em) !important; } }
/* « Nos réseaux » dans l'en-tête et en pied de page */
.sn-social-menu { position: relative; display: inline-flex; }
.sn-social-btn { display: inline-flex; align-items: center; gap: 7px; border: 0; padding: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
.sn-social-btn:hover { color: var(--mist, #f6eeee); }
.sn-social-btn::after { content: ""; width: 6px; height: 6px; margin-top: -3px; border: solid currentColor; border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); }
.sn-social-drop { position: absolute; right: 0; top: calc(100% + 12px); z-index: 80; min-width: 210px; padding: 8px; border-radius: 16px; border: 1px solid var(--line, rgba(255,210,214,.16)); background: linear-gradient(180deg, var(--deep-2, #2a0a0e), var(--deep, #1a080a)); box-shadow: 0 24px 60px -12px rgba(0,0,0,.8); }
.sn-social-drop a { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; color: var(--mist, #f6eeee); font: 500 14px/1.2 var(--f-body, system-ui); text-decoration: none; }
.sn-social-drop a:hover, .sn-social-drop a:focus-visible { background: rgba(226,52,68,.16); outline: none; }
.sn-foot { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin: 0 auto 18px; }
.sn-foot a { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 999px; border: 1px solid var(--line, rgba(255,210,214,.16)); color: var(--haze, #a88f92); }
.sn-foot a:hover, .sn-foot a:focus-visible { color: var(--mist, #f6eeee); border-color: var(--ember, #e23444); outline: none; }
.sn-foot .sn-icon { width: 19px; height: 19px; }
/* Langue : une pastille FR | EN dans l'en-tête, toujours visible, et un bandeau en anglais pour qui ne lit pas le français */
.sn-lang { display: inline-flex; flex: none; align-items: center; padding: 3px; gap: 2px; border-radius: 999px; border: 1px solid var(--line, rgba(255,210,214,.16)); background: rgba(255,255,255,.04); }
.sn-lang svg { width: 15px; height: 15px; margin: 0 4px 0 6px; color: var(--haze, #a88f92); flex: none; }
.sn-lang button { min-width: 34px; height: 30px; padding: 0 9px; border: 0; border-radius: 999px; background: none; color: var(--haze, #a88f92); font: 600 12px/1 var(--f-mono, ui-monospace, monospace); letter-spacing: .08em; cursor: pointer; }
.sn-lang button:hover { color: var(--mist, #f6eeee); }
.sn-lang button[aria-pressed="true"] { background: var(--ember, #e23444); color: #fff; }
header .sn-lang { margin-left: 8px; }
.sn-langbar { position: fixed; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 150; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px 14px; width: max-content; max-width: calc(100vw - 24px); padding: 12px 14px 12px 18px; border-radius: 18px; border: 1px solid rgba(226,52,68,.55); background: linear-gradient(180deg, var(--deep-2, #2a0a0e), var(--deep, #1a080a)); box-shadow: 0 20px 60px -12px rgba(0,0,0,.85), 0 0 0 4px rgba(226,52,68,.12); color: var(--mist, #f6eeee); font: 500 15px/1.35 var(--f-body, system-ui); }
.sn-langbar strong { font-weight: 700; }
.sn-langbar-text { display: inline-flex; align-items: center; gap: 8px; }
.sn-langbar-text svg { width: 17px; height: 17px; flex: none; color: var(--ember, #e23444); }
.sn-langbar .sn-go { padding: 10px 16px; border: 0; border-radius: 999px; background: var(--mist, #f6eeee); color: var(--night, #0d0809); font: 700 14px/1 var(--f-body, system-ui); cursor: pointer; }
.sn-langbar .sn-x { width: 34px; height: 34px; border: 1px solid var(--line, rgba(255,210,214,.16)); border-radius: 999px; background: none; color: var(--haze, #a88f92); font: 400 18px/1 var(--f-body, system-ui); cursor: pointer; }
/* Téléchargement d'ONIRIQUE CENTRAL : choix du système */
.sn-dl { position: fixed; inset: 0; z-index: 400; display: grid; place-items: center; padding: 16px; background: rgba(5,2,3,.72); backdrop-filter: blur(6px); }
.sn-dl-box { position: relative; width: min(560px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; padding: 30px 28px 26px; border-radius: 22px; border: 1px solid rgba(226,52,68,.4); background: radial-gradient(120% 70% at 50% -20%, rgba(140,6,20,.55), transparent 70%), var(--deep, #1a080a); box-shadow: 0 30px 90px -20px #000; color: var(--mist, #f6eeee); }
.sn-dl-box h2 { margin: 6px 0 14px; font: 800 clamp(22px, 4vw, 28px)/1.15 var(--f-display, "Arial Black", sans-serif); }
.sn-dl-eyebrow { margin: 0; font: 500 11px/1 var(--f-mono, ui-monospace, monospace); letter-spacing: .24em; color: var(--haze, #a88f92); }
.sn-dl-text, .sn-dl-wait { margin: 0 0 18px; font: 400 15px/1.6 var(--f-body, system-ui); color: var(--haze, #c9b5b8); }
.sn-dl-note { margin: 18px 0 0; font: 400 13px/1.55 var(--f-body, system-ui); color: var(--haze, #a88f92); }
.sn-dl-x { position: absolute; right: 14px; top: 14px; width: 36px; height: 36px; border: 1px solid var(--line, rgba(255,210,214,.16)); border-radius: 999px; background: none; color: var(--haze, #a88f92); font: 400 20px/1 var(--f-body, system-ui); cursor: pointer; }
.sn-dl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.sn-dl-os { display: flex; align-items: center; gap: 14px; padding: 18px; border-radius: 16px; border: 1px solid var(--line, rgba(255,210,214,.16)); background: rgba(255,255,255,.03); color: var(--mist, #f6eeee); text-decoration: none; transition: border-color .2s, background .2s, transform .2s; }
.sn-dl-os:hover, .sn-dl-os:focus-visible { border-color: var(--ember, #e23444); background: rgba(226,52,68,.12); transform: translateY(-2px); outline: none; }
.sn-dl-os.best { border-color: rgba(226,52,68,.65); }
.sn-dl-os svg { flex: none; width: 30px; height: 30px; color: var(--bone, #ffecee); }
.sn-dl-os span { display: grid; gap: 5px; }
.sn-dl-os b { font: 800 17px/1 var(--f-display, "Arial Black", sans-serif); letter-spacing: .04em; }
.sn-dl-os small { font: 400 12px/1.4 var(--f-body, system-ui); color: var(--haze, #a88f92); }
.sn-dl-row { display: flex; flex-wrap: wrap; gap: 10px; }
.sn-dl-main, .sn-dl-ghost { display: inline-flex; align-items: center; justify-content: center; min-height: 46px; padding: 0 20px; border-radius: 999px; font: 700 14px/1 var(--f-body, system-ui); text-decoration: none; cursor: pointer; }
.sn-dl-main { border: 0; background: var(--mist, #f6eeee); color: var(--night, #0d0809); }
.sn-dl-main:disabled { opacity: .6; cursor: default; }
.sn-dl-ghost { border: 1px solid var(--line, rgba(255,210,214,.16)); color: var(--mist, #f6eeee); }
/* Annonce en direct, au-dessus de l'en-tête */
.sn-announce { position: relative; z-index: 60; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 10px 48px; font: 600 14px/1.4 var(--f-body, system-ui); text-align: center; }
.sn-announce p { margin: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px 16px; }
.sn-announce span { letter-spacing: .02em; }
.sn-announce a { color: inherit; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
.sn-announce-x { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); width: 32px; height: 32px; border: 0; border-radius: 999px; background: rgba(0,0,0,.18); color: inherit; font: 400 20px/1 var(--f-body, system-ui); cursor: pointer; }
.sn-announce.tone-ember { background: linear-gradient(90deg, #8c0614, #e23444 60%, #8c0614); color: #fff; }
.sn-announce.tone-gold { background: linear-gradient(90deg, #b8862b, #f2c46d 55%, #b8862b); color: #1a0d02; }
.sn-announce.tone-calm { background: var(--deep-2, #2a0a0e); color: var(--mist, #f6eeee); border-bottom: 1px solid var(--line, rgba(255,210,214,.16)); }
/* Maintenance */
.sn-maint { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 32px 20px; text-align: center; background: radial-gradient(90% 60% at 50% 0%, rgba(140,6,20,.75), rgba(92,0,8,.35) 45%, transparent 80%), var(--night, #0d0809); color: var(--mist, #f6eeee); }
.sn-maint img { width: 108px; height: auto; filter: drop-shadow(0 0 18px rgba(226,52,68,.8)); }
.sn-maint-eyebrow { margin: 6px 0 0; font: 500 12px/1 var(--f-mono, ui-monospace, monospace); letter-spacing: .3em; color: var(--haze, #a88f92); }
.sn-maint h1 { margin: 0; font: 800 clamp(34px, 7vw, 64px)/1.05 var(--f-display, "Arial Black", sans-serif); letter-spacing: -.01em; }
.sn-maint-text { max-width: 46ch; margin: 0; font: 400 17px/1.6 var(--f-body, system-ui); color: var(--haze, #c9b5b8); }
.sn-maint-link { margin-top: 18px; font: 500 12px/1 var(--f-mono, ui-monospace, monospace); letter-spacing: .16em; text-transform: uppercase; color: var(--haze, #a88f92); }
.sn-maint-flag { position: relative; z-index: 60; padding: 8px 16px; background: #ffb347; color: #1a0d02; font: 700 13px/1.4 var(--f-body, system-ui); text-align: center; }
.sn-langrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 22px; padding: 0 6px; }
.sn-langrow span { font: 500 11px/1 var(--f-mono, ui-monospace, monospace); letter-spacing: .18em; text-transform: uppercase; color: var(--haze, #a88f92); }
@media (max-width: 1280px) { .nav .sn-burger { display: inline-flex; } }
@media (max-width: 760px) {
  header .sn-burger { display: inline-flex; }
  header nav:not(.nav-links) > :not([data-account]):not(.acct) { display: none !important; }
}
/* Téléphone : l'en-tête tient sur la largeur de l'écran (sinon Safari laisse glisser la page de côté et le bouton menu
   sort de l'écran). La langue passe dans le menu, qui l'a déjà ; le compte ne montre plus que sa photo. */
@media (max-width: 560px) {
  header .sn-lang { display: none; }
  header .nav-inner, header > .wrap { gap: 10px; }
  header .nav-actions { gap: 8px; min-width: 0; }
  header .acct-button { gap: 6px; padding: 4px 10px 4px 4px; }
  header .acct-button span { display: none; }
  header.nav .btn { padding: 10px 14px; }
}
@media (max-width: 360px) {
  header .acct-button svg { display: none; }
  header .acct-button { padding: 4px; }
  header.nav .btn { padding: 9px 12px; font-size: 13px; }
}
` }));

  // Le panneau des téléphones.
  const header = document.querySelector("header");
  const burger = el("button", { type: "button", className: "sn-burger", title: "Menu" });
  burger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  burger.setAttribute("aria-label", "Ouvrir le menu");
  burger.setAttribute("aria-expanded", "false");

  const close = el("button", { type: "button", className: "sn-burger", title: "Fermer" });
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  close.setAttribute("aria-label", "Fermer le menu");
  close.style.display = "inline-flex";

  const tools = el("div", { className: "sn-tools", hidden: true }, ...(window.OniriqueTools || []).map(([group, list]) =>
    el("div", {}, el("h3", { textContent: group }), ...list.map(([name, href]) => el("a", { href, textContent: name })))),
    el("a", { href: "outils.html", textContent: "Tous les outils →" }));
  const links = el("nav", { className: "sn-links" });
  links.setAttribute("aria-label", "Rubriques");
  for (const [name, href] of SECTIONS) {
    if (name === "Outils" && window.OniriqueTools) {
      const toggle = el("button", { type: "button", textContent: "Outils" });
      toggle.setAttribute("aria-expanded", "false");
      toggle.onclick = () => { tools.hidden = !tools.hidden; toggle.setAttribute("aria-expanded", String(!tools.hidden)); };
      links.append(toggle, tools);
    } else {
      links.append(el("a", { href, textContent: name }));
    }
  }
  const socialsTitle = el("p", { className: "sn-title", textContent: "Nos réseaux", hidden: true });
  const socialsBox = el("div", { className: "sn-socials", hidden: true });
  const signedIn = (() => { try { return !!(sessionStorage.getItem("onirique.token") || localStorage.getItem("onirique.token")); } catch { return false; } })();
  const account = el("div", { className: "sn-account" },
    el("a", { className: "sn-ghost", href: "compte.html", textContent: signedIn ? "Mon compte" : "Connexion" }),
    el("a", { className: "sn-primary", href: "boutique.html", textContent: "Acheter" }));
  const panel = el("div", { className: "sn-panel", hidden: true },
    el("div", { className: "sn-top" }, el("b", { textContent: "ONIRIQUE" }), close), links, socialsTitle, socialsBox, account);
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Menu");

  const open = (on) => {
    panel.hidden = !on;
    burger.setAttribute("aria-expanded", String(on));
    document.documentElement.classList.toggle("sn-lock", on);
    if (on) close.focus(); else burger.focus({ preventScroll: true });
  };
  burger.onclick = () => open(true);
  close.onclick = () => open(false);
  panel.addEventListener("click", (event) => { if (event.target.closest("a")) open(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) open(false); });
  // La langue : français par défaut, anglais au choix (assets/i18n.js). La pastille ne se traduit pas.
  const i18n = window.OniriqueI18n;
  const langSwitch = () => {
    const box = el("div", { className: "sn-lang" });
    box.setAttribute("data-no-translate", "");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "Langue / Language");
    box.insertAdjacentHTML("afterbegin", '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>');
    for (const [code, label, title] of [["fr", "FR", "Français"], ["en", "EN", "English"]]) {
      const b = el("button", { type: "button", textContent: label, title });
      b.setAttribute("lang", code);
      b.setAttribute("aria-pressed", String((i18n?.lang || "fr") === code));
      b.onclick = () => { if (i18n && i18n.lang !== code) i18n.set(code); };
      box.append(b);
    }
    return box;
  };

  if (header) {
    // Le bouton se place en fin d'en-tête, à droite, sans déranger les boutons déjà là ; la langue juste avant.
    const row = header.querySelector(".nav-inner, .wrap") || header;
    if (i18n) row.append(langSwitch());
    row.append(burger);
    if (i18n) {
      const langRow = el("div", { className: "sn-langrow" }, el("span", { textContent: "Langue · Language" }), langSwitch());
      langRow.setAttribute("data-no-translate", "");
      panel.insertBefore(langRow, account);
    }
    document.body.append(panel);
  }

  // Un visiteur dont le navigateur n'est pas en français voit, une fois, un bandeau en anglais pour passer en anglais.
  try {
    const languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    const french = languages.some((l) => /^fr/i.test(l));
    const decided = localStorage.getItem("onirique.lang") || localStorage.getItem("onirique.lang.prompted");
    if (i18n && i18n.lang === "fr" && !french && !decided) {
      const bar = el("div", { className: "sn-langbar", role: "dialog" },
        el("span", { className: "sn-langbar-text" }, el("strong", { textContent: "This site is available in English." }), " Prefer it?"),
        el("button", { type: "button", className: "sn-go", textContent: "Switch to English" }),
        el("button", { type: "button", className: "sn-x", textContent: "×", title: "Keep French" }));
      bar.setAttribute("data-no-translate", "");
      bar.setAttribute("aria-label", "Language");
      bar.querySelector(".sn-langbar-text").insertAdjacentHTML("afterbegin", '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>');
      bar.lang = "en";
      bar.querySelector(".sn-go").onclick = () => i18n.set("en");
      bar.querySelector(".sn-x").onclick = () => { try { localStorage.setItem("onirique.lang.prompted", "1"); } catch {} bar.remove(); };
      document.body.append(bar);
    }
  } catch { /* stockage fermé : pas de bandeau */ }

  // L'annonce du moment (réglée en direct dans le panel admin) : un bandeau au-dessus de l'en-tête, qu'on peut fermer.
  // Un nouveau texte a un nouveau numéro : il réapparaît chez ceux qui avaient fermé le précédent.
  const showAnnouncement = (a) => {
    if (!a || document.querySelector(".sn-announce")) return;
    try { if (localStorage.getItem("onirique.announce.closed") === a.id) return; } catch { /* stockage fermé : on l'affiche */ }
    const bar = el("div", { className: "sn-announce tone-" + (a.tone || "ember"), role: "region" });
    bar.setAttribute("aria-label", "Annonce");
    const body = el("p", {}, el("span", { textContent: a.text }));
    if (a.link) body.append(el("a", { href: a.link, textContent: (a.linkLabel || "Voir") + " →" }));
    const close = el("button", { type: "button", className: "sn-announce-x", textContent: "×", title: "Fermer l'annonce" });
    close.setAttribute("aria-label", "Fermer l'annonce");
    close.onclick = () => { try { localStorage.setItem("onirique.announce.closed", a.id); } catch {} bar.remove(); };
    bar.append(body, close);
    document.body.prepend(bar);
  };
  // Le dernier bandeau connu s'affiche tout de suite, sans attendre le serveur : ajouté après coup, il faisait
  // descendre toute la page sous les yeux du visiteur. La réponse du serveur le confirme, le change ou le retire.
  let knownAnnouncement = null;
  try { knownAnnouncement = JSON.parse(localStorage.getItem("onirique.announce") || "null"); } catch { /* stockage fermé */ }
  if (knownAnnouncement && (!knownAnnouncement.endsAt || knownAnnouncement.endsAt > Date.now())) showAnnouncement(knownAnnouncement);

  // Maintenance : le site public laisse place à une page d'attente. L'équipe connectée continue de voir le site.
  const showMaintenance = async (m) => {
    if (!m || /\/(admin|compte)(\.html)?$/.test(location.pathname)) return;
    const token = (() => { try { return sessionStorage.getItem("onirique.token") || localStorage.getItem("onirique.token"); } catch { return null; } })();
    if (token) {
      try {
        const me = await fetch("/api/me", { headers: { Authorization: "Bearer " + token } }).then((r) => (r.ok ? r.json() : null));
        if (me && ["admin", "founder"].includes(me.user?.role)) {
          const flag = el("div", { className: "sn-maint-flag", textContent: "Maintenance active : seuls les comptes de l'équipe voient le site." });
          document.body.prepend(flag);
          return;
        }
      } catch { /* hors ligne : la page d'attente */ }
    }
    const page = el("div", { className: "sn-maint", role: "alert" },
      el("img", { src: "/assets/logo-small.png", alt: "", width: 120, height: 109 }),
      el("p", { className: "sn-maint-eyebrow", textContent: "ONIRIQUE" }),
      el("h1", { textContent: "On revient vite." }),
      el("p", { className: "sn-maint-text", textContent: m.message || "Le site est en maintenance, le temps d'une petite intervention. Les plugins et ONIRIQUE CENTRAL continuent de fonctionner." }),
      el("a", { href: "/compte.html", className: "sn-maint-link", textContent: "Espace équipe" }));
    document.documentElement.classList.add("sn-lock");
    document.body.append(page);
  };

  // Télécharger ONIRIQUE CENTRAL : tout lien vers l'installeur ouvre un choix Windows / Mac. Le téléchargement est
  // réservé aux comptes dont l'adresse e-mail est validée (comme les essais gratuits) : sinon, on explique quoi faire.
  const FILES = { win: "/telechargement/ONIRIQUE-CENTRAL-Setup.exe", mac: "/telechargement/ONIRIQUE-CENTRAL.dmg" };
  const tokenNow = () => { try { return sessionStorage.getItem("onirique.token") || localStorage.getItem("onirique.token"); } catch { return null; } };
  const OS_ICONS = {
    win: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5.6 10.4 4.6v7H3zM11.4 4.4 21 3v8.6h-9.6zM3 12.5h7.4v7L3 18.4zM11.4 12.5H21V21l-9.6-1.4z" fill="currentColor"/></svg>',
    mac: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.6 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.1-1.2 2.9-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.4-.9-2.4-3.9zM14.2 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4z" fill="currentColor"/></svg>',
  };
  async function openDownload(preferred) {
    document.querySelector(".sn-dl")?.remove();
    const box = el("div", { className: "sn-dl-box", role: "dialog" });
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Télécharger ONIRIQUE CENTRAL");
    const shade = el("div", { className: "sn-dl" }, box);
    const close = () => { shade.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (event) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    shade.addEventListener("click", (event) => { if (event.target === shade) close(); });
    const x = el("button", { type: "button", className: "sn-dl-x", textContent: "×" });
    x.setAttribute("aria-label", "Fermer");
    x.onclick = close;
    box.append(x, el("p", { className: "sn-dl-eyebrow", textContent: "ONIRIQUE CENTRAL" }), el("p", { className: "sn-dl-wait", textContent: "Un instant…" }));
    document.body.append(shade);

    const token = tokenNow();
    let me = null;
    if (token) { try { me = await fetch("/api/me", { headers: { Authorization: "Bearer " + token } }).then((r) => (r.ok ? r.json() : null)); } catch { /* hors ligne */ } }
    box.querySelector(".sn-dl-wait").remove();
    const user = me && me.user;
    if (!user) {
      box.append(el("h2", { textContent: "Crée ton compte d'abord" }),
        el("p", { className: "sn-dl-text", textContent: "ONIRIQUE CENTRAL se télécharge avec un compte ONIRIQUE gratuit, dont l'adresse e-mail est validée. C'est ce compte qui active tes plugins et tes essais." }),
        el("div", { className: "sn-dl-row" },
          el("a", { className: "sn-dl-main", href: "/compte.html?inscription=1&next=telecharger", textContent: "Créer mon compte" }),
          el("a", { className: "sn-dl-ghost", href: "/compte.html?next=telecharger", textContent: "J'ai déjà un compte" })));
      return;
    }
    if (user.emailVerified === false) {
      const send = el("button", { type: "button", className: "sn-dl-main", textContent: "Recevoir le lien de validation" });
      const said = el("p", { className: "sn-dl-text", role: "status" });
      send.onclick = async () => {
        send.disabled = true;
        try {
          const r = await fetch("/api/auth/verify/resend", { method: "POST", headers: { Authorization: "Bearer " + token } });
          if (!r.ok) throw new Error();
          said.textContent = "Lien envoyé à " + user.email + ". Ouvre-le, puis reviens télécharger. Pense aux indésirables.";
        } catch { said.textContent = "L'envoi n'a pas abouti : réessaie dans quelques minutes."; send.disabled = false; }
      };
      box.append(el("h2", { textContent: "Valide ton adresse e-mail" }),
        el("p", { className: "sn-dl-text", textContent: "Le téléchargement d'ONIRIQUE CENTRAL et les essais gratuits s'ouvrent une fois l'adresse " + user.email + " validée, avec le lien reçu par e-mail." }),
        el("div", { className: "sn-dl-row" }, send), said);
      return;
    }
    const mac = /Mac/i.test(navigator.platform || navigator.userAgent);
    const choice = (os, label, detail) => {
      const a = el("a", { className: "sn-dl-os" + ((preferred || (mac ? "mac" : "win")) === os ? " best" : ""), href: FILES[os] });
      a.setAttribute("download", "");
      a.insertAdjacentHTML("afterbegin", OS_ICONS[os]);
      a.append(el("span", {}, el("b", { textContent: label }), el("small", { textContent: detail })));
      a.addEventListener("click", () => setTimeout(close, 400));
      return a;
    };
    box.append(el("h2", { textContent: "Pour quel ordinateur ?" }),
      el("div", { className: "sn-dl-grid" },
        choice("win", "Windows", "Windows 10 ou 11, 64 bits · .exe"),
        choice("mac", "Mac", "macOS 11 ou plus récent · Intel et Apple Silicon · .dmg")),
      el("p", { className: "sn-dl-note", textContent: "Windows : si « Windows a protégé votre ordinateur » s'affiche, Informations complémentaires puis Exécuter quand même. Mac : à la première ouverture, clic droit sur l'application puis Ouvrir." }));
    box.querySelector(".sn-dl-os.best")?.focus();
  }
  window.OniriqueDownload = { open: openDownload };
  document.addEventListener("click", (event) => {
    const a = event.target.closest && event.target.closest('a[href*="telechargement/ONIRIQUE-CENTRAL"]');
    if (!a || a.closest(".sn-dl") || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    openDownload(/\.dmg$/i.test(a.getAttribute("href")) ? "mac" : /\.exe$/i.test(a.getAttribute("href")) && a.dataset.os ? "win" : null);
  }, true);
  // Arrivée depuis l'inscription ou la connexion (?telecharger) : le choix s'ouvre tout seul.
  if (new URLSearchParams(location.search).has("telecharger")) setTimeout(() => openDownload(), 300);

  // Nos réseaux, l'annonce et la maintenance : chargés une fois.
  fetch("/api/site", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((site) => {
    const announcement = (site && site.announcement) || null;
    try { localStorage.setItem("onirique.announce", JSON.stringify(announcement)); } catch { /* stockage fermé */ }
    if (JSON.stringify(announcement) !== JSON.stringify(knownAnnouncement)) {
      document.querySelector(".sn-announce")?.remove();
      showAnnouncement(announcement);
    }
    showMaintenance(site && site.maintenance);
    const socials = (site && site.socials) || [];
    if (!socials.length) return;
    const link = (s, withText) => {
      const a = el("a", { href: s.url, target: "_blank", rel: "noopener me", title: s.label }, svg(ICONS[s.id] || ICONS.x), withText ? s.label : null);
      if (!withText) a.setAttribute("aria-label", s.label);
      return a;
    };
    socialsBox.replaceChildren(...socials.map((s) => link(s, true)));
    socialsTitle.hidden = socialsBox.hidden = false;

    // L'en-tête de la page d'accueil : « Nos réseaux », après Support.
    const nav = document.querySelector(".nav-links");
    if (nav) {
      const button = el("button", { type: "button", className: "sn-social-btn", textContent: "Nos réseaux" });
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      const drop = el("div", { className: "sn-social-drop", hidden: true }, ...socials.map((s) => link(s, true)));
      const menu = el("div", { className: "sn-social-menu" }, button, drop);
      const show = (on) => { drop.hidden = !on; button.setAttribute("aria-expanded", String(on)); };
      button.onclick = () => show(drop.hidden);
      document.addEventListener("click", (event) => { if (!menu.contains(event.target)) show(false); });
      menu.addEventListener("keydown", (event) => { if (event.key === "Escape") { show(false); button.focus(); } });
      nav.append(menu);
    }
    // Le pied de page : une rangée de pictogrammes.
    const footer = document.querySelector("footer");
    if (footer) footer.prepend(el("div", { className: "sn-foot" }, ...socials.map((s) => link(s, false))));
  }).catch(() => {});

  // Un lien vers une section de la page (« Crédits ») : on s'arrête sous la barre du haut. La page bouge encore
  // pendant et après le trajet (images, crédits, aperçus chargés en route) : un traqueur suit la section, corrige
  // le but en route, puis la recale d'un coup une fois le défilement fini, jusqu'à 2,5 s sans aucun changement
  // (12 s au plus). Il s'arrête dès que le visiteur fait défiler lui-même. Valable pour toute section ajoutée.
  // Vérification après une modification de l'accueil : tools/cadrage.js.
  const headerGap = () => (header && getComputedStyle(header).position !== "static" ? header.getBoundingClientRect().height : 0) + 12;
  let stopTracking = null;
  const goTo = (target, smooth) => {
    if (stopTracking) stopTracking();   // un nouveau trajet remplace le précédent
    const root = document.documentElement;
    const top = () => Math.max (0, Math.min (target.getBoundingClientRect().top + window.scrollY - headerGap(), root.scrollHeight - window.innerHeight));
    const start = performance.now();
    let aim = top(), lastY = window.scrollY, calmSince = start;
    // « instant » : la page impose un défilement doux (scroll-behavior) qui ferait de chaque recalage une animation.
    window.scrollTo({ top: aim, behavior: smooth ? "smooth" : "instant" });

    const userEvents = ["wheel", "touchstart", "keydown", "pointerdown"];
    const stop = () => {
      clearInterval(timer);
      userEvents.forEach((name) => window.removeEventListener (name, stop));
      stopTracking = null;
    };
    userEvents.forEach((name) => window.addEventListener (name, stop, { passive: true }));
    stopTracking = stop;

    const timer = setInterval(() => {
      const now = performance.now(), wanted = top();
      const moving = Math.abs(window.scrollY - lastY) > 1;
      lastY = window.scrollY;
      if (Math.abs(wanted - aim) > 2) {
        aim = wanted;           // la section a bougé : nouveau but, même en plein trajet
        calmSince = now;
        if (moving) window.scrollTo({ top: aim, behavior: "smooth" });
      }
      if (! moving && now - start > 300 && Math.abs(wanted - window.scrollY) > 2) {
        window.scrollTo({ top: wanted, behavior: "instant" });
        calmSince = now;
      }
      if (now - calmSince > 2500 || now - start > 12000) stop();
    }, 50);
  };
  document.addEventListener("click", (event) => {
    const a = event.target.closest && event.target.closest('a[href*="#"]');
    if (!a || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const url = new URL(a.href, location.href);
    if (url.pathname !== location.pathname || !url.hash || url.hash.length < 2) return;
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!target) return;
    event.preventDefault();
    history.pushState(null, "", url.hash);
    goTo(target, !matchMedia("(prefers-reduced-motion: reduce)").matches);
  });
  // Arrivée depuis une autre page avec #section : même recalage une fois la page chargée.
  if (location.hash.length > 1) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) window.addEventListener("load", () => goTo(target, false), { once: true });
  }
})();
