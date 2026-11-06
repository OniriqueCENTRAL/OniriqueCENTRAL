// Les invitations d'un ami à une salle en direct (le HM, la WATCHPARTY) : un petit pop-up en bas de l'écran, « Refuser »
// ou « Rejoindre », même pendant une autre salle. Si la fenêtre n'est pas au premier plan (autre onglet, autre écran de
// l'application), une notification de l'ordinateur prévient aussi, sans jamais demander l'autorisation d'elle-même.
// Le serveur : mountInvites dans server/src/hm.js.
//
//   OniriqueInvites.watch({ base, title, says, join, current, avatar })
//     base : "/hm" ou "/watchparty" ; title : titre de la notification ; says(x) : la ligne « Kay t'invite au HM » ;
//     join(code) : rejoindre ; current() : le code de la salle où l'on est déjà (son invitation est marquée vue).
(() => {
  const TOKEN = "onirique.token";
  const token = () => { try { return sessionStorage.getItem(TOKEN) || localStorage.getItem(TOKEN); } catch { return null; } };
  const css = `
.hm-invite { position: fixed; right: 16px; bottom: 110px; z-index: 90; width: min(360px, calc(100vw - 32px)); display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px;
  padding: 12px 14px; border-radius: 18px; border: 1px solid rgba(var(--acc, 229,56,74),.55); background: #150a0c; color: var(--mist, #f6eeee);
  box-shadow: 0 20px 60px -20px rgba(0,0,0,.9), 0 0 40px -16px rgba(var(--acc, 229,56,74),.7); animation: hm-in .3s cubic-bezier(.2, .8, .2, 1); }
.hm-invite.out { opacity: 0; transform: translateY(10px); transition: opacity .25s, transform .25s; }
.hm-invite img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex: none; }
.hm-invite .grow { flex: 1; min-width: 0; }
.hm-invite b, .hm-invite small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hm-invite b { font: 700 14px var(--f-body, system-ui); }
.hm-invite small { color: var(--haze, #a88f92); font-size: 12px; margin-top: 2px; }
.hm-invite-ctl { display: flex; gap: 8px; width: 100%; justify-content: flex-end; }
.hm-invite .hm-mini { border: 1px solid var(--line, rgba(255,235,238,.1)); background: none; color: var(--mist, #f6eeee); border-radius: 999px; padding: 7px 14px; font: 600 13px var(--f-body, system-ui); cursor: pointer; }
.hm-invite .hm-mini:hover { border-color: rgb(var(--acc, 229,56,74)); }
.hm-invite .hm-mini.yes { background: var(--mist, #f6eeee); color: var(--night, #09080a); border-color: var(--mist, #f6eeee); }
@keyframes hm-in { from { opacity: 0; transform: translateY(14px); } }
@media (prefers-reduced-motion: reduce) { .hm-invite { animation: none; } }
`;
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null)); return n; };
  const call = (method, path) => fetch("/api" + path, { method, headers: { Authorization: "Bearer " + token() } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  let pop = null, styled = false;

  function watch({ base, title, says, join, current = () => null, avatar = (p) => p.avatar || "assets/favicon.png?v=2" }) {
    if (!token()) return;
    if (window.oniriqueApp && window.oniriqueApp.nativeInvites) return; // l'application ONIRIQUE CENTRAL les montre elle-même, partout
    if (!styled) { styled = true; document.head.append(el("style", { textContent: css })); }
    const shown = new Set();
    let off = false; // le compte n'y a pas accès (403) : plus de demandes
    const seen = (x) => call("POST", base + "/invites/" + x.id + "/seen").catch(() => {});
    function show(x) {
      const close = () => { if (pop === box) pop = null; box.classList.add("out"); setTimeout(() => box.remove(), 250); };
      if (pop) pop.remove();
      const box = pop = el("div", { className: "hm-invite", role: "alertdialog", ariaLabel: title },
        el("img", { src: avatar(x.from), alt: "" }),
        el("div", { className: "grow" }, el("b", { textContent: says(x) }), el("small", { textContent: "« " + x.name + " »" })),
        el("div", { className: "hm-invite-ctl" },
          el("button", { className: "hm-mini", type: "button", textContent: "Refuser", onclick: () => { seen(x); close(); } }),
          el("button", { className: "hm-mini yes", type: "button", textContent: "Rejoindre", onclick: () => { seen(x); close(); join(x.code); } })));
      document.body.append(box);
      if (!document.hasFocus() && "Notification" in window && Notification.permission === "granted") {
        try {
          const n = new Notification(title, { body: says(x) + " : « " + x.name + " »", icon: "assets/app-icon-192.png", tag: base + x.id });
          n.onclick = () => { window.focus(); n.close(); };
        } catch { /* le navigateur ne montre les notifications que par sw.js : le pop-up suffit */ }
      }
    }
    async function check() {
      if (off || !token() || document.visibilityState === "hidden" && !window.oniriqueApp) return;
      const list = await call("GET", base + "/invites").catch((status) => { if (status === 403) off = true; return []; });
      for (const x of list.reverse()) {
        if (shown.has(x.id)) continue;
        shown.add(x.id);
        if (x.code === current()) { seen(x); continue; } // déjà dedans
        show(x);
      }
    }
    setTimeout(check, 2000);
    setInterval(check, 15000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  }

  window.OniriqueInvites = { watch };
})();
