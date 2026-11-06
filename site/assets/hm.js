// HM (« Hail Mary ») : l'écoute partagée du CLOUD, façon Spotify Jam. Le serveur est server/src/hm.js.
//
//   OniriqueHM.setup({ api, token, el, icon, player, avatar, button })   button : le bouton « HM » de la page
//
// Pendant un HM, le lecteur du CLOUD joue ce que joue le HM, recalé sur l'heure du serveur. Ce qu'on lance ou met
// dans la file (un son du CLOUD, un titre Spotify) part dans la file du HM. Lecture, pause, avance, suivant : envoyés
// au HM si le créateur en a donné le droit ; sans ce droit, la pause ne vaut que pour soi.
(() => {
  const KEY = "onirique.hm";
  const PERM_LABELS = { add: "Ajouter des sons", skip: "Passer, retirer, réordonner", control: "Lecture, pause, avancer", kick: "Expulser" };
  const LEVEL_LABELS = { all: "Tout le monde", cohosts: "Co-hôtes", host: "Moi seul" };
  const css = `
#hm-dlg { width: min(520px, calc(100vw - 24px)); }
#hm-dlg .hm-body { padding: 18px; display: grid; gap: 18px; max-height: min(70vh, 640px); overflow-y: auto; }
#hm-dlg h3 { margin: 0 0 8px; font: 700 12px var(--f-body); letter-spacing: .12em; text-transform: uppercase; color: var(--haze); }
#hm-dlg .hm-link { display: flex; gap: 8px; }
#hm-dlg .hm-link input { flex: 1; min-width: 0; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line); background: rgba(255,255,255,.04); color: var(--mist); font: 500 13px var(--f-body); }
#hm-dlg ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
#hm-dlg li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 12px; background: rgba(255,255,255,.03); }
#hm-dlg li img { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; flex: none; }
#hm-dlg li.hm-song img { border-radius: 8px; }
#hm-dlg li .grow { flex: 1; min-width: 0; }
#hm-dlg li .grow b, #hm-dlg li .grow small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#hm-dlg li small { color: var(--haze); font-size: 12px; }
#hm-dlg .hm-tag { font: 700 10px var(--f-body); letter-spacing: .1em; text-transform: uppercase; color: var(--ember); border: 1px solid var(--ember); border-radius: 999px; padding: 2px 7px; }
#hm-dlg .hm-mini { flex: none; border: 1px solid var(--line); background: none; color: var(--mist); border-radius: 999px; padding: 5px 10px; font: 600 12px var(--f-body); cursor: pointer; }
#hm-dlg .hm-mini:hover { border-color: var(--ember); }
#hm-dlg .hm-mini svg { width: 14px; height: 14px; vertical-align: -2px; }
#hm-dlg .hm-now { border: 1px solid rgba(226,52,68,.45); background: rgba(226,52,68,.08); }
#hm-dlg .hm-ctl { display: flex; gap: 8px; }
#hm-dlg .hm-perms { display: grid; grid-template-columns: 1fr auto; gap: 8px 12px; align-items: center; font-size: 14px; }
#hm-dlg select { padding: 7px 10px; border-radius: 10px; border: 1px solid var(--line); background: #1d0f12; color: var(--mist); font: 500 13px var(--f-body); }
#hm-dlg .muted { color: var(--haze); font-size: 13px; margin: 0; }
.hm-chip { position: fixed; right: 16px; bottom: 120px; z-index: 60; display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 999px;
  border: 1px solid var(--ember); background: #150a0c; color: var(--mist); font: 700 13px var(--f-body); cursor: pointer; box-shadow: 0 10px 40px -10px rgba(226,52,68,.8); }
.hm-chip i { width: 8px; height: 8px; border-radius: 50%; background: var(--ember); box-shadow: 0 0 8px var(--ember); animation: hm-pulse 1.6s ease-in-out infinite; }
@keyframes hm-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .hm-chip i { animation: none; } }
`;

  function setup({ api, token, el, icon, player, avatar, button }) {
    document.head.append(el("style", { textContent: css }));
    const dlg = el("dialog", { id: "hm-dlg" });
    const chip = el("button", { className: "hm-chip", type: "button", hidden: true });
    document.body.append(dlg, chip);
    chip.onclick = button.onclick = () => (state ? draw(true) : start());

    let code = null, state = null, offset = 0, stream = null, syncing = false, hold = false, lastSeek = 0;
    const mine = () => state && state.you;
    const can = (perm) => !!(state && state.you.can[perm]);
    const keyOf = (n) => "hm" + n.qid;
    const expected = (n) => n.pos + (n.playing ? (Date.now() + offset - n.at) / 1000 : 0);
    const send = (action, body) => api("POST", "/hm/" + code + "/" + action, body || {}).catch((error) => alert(error.message));
    const quiet = (fn) => { syncing = true; try { return fn(); } finally { syncing = false; } };

    // ——— Le lecteur, piloté par le HM ———
    const audio = player.audio, origPlay = player.play.bind(player), origEnqueue = player.enqueue.bind(player);
    const aPlay = audio.play.bind(audio), aPause = audio.pause.bind(audio);
    const timeDesc = Object.getOwnPropertyDescriptor(audio, "currentTime");
    audio.play = () => {
      if (!state || syncing) return aPlay();
      hold = false;
      const n = state.now;
      if (n && !n.playing && can("control")) send("play");
      return n && !n.playing ? Promise.resolve() : aPlay(); // reprendre pour soi un HM qui joue : toujours permis
    };
    audio.pause = () => {
      if (state && !syncing && state.now) { if (can("control")) send("pause", { pos: audio.currentTime }); else hold = true; }
      return aPause();
    };
    Object.defineProperty(audio, "currentTime", {
      configurable: true, get: timeDesc.get,
      set(value) {
        if (state && !syncing) { if (!can("control") || !state.now) return; send("seek", { pos: value }); }
        lastSeek = Date.now();
        timeDesc.set.call(audio, value);
      },
    });
    // Lancer ou mettre dans la file un son, pendant un HM : il part dans la file du HM.
    const toHm = (item, next) => {
      if (!can("add")) return alert("Le créateur du HM ne t'a pas donné le droit d'ajouter des sons.");
      const { key, id, trackId, comments, lyrics, peaks, downloadUrl, ...rest } = item;
      api("POST", "/hm/" + code + "/add", { item: rest, next }).then(() => toast("Ajouté à la file du HM : " + item.title), (error) => alert(error.message));
    };
    player.play = (items, i = 0, autoplay = true) => (state && !syncing ? items[i] && toHm(items[i]) : origPlay(items, i, autoplay));
    player.enqueue = (item) => (state && !syncing ? toHm(item) : origEnqueue(item));
    player.control = null;
    const control = (what) => {
      const n = state && state.now;
      if (!n) return;
      if (what === "ended") return send("ended", { qid: n.qid });
      if (what === "next") return can("skip") ? send("skip", { qid: n.qid }) : alert("Le créateur du HM ne t'a pas donné le droit de passer un son.");
      if (what === "prev") audio.currentTime = 0;
    };

    // Toutes les secondes : le bon son, à la bonne place, en lecture ou en pause comme le HM.
    setInterval(() => {
      const n = state && state.now;
      if (!state) return;
      if (!n) { if (player.item && /^hm/.test(player.item.key) && player.playing) quiet(aPause); return; }
      if (!n.item.url && !n.item.engine) return;
      const want = n.playing && !hold;
      quiet(() => {
        if (!player.item || player.item.key !== keyOf(n)) {
          origPlay([{ ...n.item, key: keyOf(n), id: null, trackId: null, comments: [], lyrics: "", peaks: n.item.peaks || [] }], 0, want);
          lastSeek = 0;
          return;
        }
        if (want && !player.playing) aPlay().catch(() => {});
        if (!want && player.playing) aPause();
        const d = audio.duration;
        if ((Number.isFinite(d) && d > 0 || n.item.engine) && Math.abs(audio.currentTime - expected(n)) > 2 && Date.now() - lastSeek > 3000) {
          lastSeek = Date.now();
          timeDesc.set.call(audio, Math.max(0, expected(n)));
        }
      });
    }, 1000);

    // ——— Le flux en direct ———
    async function listen(c) {
      const response = await fetch("/api/hm/" + c + "/live", { headers: { Authorization: "Bearer " + token } }).catch(() => null);
      if (!response || !response.ok) {
        const data = response ? await response.json().catch(() => ({})) : {};
        if (response && response.status >= 400 && response.status < 500) return stop(data.error || "Ce HM n'est plus disponible.");
        return void setTimeout(() => code === c && connect(), 3000);
      }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      stream = reader;
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ done: true }));
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop();
        for (const b of blocks) {
          if (!b.startsWith("data: ")) continue;
          const m = JSON.parse(b.slice(6));
          if (m.kicked) return stop("Le créateur du HM t'a retiré de la séance.");
          if (m.ended) return stop("Le créateur a fermé le HM.");
          receive(m);
        }
      }
      if (code === c && stream === reader) setTimeout(() => code === c && connect(), 2000); // coupé (mise en ligne du serveur) : on revient
    }
    const connect = () => listen(code);
    function receive(s) {
      const first = !state;
      offset = s.t - Date.now();
      state = s;
      player.control = control;
      if (first) draw(true); else if (dlg.open) draw();
      drawChip();
    }

    async function join(c) {
      if (code === c) return draw(true);
      if (code) leave(false);
      try { receive(await api("GET", "/hm/" + c)); } catch (error) { try { sessionStorage.removeItem(KEY); } catch {} return alert(error.message); }
      code = c;
      try { sessionStorage.setItem(KEY, c); } catch {}
      connect();
    }
    function leave(pause = true) {
      code = null; state = null; hold = false;
      player.control = null;
      if (stream) stream.cancel().catch(() => {});
      stream = null;
      try { sessionStorage.removeItem(KEY); } catch {}
      if (pause && player.item && /^hm/.test(player.item.key)) aPause();
      if (dlg.open) dlg.close();
      drawChip();
    }
    function stop(message) { leave(); alert(message); }
    async function start() {
      try { const s = await api("POST", "/hm", {}); await join(s.code); } catch (error) { alert(error.message); }
    }

    // ——— La fenêtre du HM ———
    const toast = (text) => {
      const t = el("div", { textContent: text, style: "position:fixed;left:50%;bottom:130px;transform:translateX(-50%);z-index:80;padding:10px 16px;border-radius:999px;background:#150a0c;border:1px solid var(--ember);color:var(--mist);font:600 13px var(--f-body);max-width:calc(100vw - 32px)" });
      document.body.append(t);
      setTimeout(() => t.remove(), 2600);
    };
    const mini = (label, onclick, iconName) => el("button", { className: "hm-mini", type: "button", onclick, title: label, ariaLabel: label }, iconName ? icon(iconName) : label);
    function drawChip() {
      chip.hidden = !state;
      button.textContent = state ? "HM · " + state.members.length : "HM";
      button.setAttribute("aria-pressed", String(!!state));
      if (state) chip.replaceChildren(el("i"), "HM · " + state.members.length + " en écoute");
    }
    function song(x, extra) {
      return el("li", { className: "hm-song" + (extra ? " hm-now" : "") },
        x.item.cover ? el("img", { src: x.item.cover + (x.item.cover.startsWith("/api/") ? "?w=160" : ""), alt: "" }) : el("img", { src: "assets/favicon.png?v=2", alt: "" }),
        el("div", { className: "grow" }, el("b", { textContent: x.item.title + (x.item.feat ? " (feat. " + x.item.feat + ")" : "") }),
          el("small", { textContent: [x.item.artist || x.item.subtitle, "ajouté par " + x.by.name].filter(Boolean).join(" · ") })),
        ...(extra || []));
    }
    function draw(show) {
      if (!state) return;
      const s = state, you = s.you, n = s.now;
      const link = el("input", { value: s.url, readOnly: true, ariaLabel: "Lien du HM", onclick: (e) => e.target.select() });
      const copy = el("button", { className: "btn btn-primary", type: "button", textContent: "Copier", onclick: () => navigator.clipboard.writeText(s.url).then(() => toast("Lien du HM copié")) });
      const members = s.members.map((m) => el("li", {},
        el("img", { src: avatar(m), alt: "" }),
        el("div", { className: "grow" }, el("b", { textContent: m.name + (m.id === you.id ? " (toi)" : "") })),
        m.host ? el("span", { className: "hm-tag", textContent: "Créateur" }) : m.cohost ? el("span", { className: "hm-tag", textContent: "Co-hôte" }) : null,
        you.host && !m.host ? mini(m.cohost ? "Retirer co-hôte" : "Co-hôte", () => send("cohost", { userId: m.id, on: !m.cohost })) : null,
        !m.host && m.id !== you.id && you.can.kick && (you.host || !m.cohost) ? mini("Retirer", () => confirm("Retirer " + m.name + " du HM ?") && send("kick", { userId: m.id })) : null));
      const ctl = n ? el("div", { className: "hm-ctl" },
        you.can.control ? mini(n.playing ? "Pause" : "Lecture", () => send(n.playing ? "pause" : "play", n.playing ? { pos: audio.currentTime } : {})) : null,
        you.can.skip ? mini("Passer", () => send("skip", { qid: n.qid })) : null) : null;
      const queue = s.queue.map((x, i) => song(x, [
        you.can.skip && i > 0 ? mini("Monter", () => send("move", { qid: x.qid, to: i - 1 }), "expand") : null,
        you.can.skip || (x.by.id === you.id && you.can.add) ? mini("Retirer de la file", () => send("remove", { qid: x.qid }), "close") : null]));
      const perms = you.host ? el("div", { className: "hm-perms" }, ...Object.entries(PERM_LABELS).flatMap(([p, label]) => {
        const select = el("select", { ariaLabel: label, onchange: () => send("perms", { perms: { [p]: select.value } }) },
          ...Object.entries(LEVEL_LABELS).map(([v, l]) => el("option", { value: v, textContent: l, selected: s.perms[p] === v })));
        return [el("span", { textContent: label }), select];
      })) : el("p", { className: "muted", textContent: "Tes droits : " + (Object.entries(PERM_LABELS).filter(([p]) => you.can[p]).map(([, l]) => l.toLowerCase()).join(", ") || "écouter") + "." });
      dlg.replaceChildren(
        el("div", { className: "dlg-head" }, el("b", { textContent: s.name }), el("button", { className: "round", type: "button", ariaLabel: "Fermer", onclick: () => dlg.close() }, icon("close"))),
        el("div", { className: "hm-body" },
          el("section", {}, el("h3", { textContent: "Inviter" }), el("div", { className: "hm-link" }, link, copy),
            el("p", { className: "muted", style: "margin-top:8px", textContent: "Ceux qui ouvrent ce lien avec leur compte ONIRIQUE rejoignent le HM et écoutent la même chose que toi." })),
          el("section", {}, el("h3", { textContent: "En écoute · " + s.members.length }), el("ul", {}, ...members)),
          el("section", {}, el("h3", { textContent: "En cours" }), n ? el("ul", {}, song(n, [ctl])) : el("p", { className: "muted", textContent: "Rien pour l'instant : lance un son du CLOUD ou de Spotify, il part dans la file du HM." })),
          el("section", {}, el("h3", { textContent: "À suivre · " + s.queue.length }), s.queue.length ? el("ul", {}, ...queue) : el("p", { className: "muted", textContent: you.can.add ? "Pendant le HM, tout ce que tu lances ou mets dans la file s'ajoute ici." : "La file est vide." })),
          el("section", {}, el("h3", { textContent: "Droits" }), perms)),
        el("div", { className: "share-foot" },
          you.host ? el("button", { className: "btn btn-ghost", type: "button", textContent: "Fermer le HM pour tout le monde", onclick: () => confirm("Fermer le HM pour tout le monde ?") && api("DELETE", "/hm/" + code).then(() => leave(), (e) => alert(e.message)) })
            : el("button", { className: "btn btn-ghost", type: "button", textContent: "Quitter le HM", onclick: () => leave() })));
      if (show && !dlg.open) dlg.showModal();
    }
    dlg.addEventListener("click", (event) => { if (event.target === dlg) dlg.close(); });

    // Le lien d'un HM (#/hm/CODE), même ouvert avant de se connecter, et le HM en cours après un rechargement.
    const fromHash = () => {
      const m = /^#\/hm\/([\w-]+)/.exec(location.hash);
      if (!m) return null;
      history.replaceState(null, "", location.pathname + location.search);
      return m[1];
    };
    addEventListener("hashchange", () => { const c = fromHash(); if (c) join(c); });
    let pending = fromHash();
    try { pending = pending || sessionStorage.getItem(KEY); if (pending && !token) sessionStorage.setItem(KEY, pending); } catch {}
    if (pending && token) join(pending);
  }

  window.OniriqueHM = { setup };
})();
