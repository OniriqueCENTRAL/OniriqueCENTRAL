// Spotify, Deezer et Apple Music dans les playlists d'ONIRIQUE CLOUD (mes-sons.html) : les comptes liés, la recherche,
// les liens collés (titre, album ou playlist entière), et les titres des plateformes mêlés aux sons du CLOUD.
// Le serveur (server/src/platforms.js) relaie l'extrait officiel de 30 s de chaque titre ; l'écoute entière se fait
// sur la plateforme.
//
//   OniriquePlatforms.setup({ api, el, icon, player, changed })   api(method, path, body) → Promise ; changed() redessine
//   OniriquePlatforms.load() → Promise                            les comptes liés et les titres de toutes les playlists
//   OniriquePlatforms.mixed(p) → [{ key, track } | { key, item }] la playlist p dans son ordre (sons du CLOUD et titres)
//   OniriquePlatforms.playerItem(item)                            ce que joue le lecteur pour un titre de plateforme
//   OniriquePlatforms.row(p, item, i, onPlay)                     la ligne d'un titre de plateforme dans la playlist
//   OniriquePlatforms.order(p, keys) → Promise                    le nouvel ordre (["t12", "x5", …])
//   OniriquePlatforms.openAdd(p)                                  la fenêtre « Ajouter depuis Spotify, Deezer, Apple Music »
//   OniriquePlatforms.openAccounts()                              la même fenêtre, sur les comptes liés
(() => {
  const NAMES = { spotify: "Spotify", deezer: "Deezer", apple: "Apple Music" };
  const PROFILE_HINT = {
    deezer: "Lien de ton profil Deezer (deezer.com/fr/profile/…) : tes playlists publiques s'affichent ici.",
    spotify: "Lien de ton profil Spotify (open.spotify.com/user/…). Spotify ne publie pas la liste de tes playlists : colle le lien de celle à importer.",
    apple: "Lien de ton profil Apple Music (music.apple.com/profile/…). Pour importer une playlist, colle son lien.",
  };
  let ctx = null;
  let state = { accounts: [], items: [], positions: {} };
  const time = (s) => (s ? Math.floor(s / 60) + ":" + String(Math.round(s) % 60).padStart(2, "0") : "");

  const style = document.createElement("style");
  style.textContent = `
#platform-add { width: min(760px, calc(100vw - 24px)); }
#platform-add .pf-body { display: grid; gap: 14px; padding: 16px 18px 18px; }
#platform-add .pf-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: 14px; border: 1px solid var(--line); }
#platform-add .pf-tabs button { flex: 1 1 auto; padding: 10px 12px; border: 0; border-radius: 10px; background: none; color: var(--haze); font: 500 12px/1 var(--f-mono); letter-spacing: .08em; text-transform: uppercase; cursor: pointer; }
#platform-add .pf-tabs button[aria-selected="true"] { background: var(--ember); color: #fff; }
#platform-add form { display: flex; gap: 8px; }
#platform-add input { flex: 1; min-width: 0; height: 44px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line); background: rgba(0,0,0,.4); color: var(--mist); font: 500 15px var(--f-body); }
#platform-add .pf-list { max-height: 52vh; overflow-y: auto; }
#platform-add .pf-note { margin: 0; color: var(--haze); font-size: 13px; line-height: 1.5; }
#platform-add .pf-acc { display: grid; gap: 8px; padding: 14px 16px; }
#platform-add .pf-acc-head { display: flex; align-items: center; gap: 10px; }
#platform-add .pf-acc-head b { flex: 1; font: 700 15px var(--f-display); }
.pf-tag { flex: none; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); font: 600 10.5px/1.5 var(--f-mono); letter-spacing: .06em; color: var(--haze); white-space: nowrap; }
.trk.pf .pf-link { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 10px; color: var(--haze); }
.trk.pf .pf-link:hover { color: var(--mist); background: rgba(255,255,255,.06); }
.trk.pf .pf-cover { width: 34px; height: 34px; border-radius: 8px; object-fit: cover; }
`;
  document.head.append(style);

  function setup(options) { ctx = options; }
  async function load() {
    try { state = await ctx.api("GET", "/me/platforms"); } catch { state = { accounts: [], items: [], positions: {} }; }
    return state;
  }
  const itemsOf = (pid) => state.items.filter((x) => x.projectId === pid);
  /** La playlist dans son ordre : les sons du CLOUD (à leur place) et les titres des plateformes. */
  function mixed(p) {
    const tracks = p.tracks.map((t, i) => ({ key: "t" + t.id, track: t, at: state.positions[t.id] ?? i, rank: 0 }));
    const items = itemsOf(p.id).map((x) => ({ key: "x" + x.id, item: x, at: x.position, rank: 1 }));
    return [...tracks, ...items].sort((a, b) => a.at - b.at || a.rank - b.rank);
  }
  const playerItem = (x) => ({ key: "x" + x.id, id: null, trackId: null, title: x.title, artist: x.artist,
    subtitle: [x.artist, NAMES[x.platform] + " · extrait 30 s"].filter(Boolean).join(" · "), cover: x.cover, url: x.listen,
    duration: 30, peaks: [], comments: [], lyrics: "" });

  function row(p, x, i, onPlay) {
    const { el, icon } = ctx;
    const remove = el("button", { className: "dots", type: "button", ariaLabel: "Retirer " + x.title + " de la playlist", title: "Retirer de la playlist" }, icon("close"));
    remove.onclick = (event) => {
      event.stopPropagation();
      ctx.api("DELETE", "/me/sounds/platform-items/" + x.id).then(load).then(ctx.changed, (error) => alert(error.message));
    };
    // Le titre entier, sur sa plateforme (dans l'application ONIRIQUE CENTRAL : le navigateur ou l'application de la plateforme).
    const open = el("a", { className: "pf-link", href: x.url, target: "_blank", rel: "noopener", ariaLabel: "Écouter en entier sur " + NAMES[x.platform],
      title: "Écouter en entier sur " + NAMES[x.platform], onclick: (event) => event.stopPropagation() }, icon("link"));
    const li = el("li", { className: "trk pf", tabIndex: 0, title: "Écouter l'extrait de 30 s" },
      el("span", { className: "num", textContent: String(i + 1) }),
      el("div", {}, el("div", { className: "tline" }, el("b", { textContent: x.title })),
        el("small", { textContent: [x.artist, "extrait 30 s"].filter(Boolean).join(" · ") })),
      el("span", { className: "badges" }, el("span", { className: "pf-tag", textContent: NAMES[x.platform] })),
      el("span", { className: "len", textContent: time(x.duration) }),
      el("span", { style: "display:flex;gap:2px" }, open, remove));
    li.dataset.key = "x" + x.id;
    li.onclick = onPlay;
    li.onkeydown = (event) => { if (event.key === "Enter") onPlay(); };
    return li;
  }
  const order = (p, keys) => ctx.api("PUT", "/me/sounds/projects/" + p.id + "/mixed-order", { keys }).then(load);

  //---------------------------------------------------------------------------- La fenêtre d'ajout
  let dialog = null, target = null, tab = "deezer", results = [], found = null, query = "", busy = false, error = "", added = new Set(), deezerLists = null;
  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "platform-add";
    dialog.addEventListener("close", () => { if (ctx.player.item && /^x?pv/.test(ctx.player.item.key) && ctx.player.playing) ctx.player.toggle(); });
    document.body.append(dialog);
    return dialog;
  }
  function openAdd(p) { target = p; added = new Set(itemsOf(p.id).map((x) => x.platform + ":" + x.extId)); error = ""; draw(); if (!dialog.open) dialog.showModal(); }
  function openAccounts() { tab = "accounts"; target = null; error = ""; draw(); if (!dialog.open) dialog.showModal(); loadDeezerLists(); }

  async function add(items) {
    if (!target) return;
    busy = true; draw();
    try {
      await ctx.api("POST", "/me/sounds/projects/" + target.id + "/platform-items", { items });
      for (const x of items) added.add(x.platform + ":" + x.id);
      await load(); ctx.changed();
    } catch (e) { error = e.message; }
    busy = false; draw();
  }
  async function search(source, q) {
    busy = true; error = ""; results = []; draw();
    try { results = await ctx.api("GET", "/platforms/search?source=" + source + "&q=" + encodeURIComponent(q)); } catch (e) { error = e.message; }
    busy = false; draw();
  }
  async function resolve(url) {
    busy = true; error = ""; found = null; draw();
    try { found = await ctx.api("POST", "/platforms/resolve", { url }); } catch (e) { error = e.message; }
    busy = false; draw();
  }
  async function loadDeezerLists() {
    deezerLists = null;
    if (!state.accounts.some((a) => a.platform === "deezer")) return;
    try { deezerLists = await ctx.api("GET", "/me/platforms/deezer/playlists"); } catch (e) { deezerLists = []; error = e.message; }
    draw();
  }

  // Un résultat : écouter l'extrait (un clic le lance, un second le met en pause), puis l'ajouter.
  function resultRow(x) {
    const { el, icon, player } = ctx;
    const key = "pv" + x.platform + x.id, on = player.playing && player.item && player.item.key === key, inside = added.has(x.platform + ":" + x.id);
    const listen = el("button", { className: "pick-art" + (on ? " on" : ""), type: "button", disabled: !x.listen, ariaLabel: (on ? "Pause : " : "Écouter ") + x.title,
      onclick: () => { if (player.item && player.item.key === key) player.toggle(); else player.play([{ ...playerItem({ ...x, id: x.id }), key }], 0); setTimeout(draw, 300); } },
      x.cover ? el("img", { src: x.cover, alt: "" }) : el("span", { className: "cover-ph" }), el("i", {}, icon(on ? "pause" : "play")));
    return el("li", {}, el("div", { className: "item" }, listen,
      el("span", { className: "grow pick-name" }, el("b", { className: "tline", textContent: x.title }), el("small", { textContent: [x.artist, time(x.duration)].filter(Boolean).join(" · ") })),
      el("span", { className: "pf-tag", textContent: NAMES[x.platform] }),
      target ? el("button", { className: inside ? "btn btn-ghost" : "btn btn-primary", type: "button", disabled: inside || busy, textContent: inside ? "Ajouté" : "Ajouter",
        onclick: () => add([x]) }) : ""));
  }

  function accountsPanel() {
    const { el } = ctx;
    return el("div", { className: "stack" }, ...["deezer", "spotify", "apple"].map((platform) => {
      const a = state.accounts.find((x) => x.platform === platform);
      const input = el("input", { type: "url", placeholder: NAMES[platform] + " : lien de ton profil", autocomplete: "off" });
      const form = el("form", { onsubmit: async (event) => {
        event.preventDefault();
        busy = true; error = ""; draw();
        try { await ctx.api("PUT", "/me/platforms/" + platform, { url: input.value }); await load(); if (platform === "deezer") await loadDeezerLists(); } catch (e) { error = e.message; }
        busy = false; draw();
      } }, input, el("button", { className: "btn btn-primary", type: "submit", disabled: busy, textContent: "Lier" }));
      const box = el("div", { className: "group pf-acc" },
        el("div", { className: "pf-acc-head" }, el("b", { textContent: NAMES[platform] }),
          a ? el("a", { className: "btn btn-ghost", href: a.url, target: "_blank", rel: "noopener", textContent: a.name }) : el("span", { className: "pf-tag", textContent: "Non lié" }),
          a ? el("button", { className: "btn btn-ghost", type: "button", textContent: "Délier", onclick: async () => {
            await ctx.api("DELETE", "/me/platforms/" + platform).catch((e) => { error = e.message; });
            await load(); if (platform === "deezer") deezerLists = null; draw();
          } }) : ""),
        a ? "" : form, el("p", { className: "pf-note", textContent: PROFILE_HINT[platform] }));
      // Les playlists publiques du compte Deezer lié : un clic les ouvre, prêtes à importer.
      if (platform === "deezer" && a) {
        box.append(deezerLists === null ? el("p", { className: "pf-note", textContent: "Chargement de tes playlists…" })
          : deezerLists.length ? el("ul", { className: "group pf-list" }, ...deezerLists.map((l) => el("li", {}, el("button", { className: "item", type: "button",
            onclick: () => { tab = "link"; query = l.url; resolve(l.url); } },
            l.cover ? el("img", { src: l.cover, alt: "", style: "width:40px;height:40px;border-radius:8px;object-fit:cover" }) : el("span", { className: "cover-ph" }),
            el("span", { className: "grow pick-name" }, el("b", { textContent: l.title }), el("small", { textContent: l.count + " titres" })),
            el("span", { className: "pf-tag", textContent: target ? "Importer" : "Ouvrir" })))))
            : el("p", { className: "pf-note", textContent: "Aucune playlist publique sur ce profil Deezer." }));
      }
      return box;
    }));
  }

  function draw() {
    const { el, icon } = ctx;
    ensureDialog();
    const tabs = [["deezer", "Deezer"], ["apple", "Apple Music"], ["link", "Coller un lien"], ["accounts", "Mes comptes"]];
    const tabBar = el("div", { className: "pf-tabs", role: "tablist" }, ...tabs.map(([id, label]) => el("button", { type: "button", role: "tab", ariaSelected: String(tab === id),
      onclick: () => { tab = id; results = []; error = ""; if (id === "accounts") loadDeezerLists(); draw(); } }, label)));
    let body;
    if (tab === "accounts") body = accountsPanel();
    else if (tab === "link") {
      const input = el("input", { type: "url", placeholder: "Lien Spotify, Deezer ou Apple Music : titre, album ou playlist", value: query, autocomplete: "off" });
      const all = found ? found.items.filter((x) => !added.has(x.platform + ":" + x.id)) : [];
      body = el("div", { className: "stack" },
        el("form", { onsubmit: (event) => { event.preventDefault(); query = input.value.trim(); if (query) resolve(query); } }, input,
          el("button", { className: "btn btn-primary", type: "submit", disabled: busy, textContent: "Lire" })),
        found ? el("div", { className: "stack" },
          el("div", { className: "item", style: "padding:0;cursor:default" },
            found.cover ? el("img", { src: found.cover, alt: "", style: "width:48px;height:48px;border-radius:10px;object-fit:cover" }) : "",
            el("span", { className: "grow pick-name" }, el("b", { textContent: found.title }),
              el("small", { textContent: NAMES[found.platform] + " · " + found.items.length + " titre" + (found.items.length > 1 ? "s" : "") })),
            target && found.items.length > 1 ? el("button", { className: "btn btn-primary", type: "button", disabled: busy || !all.length,
              textContent: all.length ? "Tout ajouter (" + all.length + ")" : "Tout est ajouté", onclick: () => add(all) }) : ""),
          found.total && found.total > found.items.length ? el("p", { className: "pf-note",
            textContent: "Spotify ne montre que les " + found.items.length + " premiers titres d'une playlist (elle en compte " + found.total + "). Pour les autres, colle leur lien un par un." }) : "",
          el("ul", { className: "group pf-list" }, ...found.items.map(resultRow)))
          : el("p", { className: "pf-note", textContent: "Un titre, un album ou une playlist publique. Ils s'ajoutent à la suite de la playlist, mêlés à tes sons du CLOUD." }));
    } else {
      const input = el("input", { type: "search", placeholder: "Chercher sur " + NAMES[tab] + " : titre, artiste", value: query, autocomplete: "off" });
      body = el("div", { className: "stack" },
        el("form", { onsubmit: (event) => { event.preventDefault(); query = input.value.trim(); if (query.length > 1) search(tab, query); } }, input,
          el("button", { className: "btn btn-primary", type: "submit", disabled: busy, textContent: "Chercher" })),
        results.length ? el("ul", { className: "group pf-list" }, ...results.map(resultRow))
          : el("p", { className: "pf-note", textContent: busy ? "Recherche…" : "Pour Spotify, colle le lien du titre ou de la playlist dans « Coller un lien » : Spotify ne se laisse pas chercher depuis ici." }));
    }
    dialog.replaceChildren(
      el("div", { className: "dlg-head" }, el("b", { textContent: target ? "Ajouter à « " + target.title + " »" : "Spotify, Deezer et Apple Music" }),
        el("button", { className: "x", type: "button", ariaLabel: "Fermer", onclick: () => dialog.close() }, icon("close"))),
      el("div", { className: "pf-body" }, tabBar, body,
        error ? el("p", { className: "error", textContent: error }) : "",
        el("p", { className: "pf-note", textContent: "Les titres des plateformes s'écoutent ici en extrait de 30 s ; en entier, sur leur plateforme." })));
    const box = dialog.querySelector("input");
    if (box && document.activeElement !== box && tab !== "accounts") setTimeout(() => box.focus(), 0);
  }

  window.OniriquePlatforms = { NAMES, setup, load, itemsOf, mixed, playerItem, row, order, openAdd, openAccounts };
})();
