// Le menu « Outils » de l'en-tête : le lien marqué data-tools devient un bouton qui déroule la liste des outils.
// Sans ce script, le lien mène simplement au premier outil. Ajouter un outil : une ligne dans TOOLS.
(() => {
  const TOOLS = [
    ["Popularité", "popularite.html", "Score de popularité Spotify"],
    ["BPM et tonalité", "bpm-tonalite.html", "Tempo et tonalité d'un morceau"],
  ];
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
.tools-menu { position: absolute; left: 50%; top: calc(100% + 12px); z-index: 80; width: max-content; min-width: 230px; max-width: calc(100vw - 24px); translate: -50% 0; padding: 8px; border-radius: 18px; border: 1px solid var(--line, rgba(255,210,214,.16)); background: linear-gradient(180deg, var(--deep-2, #2a0a0e), var(--deep, #1a080a)); box-shadow: 0 24px 60px -12px rgba(0,0,0,.8); }
.tools-menu a { display: grid; gap: 4px; padding: 11px 12px; border-radius: 10px; color: var(--mist, #f6eeee); font: 600 14px/1.2 var(--f-body, system-ui, sans-serif); text-align: left; text-decoration: none; }
.tools-menu a small { color: var(--haze, #b9a2a5); font: 400 13px/1.3 var(--f-body, system-ui, sans-serif); }
.tools-menu a:hover, .tools-menu a:focus-visible, .tools-menu a[aria-current="page"] { background: rgba(226,52,68,.16); color: var(--mist, #f6eeee); outline: none; }
` }));

  const page = location.pathname.split("/").pop().replace(/\.html$/, "");
  const here = (href) => href.replace(/\.html$/, "") === page;
  const button = el("button", { type: "button", className: (link.className + " tools-btn").trim(), textContent: "Outils" });
  if (TOOLS.some(([, href]) => here(href))) button.classList.add("here");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const menu = el("div", { className: "tools-menu", hidden: true }, ...TOOLS.map(([name, href, text]) => {
    const a = el("a", { href }, name, el("small", { textContent: text }));
    a.setAttribute("role", "menuitem");
    if (here(href)) a.setAttribute("aria-current", "page");
    return a;
  }));
  menu.setAttribute("role", "menu");
  const open = (on) => {
    menu.hidden = !on;
    button.setAttribute("aria-expanded", String(on));
  };
  button.onclick = () => open(menu.hidden);
  const root = el("div", { className: "tools" }, button, menu);
  root.addEventListener("keydown", (event) => { if (event.key === "Escape" && !menu.hidden) { open(false); button.focus(); } });
  document.addEventListener("click", (event) => { if (!root.contains(event.target)) open(false); });
  link.replaceWith(root);
})();
