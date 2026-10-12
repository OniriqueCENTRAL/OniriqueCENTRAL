// Le menu « Outils » de l'en-tête : le lien marqué data-tools devient un bouton qui déroule les outils, par thème.
// Sans ce script, le lien mène à la page qui les liste tous (outils.html), dessinée à partir de la même liste.
// Ajouter un outil : une ligne dans le bon groupe de OniriqueTools.
window.OniriqueTools = [
  ["Analyser", [
    ["BPM et tonalité", "bpm-tonalite.html", "Le tempo, la gamme et le detune d'un morceau, et un WAV calé sur la grille."],
    ["Volume avant sortie", "volume-lufs.html", "Le niveau LUFS et le pic réel d'un master, plateforme par plateforme."],
    ["Vérificateur de stems", "stems.html", "Durée, fréquence, saturation : les pistes d'un projet contrôlées d'un coup."],
    ["Popularité", "popularite.html", "Le score de popularité Spotify d'un artiste ou d'un titre."],
  ]],
  ["Tempo et notes", [
    ["Tap tempo", "tap-tempo.html", "Tape le rythme, le BPM s'affiche."],
    ["Délais et reverb", "delais.html", "Les temps en millisecondes pour caler délais, pré-délais et reverbs sur le tempo."],
    ["Gammes", "gammes.html", "Les notes d'une gamme, sa relative et les tonalités qui s'enchaînent bien."],
  ]],
  ["Voix", [
    ["Accordeur", "accordeur.html", "La note chantée ou jouée au micro, et son écart en cents."],
    ["Tessiture", "tessiture.html", "Ta note la plus basse, la plus haute, et les tonalités qui te vont."],
  ]],
  ["Fichiers", [
    ["Convertisseur", "convertisseur.html", "WAV ou MP3, avec le choix de la fréquence et de la résolution."],
    ["Découpe et fondu", "decoupe.html", "Garder un passage, ajouter un fondu, exporter."],
    ["Transposer", "transposition.html", "Changer la hauteur ou le tempo d'un morceau, l'un sans l'autre."],
  ]],
  ["Sortie", [
    ["Revenus de streaming", "revenus-streaming.html", "Une fourchette de revenus pour un nombre d'écoutes."],
    ["Partage des droits", "partage.html", "Qui touche quoi sur un titre, dans une feuille à signer."],
    ["Checklist de sortie", "checklist-sortie.html", "Les étapes d'une sortie, datées de J-30 à J+7."],
  ]],
];

(() => {
  const link = document.querySelector("a[data-tools]");
  if (!link) return;
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  document.head.append(el("style", { textContent: `
.tools { position: relative; display: inline-flex; }
:where(.tools-btn) { border: 0; padding: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
.tools-btn { display: inline-flex; align-items: center; gap: 7px; background: none; cursor: pointer; }
.tools-btn:hover { color: var(--mist, #f6eeee); }
.tools-btn.btn:hover, .tools-btn.btn[aria-expanded="true"], .tools-btn.btn.here { border-color: var(--ember, #e23444); }
.tools-btn::after { content: ""; width: 6px; height: 6px; margin-top: -3px; border: solid currentColor; border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); transition: transform .2s; }
.tools-btn[aria-expanded="true"]::after { margin-top: 3px; transform: rotate(225deg); }
.tools-menu { position: absolute; left: 50%; top: calc(100% + 12px); z-index: 80; width: min(660px, calc(100vw - 24px)); max-height: min(78vh, 640px); overflow-y: auto; translate: -50% 0; padding: 16px 12px 8px; border-radius: 18px; border: 1px solid var(--line, rgba(255,210,214,.16)); background: linear-gradient(180deg, var(--deep-2, #2a0a0e), var(--deep, #1a080a)); box-shadow: 0 24px 60px -12px rgba(0,0,0,.8); text-align: left; }
.tools-groups { columns: 3 170px; column-gap: 8px; }
.tools-group { break-inside: avoid; margin: 0 0 12px; }
.tools-group h3 { margin: 0 0 4px; padding: 0 12px; font: 500 10px/1.6 var(--f-mono, ui-monospace, monospace); letter-spacing: .16em; text-transform: uppercase; color: var(--haze, #b9a2a5); }
.tools-menu a { display: block; padding: 9px 12px; border-radius: 10px; color: var(--mist, #f6eeee); font: 500 14px/1.25 var(--f-body, system-ui, sans-serif); text-decoration: none; }
.tools-menu a:hover, .tools-menu a:focus-visible, .tools-menu a[aria-current="page"] { background: rgba(226,52,68,.16); color: var(--mist, #f6eeee); outline: none; }
.tools-menu .tools-all { margin-top: 2px; padding-block: 12px; border-top: 1px solid var(--line, rgba(255,210,214,.16)); border-radius: 0 0 10px 10px; color: var(--ember-text, #ff6b78); font: 500 12px/1 var(--f-mono, ui-monospace, monospace); letter-spacing: .1em; text-transform: uppercase; }
` }));

  const page = location.pathname.split("/").pop().replace(/\.html$/, "");
  const here = (href) => href.replace(/\.html$/, "") === page;
  const item = (name, href) => {
    const a = el("a", { href, textContent: name });
    a.setAttribute("role", "menuitem");
    if (here(href)) a.setAttribute("aria-current", "page");
    return a;
  };
  const button = el("button", { type: "button", className: (link.className + " tools-btn").trim(), textContent: "Outils" });
  if (here("outils") || window.OniriqueTools.some(([, tools]) => tools.some(([, href]) => here(href)))) button.classList.add("here");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const all = item("Tous les outils →", "outils.html");
  all.className = "tools-all";
  const menu = el("div", { className: "tools-menu", hidden: true },
    el("div", { className: "tools-groups" }, ...window.OniriqueTools.map(([group, tools]) =>
      el("div", { className: "tools-group" }, el("h3", { textContent: group }), ...tools.map(([name, href]) => item(name, href))))),
    all);
  menu.setAttribute("role", "menu");
  const open = (on) => {
    menu.hidden = !on;
    button.setAttribute("aria-expanded", String(on));
    if (!on) return;
    // Centré sous le bouton, puis ramené dans la fenêtre s'il en dépasse.
    menu.style.marginLeft = "0";
    const box = menu.getBoundingClientRect(), width = document.documentElement.clientWidth;
    menu.style.marginLeft = (box.right > width - 12 ? width - 12 - box.right : box.left < 12 ? 12 - box.left : 0) + "px";
  };
  button.onclick = () => open(menu.hidden);
  const root = el("div", { className: "tools" }, button, menu);
  root.addEventListener("keydown", (event) => { if (event.key === "Escape" && !menu.hidden) { open(false); button.focus(); } });
  document.addEventListener("click", (event) => { if (!root.contains(event.target)) open(false); });
  link.replaceWith(root);
})();
