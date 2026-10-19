// Le compte dans l'en-tête du site : une fois connecté, le lien marqué data-account devient un bouton (photo de
// profil et nom) qui déroule un menu : compte, paramètres, licences, téléchargement, support, déconnexion.
//
//   OniriqueAccount.avatar(user)   →  l'adresse de sa photo, ou de l'avatar par défaut dessiné pour lui
//   OniriqueAccount.show(me)       →  (re)dessine le bouton pour ce compte ; null : remet le lien d'origine
//
// Le script lit lui-même le compte connecté (/api/me), puis l'annonce à la page par l'évènement « onirique:account ».
// Une page qui le lit déjà marque son lien data-account-manual et appelle show() elle-même.
(() => {
  const TOKEN = "onirique.token";
  // Arrivé par le lien d'un ami : son code de parrainage est gardé 30 jours, et proposé à l'inscription.
  try {
    const ref = new URLSearchParams(location.search).get("ref");
    if (ref && /^[A-Za-z0-9]{4,12}$/.test(ref)) localStorage.setItem("onirique.ref", JSON.stringify({ code: ref.toUpperCase(), at: Date.now() }));
  } catch { /* stockage fermé : le code reste dans l'adresse de la page compte */ }
  const token = () => { try { return sessionStorage.getItem(TOKEN) || localStorage.getItem(TOKEN); } catch { return null; } };
  const ROLES = { vip: "ONIRIQUE", abrasion: "Abrasion", relic: "Relic", admin: "Admin", founder: "Fondateur" };
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter((c) => c !== null && c !== undefined));
    return node;
  };

  // Avatar par défaut, à la charte : nuit et sang, halo de braise, réticule et étoile à quatre branches du logo.
  // Le réticule et les petites étoiles tournent selon le compte : deux comptes n'ont pas tout à fait le même.
  function defaultAvatar(user) {
    const seed = Number(user && user.id) || 0;
    const spark = (i) => {
      const a = (seed * 47 + i * 137) % 360 * Math.PI / 180, r = 27 + (seed * 7 + i * 5) % 9, s = 2.2 + (seed + i) % 3 * 0.7;
      const x = 48 + Math.cos(a) * r, y = 48 + Math.sin(a) * r;
      return `<path d="M${x} ${y - s}L${x + s * 0.2} ${y - s * 0.2}L${x + s} ${y}L${x + s * 0.2} ${y + s * 0.2}L${x} ${y + s}L${x - s * 0.2} ${y + s * 0.2}L${x - s} ${y}L${x - s * 0.2} ${y - s * 0.2}Z" fill="#ffd2d6" opacity=".8"/>`;
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<defs>
<radialGradient id="n" cx="50%" cy="12%" r="100%"><stop offset="0" stop-color="#9a0a1a"/><stop offset=".42" stop-color="#3a0509"/><stop offset="1" stop-color="#0d0809"/></radialGradient>
<radialGradient id="h" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ff5a68" stop-opacity=".9"/><stop offset=".55" stop-color="#e23444" stop-opacity=".35"/><stop offset="1" stop-color="#e23444" stop-opacity="0"/></radialGradient>
</defs>
<rect width="96" height="96" fill="url(#n)"/>
<circle cx="48" cy="48" r="34" fill="url(#h)"/>
<g fill="none" stroke="#ffd2d6" transform="rotate(${seed * 53 % 360} 48 48)">
<circle cx="48" cy="48" r="35" stroke-opacity=".34" stroke-width="1" stroke-dasharray="46 10 14 10 30 13"/>
<circle cx="48" cy="48" r="42" stroke-opacity=".2" stroke-width=".8" stroke-dasharray="1.5 6"/>
</g>
<path d="M48 16L51.6 44.4L80 48L51.6 51.6L48 80L44.4 51.6L16 48L44.4 44.4Z" fill="#e23444" opacity=".55" transform="translate(48 48) scale(1.28) translate(-48 -48)"/>
<path d="M48 16L51.6 44.4L80 48L51.6 51.6L48 80L44.4 51.6L16 48L44.4 44.4Z" fill="#f6eeee"/>
${spark(1)}${spark(2)}${spark(3)}
</svg>`;
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }
  const avatar = (user) => (user && user.avatar) || defaultAvatar(user);

  const style = el("style", { textContent: `
.acct { position: relative; display: inline-block; }
.acct-button { display: inline-flex; align-items: center; gap: 10px; max-width: 240px; padding: 5px 14px 5px 5px; border-radius: 999px; border: 1px solid var(--line, rgba(255,210,214,.16)); background: rgba(255,255,255,.03); color: var(--mist, #f6eeee); font: 600 14px/1 var(--f-body, system-ui, sans-serif); cursor: pointer; }
.acct-button:hover, .acct-button[aria-expanded="true"] { border-color: var(--ember, #e23444); }
.acct-button img, .acct-head img { flex: none; border-radius: 50%; object-fit: cover; background: #1a080a; }
.acct-button img { width: 30px; height: 30px; }
.acct-button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acct-button svg { flex: none; width: 10px; height: 10px; transition: transform .15s; }
.acct-button[aria-expanded="true"] svg { transform: rotate(180deg); }
.acct-menu { position: absolute; right: 0; top: calc(100% + 10px); z-index: 80; width: min(290px, calc(100vw - 24px)); padding: 8px; border-radius: 18px; border: 1px solid var(--line, rgba(255,210,214,.16)); background: linear-gradient(180deg, var(--deep-2, #2a0a0e), var(--deep, #1a080a)); box-shadow: 0 24px 60px -12px rgba(0,0,0,.85), 0 0 0 1px rgba(226,52,68,.12); text-align: left; }
.acct-head { display: flex; align-items: center; gap: 12px; padding: 10px 10px 14px; margin-bottom: 6px; border-bottom: 1px solid var(--line, rgba(255,210,214,.16)); }
.acct-head img { width: 46px; height: 46px; }
.acct-head div { min-width: 0; display: grid; gap: 5px; }
.acct-head strong { font: 700 15px/1.2 var(--f-body, system-ui, sans-serif); color: var(--mist, #f6eeee); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acct-head small { font: 500 11px/1.2 var(--f-mono, ui-monospace, monospace); color: var(--haze, #a88f92); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acct-head em { justify-self: start; font: 500 10px/1 var(--f-mono, ui-monospace, monospace); font-style: normal; letter-spacing: .12em; text-transform: uppercase; padding: 5px 8px; border-radius: 999px; color: var(--bone, #ffecee); border: 1px solid rgba(226,52,68,.6); background: rgba(226,52,68,.16); }
.acct-menu a, .acct-menu button { display: block; width: 100%; padding: 11px 12px; border: 0; border-radius: 10px; background: none; color: var(--mist, #f6eeee); font: 500 14px/1.2 var(--f-body, system-ui, sans-serif); text-align: left; text-decoration: none; cursor: pointer; }
.acct-menu a:hover, .acct-menu button:hover, .acct-menu a:focus-visible, .acct-menu button:focus-visible { background: rgba(226,52,68,.16); color: var(--mist, #f6eeee); outline: none; }
.acct-menu hr { margin: 6px 4px; border: 0; border-top: 1px solid var(--line, rgba(255,210,214,.16)); }
.acct-menu h6 { margin: 0; padding: 8px 12px 4px; font: 500 10px/1 var(--f-mono, ui-monospace, monospace); letter-spacing: .14em; text-transform: uppercase; color: var(--haze, #a88f92); }
.acct-menu .acct-out { color: #ff8f99; }
/* Téléphone : le menu prend la largeur de l'écran sous l'en-tête, au lieu de déborder à gauche du bouton. */
@media (max-width: 560px) { .acct-menu { position: fixed; left: 12px; right: 12px; width: auto; max-height: calc(100vh - var(--acct-top, 80px) - 12px); overflow-y: auto; overscroll-behavior: contain; top: var(--acct-top, 80px); } }
` });

  let slot = document.querySelector("[data-account]"); // l'élément d'origine, puis le bouton qui le remplace
  const original = slot;

  function show(me) {
    if (!slot) return;
    if (!me || !me.user) {
      if (slot !== original) { slot.replaceWith(original); slot = original; }
      return;
    }
    const user = me.user, name = user.name || user.email.split("@")[0];
    const button = el("button", { className: "acct-button", type: "button", title: "Mon compte" },
      el("img", { src: avatar(user), alt: "" }), el("span", { textContent: name }));
    button.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");

    const item = (text, href, props = {}) => { const a = el("a", { href, textContent: text, ...props }); a.setAttribute("role", "menuitem"); return a; };
    const out = el("button", { className: "acct-out", type: "button", textContent: "Se déconnecter" });
    out.setAttribute("role", "menuitem");
    out.onclick = async () => {
      await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + token() } }).catch(() => {});
      try { sessionStorage.removeItem(TOKEN); localStorage.removeItem(TOKEN); } catch {}
      // Une page réservée renvoie au compte ; les autres se rechargent simplement, déconnectées.
      if (/admin/.test(location.pathname)) location.href = "compte.html"; else location.reload();
    };
    const download = item("Télécharger l'application", "/#telechargement"); // le choix entre Windows et Mac
    const menu = el("div", { className: "acct-menu", hidden: true },
      el("div", { className: "acct-head" }, el("img", { src: avatar(user), alt: "" }),
        el("div", {}, el("strong", { textContent: name }), el("small", { textContent: user.email }), ROLES[user.role] ? el("em", { textContent: ROLES[user.role] }) : null)),
      item("Mon compte", "compte.html"),
      item("Paramètres", "compte.html#parametres"),
      item("Mes licences", "compte.html#licences"),
      item("Parrainage", "compte.html#parrainage"),
      el("hr"),
      item("Boutique", "boutique.html"),
      download,
      item("Support", "support.html"),
      ROLES[user.role] && user.role !== "vip" ? item("Administration", "admin.html") : null,
      // Réservé aux fondateurs : les Shorts YouTube programmés, sur la page compte.
      ...(user.role === "founder" ? [el("hr"), el("h6", { textContent: "Fondateurs" }), item("Shorts YouTube", "compte.html#youtube")] : []),
      el("hr"),
      out);
    menu.setAttribute("role", "menu");

    const open = (on) => {
      menu.hidden = !on;
      button.setAttribute("aria-expanded", String(on));
      if (on) menu.style.setProperty("--acct-top", Math.round(button.getBoundingClientRect().bottom + 10) + "px");
    };
    button.onclick = () => open(menu.hidden);
    const root = el("div", { className: "acct" }, button, menu);
    root.addEventListener("keydown", (event) => { if (event.key === "Escape" && !menu.hidden) { open(false); button.focus(); } });
    document.addEventListener("click", (event) => { if (!root.contains(event.target)) open(false); });
    menu.addEventListener("click", (event) => { if (event.target.closest("a")) open(false); });

    if (!style.isConnected) document.head.append(style);
    slot.replaceWith(root);
    slot = root;
  }

  window.OniriqueAccount = { avatar, show };

  if (!slot || slot.hasAttribute("data-account-manual") || !token()) return;
  fetch("/api/me", { headers: { Authorization: "Bearer " + token() } })
    .then((response) => (response.ok ? response.json() : null))
    .then((me) => {
      if (!me || !me.user) return;
      show(me);
      document.dispatchEvent(new CustomEvent("onirique:account", { detail: me }));
    })
    .catch(() => {});
})();
