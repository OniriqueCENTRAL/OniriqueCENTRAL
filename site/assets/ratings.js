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

  window.OniriqueRatings = { load, visible, bar, up: (kind, id, token) => (visible(kind, id) ? upButton(kind, id, token, true) : null), top };
})();
