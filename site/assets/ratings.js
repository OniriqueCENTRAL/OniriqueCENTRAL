// Notes et ups d'ONIRIQUE CLOUD (mes-sons.html, ecoute.html) : la barre d'une playlist (étoiles, moyenne et nombre de
// notes, up du jour), le up d'un son, et le top 3 de la semaine. Le serveur : server/src/ratings.js.
//
//   OniriqueRatings.load({ playlists: [id], tracks: [id], token }) → Promise   les notes et ups de ce qu'affiche la page
//   OniriqueRatings.bar(id, token)           la barre d'une playlist
//   OniriqueRatings.up("track", id, token)   le petit bouton up d'un son
//   OniriqueRatings.top()                    le top 3 de la semaine, dépliant (null si personne n'a encore up)
(() => {
  const session = () => { try { return sessionStorage.getItem("onirique.token") || localStorage.getItem("onirique.token"); } catch { return null; } };
  async function api(method, path, body) {
    const r = await fetch("/api" + path, { method, headers: { Authorization: "Bearer " + session(), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Erreur " + r.status);
    return d;
  }
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null && k !== false)); return n; };
  const stats = { playlist: {}, track: {} };
  const blank = { avg: 0, count: 0, mine: 0, ups: 0, upped: false };

  const style = document.createElement("style");
  style.textContent = `
.rt-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin: 10px 0 4px; }
.rt-stars { display: inline-flex; gap: 2px; }
.rt-stars button { border: 0; background: none; padding: 2px; cursor: pointer; color: rgba(246,238,238,.25); font-size: 20px; line-height: 1; transition: color .15s, transform .15s; }
.rt-stars button.on { color: var(--ember, #E23444); }
.rt-stars button:hover { transform: scale(1.15); color: var(--ember, #E23444); }
.rt-detail { font: 500 12px var(--f-mono, monospace); color: var(--haze, #a88f92); letter-spacing: .04em; }
.rt-up { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line, rgba(255,210,214,.13));
  background: rgba(255,255,255,.04); color: var(--mist, #F6EEEE); font: 600 12px var(--f-mono, monospace); cursor: pointer; }
.rt-up:hover { border-color: var(--ember, #E23444); }
.rt-up.on { border-color: var(--ember, #E23444); color: var(--ember, #E23444); cursor: default; }
.rt-up.small { height: 26px; padding: 0 8px; font-size: 11px; }
.rt-top { margin: 18px 0 6px; border: 1px solid var(--line, rgba(255,210,214,.13)); border-radius: 18px; background: rgba(255,255,255,.03); }
.rt-top summary { cursor: pointer; list-style: none; padding: 14px 18px; font: 500 12px var(--f-mono, monospace); letter-spacing: .14em; text-transform: uppercase; color: var(--haze, #a88f92); display: flex; align-items: center; gap: 10px; }
.rt-top summary::-webkit-details-marker { display: none; }
.rt-top summary::after { content: "▾"; margin-left: auto; transition: transform .2s; }
.rt-top[open] summary::after { transform: rotate(180deg); }
.rt-top ol { list-style: none; margin: 0; padding: 0 10px 12px; display: grid; gap: 6px; }
.rt-top a { display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 12px; color: var(--mist, #F6EEEE); text-decoration: none; }
.rt-top a:hover { background: rgba(255,255,255,.05); }
.rt-top img, .rt-top .ph { width: 44px; height: 44px; border-radius: 9px; object-fit: cover; background: linear-gradient(135deg, #5C0008, #2A0A0E); flex: none; }
.rt-top .rank { width: 22px; text-align: center; font: 800 16px var(--f-display, sans-serif); color: var(--ember, #E23444); }
.rt-top b { display: block; font: 700 14px var(--f-body, sans-serif); }
.rt-top small { color: var(--haze, #a88f92); font-size: 12px; }
`;
  document.head.append(style);

  async function load({ playlists = [], tracks = [], token } = {}) {
    if (!session() || (!playlists.length && !tracks.length)) return;
    const q = new URLSearchParams({ playlists: playlists.join(","), tracks: tracks.join(",") });
    if (token) q.set("token", token);
    try {
      const r = await api("GET", "/me/sounds/ratings?" + q);
      Object.assign(stats.playlist, r.playlist); Object.assign(stats.track, r.track);
    } catch { /* hors CLOUD : pas de notes */ }
  }
  const visible = (kind, id) => !!stats[kind][id];

  function upButton(kind, id, token, small) {
    const s = () => stats[kind][id] || blank;
    const b = el("button", { type: "button", className: "rt-up" + (small ? " small" : "") });
    const draw = () => {
      b.classList.toggle("on", s().upped);
      b.textContent = "▲ " + s().ups;
      b.title = s().upped ? "Tu as déjà up aujourd'hui : reviens demain" : "Up (un par jour)";
    };
    b.onclick = async (event) => {
      event.stopPropagation();
      if (s().upped) return;
      try { stats[kind][id] = await api("POST", "/me/sounds/up", { kind, id, token }); draw(); } catch (e) { alert(e.message); }
    };
    draw();
    return b;
  }

  function bar(id, token) {
    if (!visible("playlist", id)) return null;
    const s = () => stats.playlist[id];
    const stars = el("span", { className: "rt-stars", role: "radiogroup", ariaLabel: "Ta note" });
    const detail = el("span", { className: "rt-detail" });
    const draw = () => {
      stars.replaceChildren(...[1, 2, 3, 4, 5].map((n) => el("button", { type: "button", className: n <= s().mine ? "on" : "", textContent: "★",
        title: s().mine === n ? "Retirer ta note" : n + " étoile" + (n > 1 ? "s" : ""), ariaLabel: n + " étoiles",
        onclick: async () => { try { stats.playlist[id] = await api("POST", "/me/sounds/rate", { kind: "playlist", id, stars: s().mine === n ? 0 : n, token }); draw(); } catch (e) { alert(e.message); } } })));
      detail.textContent = s().count ? s().avg.toLocaleString("fr-FR") + " / 5 · " + s().count + " note" + (s().count > 1 ? "s" : "") + (s().mine ? " · la tienne : " + s().mine : "") : "Pas encore de note";
    };
    draw();
    return el("div", { className: "rt-bar" }, stars, detail, upButton("playlist", id, token));
  }

  async function top() {
    if (!session()) return null;
    let list;
    try { list = await api("GET", "/me/sounds/top-week"); } catch { return null; }
    if (!list.length) return null;
    return el("details", { className: "rt-top" }, el("summary", {}, "Top 3 de la semaine"),
      el("ol", {}, ...list.map((x, i) => el("li", {}, el("a", { href: x.url },
        el("span", { className: "rank", textContent: String(i + 1) }),
        x.cover ? el("img", { src: x.cover + "?w=160", alt: "" }) : el("span", { className: "ph" }),
        el("span", {}, el("b", { textContent: x.title }), el("small", { textContent: x.owner + " · ▲ " + x.ups + (x.count ? " · " + x.avg.toLocaleString("fr-FR") + " ★" : "") })))))));
  }

  // « Découvrir » : quatre onglets de playlists publiques (top de la semaine, mieux notées, nouveautés, abonnements),
  // en cartes qui défilent ; l'onglet choisi et l'ouverture du bloc sont gardés d'une visite à l'autre.
  const KEY = "onirique.discover";
  const TABS = [["week", "Top de la semaine"], ["best", "Mieux notées"], ["fresh", "Nouveautés"], ["following", "Mes abonnements"]];
  const EMPTY = { week: "Personne n'a encore up de playlist cette semaine.", best: "Aucune playlist n'a encore deux notes.",
    fresh: "Pas encore de playlist partagée par les autres membres.", following: "Abonne-toi à des membres depuis leur page de profil : leurs playlists arriveront ici." };
  function card(x, rank) {
    return el("a", { className: "dc-card", href: x.url },
      x.cover ? el("img", { src: x.cover + "?w=320", alt: "", loading: "lazy" }) : el("span", { className: "dc-ph" }),
      rank ? el("span", { className: "dc-rank", textContent: String(rank) }) : null,
      el("b", { textContent: x.title }),
      el("small", {}, x.ownerHandle ? el("span", { className: "dc-owner", textContent: x.owner, onclick: (e) => { e.preventDefault(); e.stopPropagation(); location.href = "profil?u=" + encodeURIComponent(x.ownerHandle); } }) : x.owner,
        " · " + x.tracks + " son" + (x.tracks > 1 ? "s" : "")),
      el("small", { className: "dc-stats", textContent: (x.count ? "★ " + x.avg.toLocaleString("fr-FR") + " (" + x.count + ")" : "☆ pas de note") + "  ·  ▲ " + x.ups }));
  }
  async function discover() {
    if (!session()) return null;
    let d;
    try { d = await api("GET", "/me/sounds/discover"); } catch { return null; }
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
    const remember = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {} };
    let tab = TABS.some(([k]) => k === saved.tab) ? saved.tab : (d.week.length ? "week" : "fresh");
    const row = el("div", { className: "dc-row" }), tabs = el("div", { className: "dc-tabs", role: "tablist" });
    const draw = () => {
      tabs.replaceChildren(...TABS.map(([k, label]) => el("button", { type: "button", role: "tab", className: k === tab ? "on" : "", ariaSelected: String(k === tab),
        textContent: label + (d[k].length ? " · " + d[k].length : ""), onclick: () => { tab = k; saved.tab = k; remember(); draw(); } })));
      row.replaceChildren(...(d[tab].length ? d[tab].map((x, i) => card(x, tab === "week" || tab === "best" ? i + 1 : 0)) : [el("p", { className: "dc-empty", textContent: EMPTY[tab] })]));
    };
    draw();
    const box = el("details", { className: "rt-top dc", open: saved.open !== false }, el("summary", {}, "Découvrir"), tabs, row);
    box.addEventListener("toggle", () => { saved.open = box.open; remember(); });
    return box;
  }
  style.textContent += `
.dc-tabs { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 10px; }
.dc-tabs button { border: 1px solid var(--line, rgba(255,210,214,.13)); background: rgba(255,255,255,.03); color: var(--haze, #a88f92); border-radius: 999px; padding: 7px 13px; font: 600 12px var(--f-body, sans-serif); cursor: pointer; }
.dc-tabs button.on { color: var(--mist, #F6EEEE); border-color: var(--ember, #E23444); background: color-mix(in srgb, var(--ember, #E23444) 16%, transparent); }
.dc-row { display: grid; grid-auto-flow: column; grid-auto-columns: 168px; gap: 12px; overflow-x: auto; padding: 4px 14px 16px; scrollbar-width: thin; }
.rt-top .dc-card { position: relative; display: grid; align-content: start; gap: 4px; padding: 8px; border-radius: 14px; color: var(--mist, #F6EEEE); text-decoration: none; background: rgba(255,255,255,.03); border: 1px solid transparent; }
.dc-card:hover { border-color: var(--line, rgba(255,210,214,.13)); background: rgba(255,255,255,.06); }
.rt-top .dc-card img, .rt-top .dc-card .dc-ph { width: 100%; height: auto; aspect-ratio: 1; border-radius: 10px; object-fit: cover; background: linear-gradient(135deg, #5C0008, #2A0A0E); }
.dc-card b { font: 700 14px/1.25 var(--f-body, sans-serif); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 4px; }
.dc-card small { color: var(--haze, #a88f92); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-card .dc-stats { font: 500 11px var(--f-mono, monospace); color: var(--mist, #F6EEEE); opacity: .8; }
.dc-owner { cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.dc-owner:hover { color: var(--ember, #E23444); }
.dc-rank { position: absolute; top: 14px; left: 14px; min-width: 26px; height: 26px; padding: 0 7px; border-radius: 9px; background: rgba(13,8,9,.8); color: var(--ember, #E23444); font: 800 13px/26px var(--f-display, sans-serif); text-align: center; }
.dc-empty { margin: 0; padding: 10px 4px; color: var(--haze, #a88f92); font-size: 14px; grid-column: 1 / -1; white-space: normal; }
`;

  window.OniriqueRatings = { load, visible, bar, up: (kind, id, token) => (visible(kind, id) ? upButton(kind, id, token, true) : null), top, discover };
})();
