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
  const ROLES = { vip: "ONIRIQUE", beta: "Beta-Testeur", betaf: "Beta-Testeuse", abrasion: "Abrasion", relic: "Relic", admin: "Admin", founder: "Fondateur" };
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
.acct-button { display: inline-flex; align-items: center; gap: 10px; max-width: 240px; padding: 5px 14px 5px 5px; border-radius: 14px; border: 0; background: rgba(255,255,255,.04); box-shadow: 0 0 0 1px rgba(255,255,255,.10) inset; color: var(--mist, #f4ecec); font: 500 11px/1 var(--f-mono, ui-monospace, monospace); letter-spacing: .12em; text-transform: uppercase; cursor: pointer; transition: box-shadow .25s, background .25s, color .25s; }
.acct-button:hover, .acct-button[aria-expanded="true"] { color: #fff; background: rgba(255,255,255,.07); box-shadow: 0 0 0 1px rgba(var(--acc-hi, 255,142,154),.55) inset, 0 6px 22px rgba(var(--acc, 229,56,74),.25); }
.acct-button img, .acct-head img { flex: none; border-radius: 10px; object-fit: cover; background: #121012; }
.acct-button img { width: 30px; height: 30px; }
.acct-button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acct-button svg { flex: none; width: 10px; height: 10px; transition: transform .25s cubic-bezier(.2,.8,.2,1); }
.acct-button[aria-expanded="true"] svg { transform: rotate(180deg); }
.acct-menu { position: absolute; right: 0; top: calc(100% + 10px); z-index: 80; width: min(290px, calc(100vw - 24px)); padding: 8px; border-radius: 22px; border: 1px solid rgba(255,235,238,.12); background: linear-gradient(160deg, rgba(40,26,30,.94), rgba(16,12,14,.96) 45%, rgba(20,15,17,.96)); -webkit-backdrop-filter: blur(22px) saturate(140%); backdrop-filter: blur(22px) saturate(140%); box-shadow: inset 0 1px 0 rgba(255,255,255,.12), inset 0 -1px 0 rgba(0,0,0,.4), 0 24px 60px rgba(0,0,0,.6); text-align: left; transform-origin: top right; animation: acct-in .3s cubic-bezier(.2,.8,.2,1); }
@keyframes acct-in { from { opacity: 0; transform: translateY(-6px) scale(.97); } }
@media (prefers-reduced-motion: reduce) { .acct-menu { animation: none; } }
.acct-head { display: flex; align-items: center; gap: 12px; padding: 10px 10px 14px; margin-bottom: 6px; border-bottom: 1px solid rgba(255,235,238,.08); }
.acct-head img { width: 46px; height: 46px; border-radius: 14px; }
.acct-head div { min-width: 0; display: grid; gap: 5px; }
.acct-head strong { font: 800 13px/1.2 var(--f-display, system-ui, sans-serif); letter-spacing: .03em; color: var(--mist, #f4ecec); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acct-head small { font: 500 11px/1.2 var(--f-mono, ui-monospace, monospace); color: var(--haze, #a8939a); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acct-head em { justify-self: start; font: 500 9px/1 var(--f-mono, ui-monospace, monospace); font-style: normal; letter-spacing: .12em; text-transform: uppercase; padding: 5px 8px; border-radius: 8px; color: #fff; background: linear-gradient(180deg, rgba(var(--acc, 229,56,74),.45), rgba(var(--acc-lo, 122,13,28),.45)); box-shadow: 0 0 0 1px rgba(var(--acc-hi, 255,142,154),.5) inset; }
.acct-menu a, .acct-menu button { display: block; width: 100%; padding: 10px 12px; border: 0; border-radius: 10px; background: none; color: #d8c6c8; font: 500 14px/1.2 var(--f-body, system-ui, sans-serif); text-align: left; text-decoration: none; cursor: pointer; transition: background .2s, color .2s; }
.acct-menu a:hover, .acct-menu button:hover, .acct-menu a:focus-visible, .acct-menu button:focus-visible { background: rgba(255,255,255,.06); color: #fff; outline: none; box-shadow: 0 0 0 1px rgba(var(--acc-hi, 255,142,154),.3) inset; }
.acct-count { float: right; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: rgb(var(--acc, 229,56,74)); color: #fff; font: 700 11px/20px var(--f-mono, ui-monospace, monospace); font-style: normal; text-align: center; box-shadow: 0 0 10px rgba(var(--acc, 229,56,74),.6); }
.acct-button { position: relative; }
.acct-dot { position: absolute; top: 2px; left: 30px; width: 10px; height: 10px; border-radius: 50%; background: rgb(var(--acc, 229,56,74)); border: 2px solid var(--night, #09080a); box-shadow: 0 0 10px rgb(var(--acc, 229,56,74)); }
.acct-menu hr { margin: 6px 4px; border: 0; border-top: 1px solid rgba(255,235,238,.08); }
.acct-head + hr { display: none; }
.acct-menu h6 { margin: 0; padding: 8px 12px 4px; font: 500 10px/1 var(--f-mono, ui-monospace, monospace); letter-spacing: .12em; text-transform: uppercase; color: var(--haze, #a8939a); }
.acct-menu .acct-out { color: rgb(var(--acc-hi, 255,142,154)); }
/* Téléphone : le menu prend la largeur de l'écran sous l'en-tête, au lieu de déborder à gauche du bouton. */
@media (max-width: 560px) { .acct-menu { position: fixed; left: 12px; right: 12px; width: auto; max-height: calc(100vh - var(--acct-top, 80px) - 12px); overflow-y: auto; overscroll-behavior: contain; top: var(--acct-top, 80px); } }
` });

  let slot = document.querySelector("[data-account]"); // l'élément d'origine, puis le bouton qui le remplace
  const original = slot;

  function show(me) {
    // La couleur choisie sur le compte (Paramètres) ; sans compte, la braise.
    if (window.OniriqueAccent) window.OniriqueAccent.set((me && me.user && me.user.accent) || "");
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

    // Les pages du site depuis la racine : le menu sert aussi sous /abrasion/, où « compte » deviendrait /abrasion/compte.
    const page = (href) => (/^(\/|https?:|#)/.test(href) ? href : "/" + href);
    const item = (text, href, props = {}) => { const a = el("a", { href: page(href), textContent: text, ...props }); a.setAttribute("role", "menuitem"); return a; };
    const out = el("button", { className: "acct-out", type: "button", textContent: "Se déconnecter" });
    out.setAttribute("role", "menuitem");
    out.onclick = async () => {
      await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + token() } }).catch(() => {});
      try { sessionStorage.removeItem(TOKEN); localStorage.removeItem(TOKEN); } catch {}
      if (window.OniriqueAccent) window.OniriqueAccent.set(""); // déconnecté : la braise
      // Une page réservée renvoie au compte ; les autres se rechargent simplement, déconnectées.
      if (/admin/.test(location.pathname)) location.href = "/compte"; else location.reload();
    };
    const download = item("Télécharger l'application", "/#telechargement");
    // Page de profil et messages : ce qui attend (messages non lus, abonnés et commentaires nouveaux) en pastille.
    const profileItem = item("Ma page de profil", "profil"), messagesItem = item("Messages et activité", "messages");
    fetch("/api/me/inbox-count", { headers: { Authorization: "Bearer " + token() } }).then((r) => (r.ok ? r.json() : null)).then((n) => {
      if (!n) return;
      if (n.profile) profileItem.href = "/profil?u=" + encodeURIComponent(n.profile);
      const waiting = n.messages + n.notifications;
      if (!waiting) return;
      messagesItem.append(el("i", { className: "acct-count", textContent: String(waiting) }));
      button.append(el("i", { className: "acct-dot", title: waiting + " nouveauté" + (waiting > 1 ? "s" : "") }));
    }).catch(() => {}); // le choix entre Windows et Mac
    const menu = el("div", { className: "acct-menu", hidden: true },
      el("div", { className: "acct-head" }, el("img", { src: avatar(user), alt: "" }),
        el("div", {}, el("strong", { textContent: name }), el("small", { textContent: user.email }), ROLES[user.role] ? el("em", { textContent: ROLES[user.role] }) : null)),
      // Rangé par usage : le compte, la communauté, ses outils, ONIRIQUE, puis l'administration à part.
      ...(() => {
        const rights = me.rights || [];
        const group = (title, items) => { const list = items.filter(Boolean); return list.length ? [el("hr"), el("h6", { textContent: title }), ...list] : []; };
        return [
          ...group("Mon compte", [item("Mon compte", "compte"), item("Paramètres", "compte#parametres"), item("Mes licences", "compte#licences"), item("Parrainage", "compte#parrainage")]),
          ...group("Communauté", [messagesItem, profileItem, item("Carte des membres", "carte"),
            me.empire ? item("L'empire anto ment", "empire") : null, // fondateurs et invités : la page vient de l'API (server/src/empire.html)
            item("Tierlist", "tierlist"), // ouverte à tout compte connecté (server/src/tierlist.js)
            // Réservée aux membres ONIRIQUE, beta-testeurs, équipe et fondateurs (ONIRIQUE dans server/src/docs.js).
            ["vip", "beta", "betaf", "admin", "founder"].includes(user.role) ? item("WATCHPARTY", "watchparty") : null]),
          ...group("Outils", [item(rights.includes("sounds") ? "ONIRIQUE CLOUD" : "ONIRIQUE CLOUD · gratuit", "mes-sons"), // CLOUD gratuit pour tout compte (30 sons)
            rights.includes("links") && item("Mes liens", "mes-liens"),
            rights.includes("youtube") && item("Shorts YouTube", "compte#youtube")]),
          ...group("ONIRIQUE", [item("Boutique", "boutique"), download, item("Support", "support")]),
          ...(ROLES[user.role] && !["vip", "beta", "betaf"].includes(user.role) ? [el("hr"), item("Administration", "admin")] : []),
        ];
      })(),
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
