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
    ["Écouter", at("#ecouter")], ["Crédits", at("#credits")], ["FAQ", at("#faq")], ["Support", "support.html"],
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
.sn-langbar .sn-go { padding: 10px 16px; border: 0; border-radius: 999px; background: var(--mist, #f6eeee); color: var(--night, #0d0809); font: 700 14px/1 var(--f-body, system-ui); cursor: pointer; }
.sn-langbar .sn-x { width: 34px; height: 34px; border: 1px solid var(--line, rgba(255,210,214,.16)); border-radius: 999px; background: none; color: var(--haze, #a88f92); font: 400 18px/1 var(--f-body, system-ui); cursor: pointer; }
.sn-langrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 22px; padding: 0 6px; }
.sn-langrow span { font: 500 11px/1 var(--f-mono, ui-monospace, monospace); letter-spacing: .18em; text-transform: uppercase; color: var(--haze, #a88f92); }
@media (max-width: 1280px) { .nav .sn-burger { display: inline-flex; } }
@media (max-width: 760px) {
  header .sn-burger { display: inline-flex; }
  header nav:not(.nav-links) > :not([data-account]):not(.acct) { display: none !important; }
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
        el("span", {}, "🌐 ", el("strong", { textContent: "This site is available in English." }), " Prefer it?"),
        el("button", { type: "button", className: "sn-go", textContent: "Switch to English" }),
        el("button", { type: "button", className: "sn-x", textContent: "×", title: "Keep French" }));
      bar.setAttribute("data-no-translate", "");
      bar.setAttribute("aria-label", "Language");
      bar.lang = "en";
      bar.querySelector(".sn-go").onclick = () => i18n.set("en");
      bar.querySelector(".sn-x").onclick = () => { try { localStorage.setItem("onirique.lang.prompted", "1"); } catch {} bar.remove(); };
      document.body.append(bar);
    }
  } catch { /* stockage fermé : pas de bandeau */ }

  // Nos réseaux : chargés une fois, montrés seulement s'il y en a.
  fetch("/api/site").then((r) => (r.ok ? r.json() : null)).then((site) => {
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
})();
