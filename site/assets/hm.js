// HM (« Hail Mary ») : l'écoute partagée du CLOUD, façon Spotify Jam. Le serveur est server/src/hm.js.
//
//   OniriqueHM.setup({ api, token, el, icon, player, avatar, button, library })
//     button : le bouton « HM » de la page ; library() → [{ title, cover, items }] les sons de mon CLOUD (items : ceux du lecteur)
//
// Pendant un HM, le lecteur du CLOUD joue ce que joue le HM, recalé sur l'heure du serveur. Ce qu'on lance ou met
// dans la file (un son du CLOUD, un titre Spotify) part dans la file du HM. Lecture, pause, avance, suivant : envoyés
// au HM si le créateur en a donné le droit ; sans ce droit, la pause ne vaut que pour soi.
(() => {
  const KEY = "onirique.hm";
  // Le HM où l'on est, pour les autres pages du site (page d'écoute d'une playlist, messages) et pour l'application,
  // qui recrée CLOUD (connexion, relance) : localStorage, effacé en quittant le HM.
  const ACTIVE = "onirique.hm.active";
  const remember = (c) => { try { if (c) localStorage.setItem(ACTIVE, c); else localStorage.removeItem(ACTIVE); } catch {} };
  const remembered = () => { try { return localStorage.getItem(ACTIVE); } catch { return null; } };
  // Ce qui part dans la file : le son tel que le lecteur le connaît, sans ce qui ne sert qu'à celui qui l'ajoute.
  const forHm = ({ key, id, trackId, comments, downloadUrl, offers, credits, locked, position, ...rest }) => rest;
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
#hm-dlg .hm-now { border: 1px solid rgba(var(--acc, 229,56,74),.45); background: rgba(var(--acc, 229,56,74),.08); }
#hm-dlg .hm-ctl { display: flex; gap: 8px; }
#hm-dlg .hm-perms { display: grid; grid-template-columns: 1fr auto; gap: 8px 12px; align-items: center; font-size: 14px; }
#hm-dlg select { padding: 7px 10px; border-radius: 10px; border: 1px solid var(--line); background: #1d0f12; color: var(--mist); font: 500 13px var(--f-body); }
#hm-dlg .muted { color: var(--haze); font-size: 13px; margin: 0; }
.hm-chip { position: fixed; right: 16px; bottom: 120px; z-index: 60; display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 999px;
  border: 1px solid var(--ember); background: #150a0c; color: var(--mist); font: 700 13px var(--f-body); cursor: pointer; box-shadow: 0 10px 40px -10px rgba(var(--acc, 229,56,74),.8); }
.hm-chip i { width: 8px; height: 8px; border-radius: 50%; background: var(--ember); box-shadow: 0 0 8px var(--ember); animation: hm-pulse 1.6s ease-in-out infinite; }
@keyframes hm-pulse { 50% { opacity: .35; } }
/* Dans la rangée du lecteur, juste avant « précédent », à la hauteur de ses boutons. */
.op-pill > .hm-chip { position: static; flex: none; height: 30px; padding: 0 11px 0 9px; gap: 6px; box-shadow: none; background: rgba(var(--acc, 229,56,74),.12);
  border-color: rgba(var(--acc, 229,56,74),.6); font: 700 11px/1 var(--f-body); letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
.op-pill > .hm-chip i { width: 6px; height: 6px; }
.op-pill > .hm-chip:hover { background: rgba(var(--acc, 229,56,74),.22); border-color: var(--ember); }
/* Sur téléphone, le lecteur n'a pas la place : le bouton « HM · N » du haut de la page suffit. */
@media (max-width: 720px) { .op-pill > .hm-chip { display: none; } }
#hm-dlg .hm-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
#hm-dlg .hm-head h3 { margin: 0; }
#hm-dlg details.hm-friends { margin-top: 10px; border: 1px solid var(--line); border-radius: 14px; }
#hm-dlg details.hm-friends summary { list-style: none; cursor: pointer; padding: 10px 12px; font: 600 14px var(--f-body); display: flex; align-items: center; justify-content: space-between; gap: 8px; }
#hm-dlg details.hm-friends summary::-webkit-details-marker { display: none; }
#hm-dlg details.hm-friends summary svg { width: 16px; height: 16px; margin-left: auto; transition: transform .2s; }
#hm-dlg details.hm-friends[open] summary svg { transform: rotate(180deg); }
#hm-dlg details.hm-friends ul { padding: 0 8px 8px; max-height: 240px; overflow-y: auto; }
#hm-pick { width: min(520px, calc(100vw - 24px)); }
#hm-pick .hm-body { padding: 14px 18px 18px; display: grid; gap: 14px; max-height: min(70vh, 640px); overflow-y: auto; }
#hm-pick input[type=search] { width: 100%; padding: 11px 14px; border-radius: 12px; border: 1px solid var(--line); background: rgba(255,255,255,.04); color: var(--mist); font: 500 14px var(--f-body); }
#hm-pick h3 { margin: 0 0 6px; font: 700 12px var(--f-body); letter-spacing: .12em; text-transform: uppercase; color: var(--haze); }
#hm-pick ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
#hm-pick li { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 10px; background: rgba(255,255,255,.03); }
#hm-pick li img { width: 34px; height: 34px; border-radius: 8px; object-fit: cover; flex: none; }
#hm-pick li .grow { flex: 1; min-width: 0; }
#hm-pick li .grow b, #hm-pick li .grow small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#hm-pick li small { color: var(--haze); font-size: 12px; }
#hm-pick .hm-mini, #hm-dlg .hm-mini.on { border-color: var(--ember); }
#hm-pick .hm-mini { flex: none; background: none; color: var(--mist); border: 1px solid var(--line); border-radius: 999px; padding: 5px 10px; font: 600 12px var(--f-body); cursor: pointer; }
#hm-pick .hm-mini svg { width: 14px; height: 14px; vertical-align: -2px; }
#hm-pick .hm-mini:disabled { opacity: .5; cursor: default; }
@media (prefers-reduced-motion: reduce) { .hm-chip i { animation: none; } }
`;

  // Mes sons du CLOUD (mes-sons.html : data, itemOf, OniriquePlatforms), groupés par projet, prêts pour le lecteur.
  function cloudLibrary() {
    /* global data, itemOf */
    if (typeof data === "undefined" || !data || data.vanish || typeof itemOf !== "function") return [];
    const PF = window.OniriquePlatforms;
    const mine = data.projects.map((p) => ({ title: p.title, cover: p.cover,
      items: (p.kind === "playlist" && PF ? PF.mixed(p) : p.tracks.map((t) => ({ track: t })))
        .filter((x) => x.track || (PF && PF.playable(x.item)))
        .map((x) => (x.track ? itemOf(p, x.track) : PF.playerItem(x.item))) })).filter((g) => g.items.length);
    const theirs = (data.saved || []).filter((x) => x.available !== false).map((x) => ({ title: x.title, cover: x.cover, by: x.owner, load: () => shareItems(x) }));
    return [...mine, ...theirs];
  }
  // Les sons d'un projet ou d'une playlist d'un autre, par son lien d'écoute (comme sa page d'écoute) : ceux du CLOUD et
  // les titres Spotify qui se lisent ici, dans l'ordre de la playlist.
  async function shareItems(x) {
    /* global token */
    const response = await fetch("/api/sounds/share/" + encodeURIComponent(x.token), {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ pass: x.pass }) });
    if (!response.ok) throw new Error("Cette playlist n'est plus partagée.");
    return shareToItems(await response.json());
  }
  function shareToItems(share) {
    const cloud = (share.tracks || []).map((t) => ({ position: t.position, title: t.title, feat: (t.credits || {}).feat, artist: share.owner, subtitle: share.title,
      cover: share.cover, url: t.version.url, duration: t.version.duration, peaks: t.version.peaks, lyrics: t.lyrics || "" }));
    const platform = (share.items || []).filter((x) => x.playable && x.platform === "spotify" && x.extId).map((x) => ({ position: x.position, title: x.title,
      artist: x.artist, subtitle: x.artist, cover: x.cover, url: x.listen, duration: x.duration, engine: "spotifyEmbed", extId: x.extId }));
    return [...cloud, ...platform].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }

  /**
   * Une autre page du site (page d'écoute d'une playlist, messages) pendant un HM : ce qu'on y lance part dans la file du
   * HM au lieu de jouer dans le lecteur de la page. Seulement si l'on est vraiment dans ce HM (CLOUD ouvert et connecté,
   * dans l'application ou un autre onglet) ; un bandeau le dit, et « Écouter ici » rend la main au lecteur de la page.
   */
  function forward({ player, token: session, el }) {
    const c = remembered();
    if (!c || !session || !player) return;
    const call = (method, path, body) => fetch("/api" + path, { method, headers: { Authorization: "Bearer " + session, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined }).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "Erreur " + r.status); return d; });
    let st = null, bar = null;
    const say = (text) => {
      const t = el("div", { textContent: text, style: "position:fixed;left:50%;bottom:130px;transform:translateX(-50%);z-index:80;padding:10px 16px;border-radius:999px;background:#150a0c;border:1px solid var(--ember,#E23444);color:#f6eeee;font:600 13px system-ui,sans-serif;max-width:calc(100vw - 32px)" });
      document.body.append(t);
      setTimeout(() => t.remove(), 2600);
    };
    const add = (item) => {
      if (!st.you.can.add) return alert("Le créateur du HM ne t'a pas donné le droit d'ajouter des sons.");
      call("POST", "/hm/" + c + "/add", { item: forHm(item) }).then(() => say("Ajouté à la file du HM : " + item.title), (e) => alert(e.message));
    };
    const play = player.play.bind(player), enqueue = player.enqueue.bind(player);
    player.play = (items, i = 0, autoplay = true) => (st ? items[i] && add(items[i]) : play(items, i, autoplay));
    player.enqueue = (item) => (st ? add(item) : enqueue(item));
    call("GET", "/hm/" + c).then((s) => {
      if (!s.members.some((m) => m.id === s.you.id)) return; // plus dans ce HM (CLOUD fermé) : la page joue elle-même
      st = s;
      bar = el("div", { role: "status", style: "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:90;display:flex;gap:10px;align-items:center;padding:8px 10px 8px 14px;border-radius:999px;background:#150a0c;border:1px solid var(--ember,#E23444);color:#f6eeee;font:600 13px system-ui,sans-serif;max-width:calc(100vw - 24px);box-shadow:0 10px 30px -10px rgba(0,0,0,.8)" },
        el("span", { textContent: "HM « " + s.name + " » : ce que tu lances ici part dans sa file" }),
        el("button", { type: "button", textContent: "Écouter ici", style: "flex:none;border:1px solid rgba(255,210,214,.3);background:none;color:inherit;border-radius:999px;padding:5px 10px;font:inherit;cursor:pointer",
          onclick: () => { st = null; bar.remove(); } }));
      document.body.append(bar);
    }, () => {});
  }

  function setup({ api, token, el, icon, player, avatar, button, library = cloudLibrary }) {
    document.head.append(el("style", { textContent: css }));
    const dlg = el("dialog", { id: "hm-dlg" }), pick = el("dialog", { id: "hm-pick" });
    const chip = el("button", { className: "hm-chip", type: "button", hidden: true });
    document.body.append(dlg, pick, chip);
    // Sans HM en cours : celui que j'ai créé et qui est encore ouvert (page rechargée, application relancée), sinon un nouveau.
    chip.onclick = button.onclick = () => (state ? draw(true) : api("GET", "/hm/mine").then((r) => (r.code ? join(r.code) : start()), () => start()));

    let code = null, state = null, offset = 0, stream = null, syncing = false, hold = false, lastSeek = 0; // offset : heure du serveur − la nôtre
    let settle = null, loadedAt = 0, lastData = 0, hinted = null, triedPlay = 0;
    let friendsOpen = false, friendList = null;
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
    // Ce que fait celui qui a la main s'applique tout de suite chez lui (sans attendre l'aller-retour du serveur) ;
    // le serveur le renvoie ensuite à tous, avec son heure, sur laquelle chacun se cale.
    const local = (n, patch) => { Object.assign(n, { pos: expected(n), at: serverNow() }, patch); };
    audio.play = () => {
      if (!state || syncing) return aPlay();
      hold = false;
      const n = state.now, it = player.item;
      // Un son resté de l'écoute d'avant (ou lancé par le lecteur lui-même) : il part dans la file au lieu de jouer ici seul.
      if (it && !/^hm/.test(it.key)) { void toHm(it).catch(() => {}); return Promise.resolve(); }
      if (!n) { toast("La file du HM est vide : ajoute un son avec « + » ou lance-en un."); return Promise.resolve(); }
      if (n && !n.playing) {
        if (!can("control")) { toast("Le HM est en pause : seul celui qui a la main peut le relancer."); return Promise.resolve(); }
        local(n, { playing: true });
        send("play", { pos: n.pos });
      }
      return aPlay(); // reprendre pour soi un HM qui joue : toujours permis
    };
    audio.pause = () => {
      // Un son lancé dans une autre vue de l'application (window.oniriqueLocalPause, app/main/main.js) ne coupe que ce lecteur.
      const n = state && !syncing && state.now;
      if (n) {
        if (can("control") && !window.oniriqueLocalPause) { local(n, { playing: false, pos: audio.currentTime }); send("pause", { pos: n.pos }); }
        else hold = true;
      }
      return aPause();
    };
    // Glisser sur la forme d'onde avance aussitôt chez soi ; le HM ne reçoit que la position où l'on s'arrête.
    let seekTimer = null;
    Object.defineProperty(audio, "currentTime", {
      configurable: true, get: timeDesc.get,
      set(value) {
        if (state && !syncing) {
          const n = state.now;
          if (!can("control") || !n) return;
          local(n, { pos: value });
          clearTimeout(seekTimer);
          seekTimer = setTimeout(() => state && state.now && send("seek", { pos: expected(state.now) }), 200);
        }
        lastSeek = Date.now();
        timeDesc.set.call(audio, value);
      },
    });
    // Lancer ou mettre dans la file un son, pendant un HM : il part dans la file du HM.
    const toHm = (item, next) => {
      if (!can("add")) { alert("Le créateur du HM ne t'a pas donné le droit d'ajouter des sons."); return Promise.reject(new Error("refusé")); }
      return api("POST", "/hm/" + code + "/add", { item: forHm(item), next }) // les paroles et la forme d'onde partent avec le son.then(() => toast("Ajouté à la file du HM : " + item.title), (error) => { alert(error.message); throw error; });
    };
    player.play = (items, i = 0, autoplay = true) => (state && !syncing ? items[i] && void toHm(items[i]).catch(() => {}) : origPlay(items, i, autoplay));
    player.enqueue = (item) => (state && !syncing ? void toHm(item).catch(() => {}) : origEnqueue(item));
    player.control = null;
    // Pour les autres menus de la page (recherche Spotify, platforms.js) : suis-je dans un HM où j'ai le droit d'ajouter ?
    Object.assign(window.OniriqueHM, { active: () => !!state && can("add"), add: (item) => toHm(item) });
    const control = (what) => {
      const n = state && state.now;
      if (!n) return;
      if (what === "ended") return send("ended", { qid: n.qid });
      if (what === "next") return can("skip") ? send("skip", { qid: n.qid }) : alert("Le créateur du HM ne t'a pas donné le droit de passer un son.");
      if (what === "prev") audio.currentTime = 0;
    };

    // Le son tel que le joue ce lecteur-ci. Un titre Spotify passe par le moteur de chacun : le lecteur complet pour un
    // compte Premium connecté, sinon le lecteur intégré de Spotify ; sans moteur (Apple Music non connecté), son extrait.
    const localItem = (n) => {
      const it = { ...n.item, key: keyOf(n), id: null, trackId: null, comments: [], lyrics: n.item.lyrics || "", peaks: n.item.peaks || [] };
      const PF = window.OniriquePlatforms;
      if (it.engine && PF) it.engine = PF.playerItem({ platform: it.engine === "spotifyEmbed" ? "spotify" : it.engine }).engine || undefined;
      return it;
    };
    // Le recalage. Le moteur d'un titre de plateforme (Spotify) ne change pas de vitesse et répond en quelques centaines de
    // millisecondes : il est replacé (un peu en avance) au-delà de 1,2 s d'écart. Un son du CLOUD (<audio>) est rattrapé en
    // douceur en accélérant ou ralentissant de 6 % au plus (inaudible), et replacé d'un coup au-delà de 1 s.
    const engineOn = () => !!(player.item && player.item.engine);
    function place(target) {
      lastSeek = Date.now();
      audio.playbackRate = 1;
      quiet(() => timeDesc.set.call(audio, Math.max(0, target + (engineOn() ? 0.35 : 0.05))));
    }
    // Une fois le son vraiment parti (Spotify met quelques secondes à charger), il se cale tout de suite sur le HM.
    audio.addEventListener("playing", () => {
      const n = state && state.now;
      if (!n || !settle || settle !== keyOf(n) || !player.item || player.item.key !== settle) return;
      settle = null;
      if (Math.abs(audio.currentTime - expected(n)) > 0.3) place(expected(n));
    });

    // À chaque état reçu, au retour sur la page et 4 fois par seconde : le bon son, à la bonne place, en lecture ou en pause.
    function sync() {
      const n = state && state.now;
      if (!state) return;
      if (!n) { if (player.playing) quiet(aPause); return; } // file vide : rien ne joue, pas même un son d'avant le HM
      if (!n.item.url && !n.item.engine) return;
      const want = n.playing && !hold;
      quiet(() => {
        if (!player.item || player.item.key !== keyOf(n)) {
          settle = keyOf(n); loadedAt = Date.now();
          audio.playbackRate = 1;
          origPlay([localItem(n)], 0, want);
          lastSeek = 0;
          return;
        }
        if (!want && player.playing) aPause();
        // Pendant le chargement (jusqu'à 6 s), on ne relance ni ne recale : le moteur n'a pas encore le titre.
        if (settle && Date.now() - loadedAt < 6000) return;
        settle = null;
        // Les paroles (cherchées par le serveur) et la forme d'onde arrivent parfois après le son : le lecteur les reprend.
        const cur = player.item;
        if (n.item.lyrics && cur.lyrics !== n.item.lyrics) cur.lyrics = n.item.lyrics;
        if (n.item.peaks && n.item.peaks.length && !(cur.peaks && cur.peaks.length)) { cur.peaks = n.item.peaks; player.redraw(); }
        if (want && !player.playing) {
          if (Date.now() - triedPlay < 1500) return; // un essai à la fois : Spotify met un moment à démarrer
          triedPlay = Date.now();
          aPlay().catch(() => {});
          // Le navigateur (téléphone surtout) refuse de lancer le son tout seul : il faut un toucher.
          if (hinted !== n.qid) { hinted = n.qid; setTimeout(() => { if (state && state.now && state.now.qid === n.qid && state.now.playing && !player.playing && !hold) toast("Touche ▶ dans le lecteur pour écouter le HM"); }, 1500); }
        }
        if (!want) { if (player.playing) aPause(); if (!hold && Math.abs(audio.currentTime - n.pos) > 0.5 && Date.now() - lastSeek > 1000) place(n.pos - (engineOn() ? 0.35 : 0.05)); return; }
        if (!player.playing) return;
        const target = expected(n), drift = audio.currentTime - target, d = audio.duration;
        if (engineOn()) {
          if (Math.abs(drift) > 1.2 && Date.now() - lastSeek > 4000) place(target);
        } else if (Number.isFinite(d) && d > 0) {
          if (Math.abs(drift) > 1) { if (Date.now() - lastSeek > 1500) place(target); }
          else audio.playbackRate = Math.abs(drift) < 0.04 ? 1 : 1 - Math.max(-0.06, Math.min(0.06, drift * 0.25));
        }
      });
    }
    setInterval(sync, 250);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { syncClock(); sync(); } });

    // L'horloge du serveur : plusieurs allers-retours, le plus court gardé ; l'heure du serveur au milieu de l'aller-retour.
    // Sans elle, chacun se calerait sur l'heure d'arrivée des messages, en retard de leur temps de trajet.
    let clockAt = 0;
    const serverNow = () => Date.now() + offset;
    async function syncClock() {
      if (Date.now() - clockAt < 20_000) return;
      clockAt = Date.now();
      let best = null;
      for (let i = 0; i < 5; i++) {
        const sent = Date.now(), t0 = performance.now();
        const r = await fetch("/api/hm/clock", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null), () => null);
        const rtt = performance.now() - t0;
        if (r && typeof r.t === "number" && (!best || rtt < best.rtt)) best = { rtt, offset: r.t - (sent + rtt / 2) };
      }
      if (best) offset = best.offset;
      else clockAt = 0; // réessayé au prochain état
    }
    setInterval(() => { if (state) { clockAt = 0; syncClock(); } }, 120_000);

    // ——— Le flux en direct ———
    async function listen(c) {
      const response = await fetch("/api/hm/" + c + "/live", { headers: { Authorization: "Bearer " + token } }).catch(() => null);
      if (code !== c) return void (response && response.body && response.body.cancel().catch(() => {}));
      if (!response || !response.ok) {
        const data = response ? await response.json().catch(() => ({})) : {};
        if (response && response.status >= 400 && response.status < 500) return stop(data.error || "Ce HM n'est plus disponible.");
        return void setTimeout(() => code === c && connect(), 3000);
      }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      stream = reader;
      lastData = Date.now();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ done: true }));
        if (done) break;
        lastData = Date.now();
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop();
        for (const b of blocks) {
          if (code !== c) return void reader.cancel().catch(() => {}); // un flux d'un HM quitté entre-temps
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
    // Une connexion figée (réseau perdu sans fermeture) : plus rien depuis 70 s, alors que le serveur parle toutes les 25 s.
    setInterval(() => { if (stream && code && Date.now() - lastData > 70_000) stream.cancel().catch(() => {}); }, 10_000);
    function receive(s) {
      const first = !state;
      if (!clockAt) offset = s.t - Date.now(); // en attendant la mesure de l'horloge
      state = s;
      syncClock();
      sync();
      player.control = control;
      if (first) draw(true); else if (dlg.open) draw();
      drawChip();
    }

    async function join(c) {
      if (code === c) return draw(true);
      // Le nouveau HM d'abord : un lien mort ou expulsé ne fait pas quitter celui où l'on est.
      let next;
      try { next = await api("GET", "/hm/" + c); } catch (error) {
        // Un HM fermé ou dont on a été retiré : on l'oublie, sinon l'application le redemande à chaque ouverture de CLOUD.
        if (!code) { try { sessionStorage.removeItem(KEY); } catch {} remember(null); }
        return alert(error.message);
      }
      if (code) leave(false);
      // Le code avant l'affichage : une erreur en dessinant ne laisse plus un HM affiché sans code (envois vers /hm/null).
      code = c;
      try { sessionStorage.setItem(KEY, c); } catch {}
      remember(c);
      connect();
      receive(next);
    }
    function leave(pause = true) {
      code = null; state = null; hold = false;
      audio.playbackRate = 1;
      player.control = null;
      if (stream) stream.cancel().catch(() => {});
      stream = null;
      try { sessionStorage.removeItem(KEY); } catch {}
      remember(null);
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
      // Sur le bord du lecteur quand il est là ; sinon le bouton « HM » de la page suffit.
      const pill = document.querySelector(".op-pill");
      if (pill && chip.parentNode !== pill) pill.insertBefore(chip, pill.querySelector(".op-btn"));
      chip.hidden = !state;
      button.textContent = state ? "HM · " + state.members.length : "HM";
      button.setAttribute("aria-pressed", String(!!state));
      if (state) { chip.replaceChildren(el("i"), "HM", el("span", { textContent: "· " + state.members.length })); chip.title = chip.ariaLabel = "HM en cours : " + state.members.length + " en écoute"; }
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
      // Inviter mes amis : un menu déroulant, chargé à l'ouverture.
      const friends = el("details", { className: "hm-friends", open: friendsOpen },
        el("summary", {}, "Inviter mes amis", icon("down")),
        friendList === null ? el("p", { className: "muted", style: "padding:0 12px 12px", textContent: "Chargement…" })
          : friendList.length ? el("ul", {}, ...friendList.map((f) => el("li", {},
            el("img", { src: avatar(f), alt: "" }), el("div", { className: "grow" }, el("b", { textContent: f.name })),
            f.here ? el("span", { className: "hm-tag", textContent: "Déjà là" })
              : f.invited ? el("button", { className: "hm-mini on", type: "button", disabled: true, textContent: "Invité" })
              : mini("Inviter", () => api("POST", "/hm/" + code + "/invite", { userId: f.id }).then(() => { f.invited = true; toast(f.name + " est invité"); draw(); }, (e) => alert(e.message))))))
          : el("p", { className: "muted", style: "padding:0 12px 12px", textContent: "Pas encore d'amis ici : tes amis sont les membres que tu suis et qui te suivent (pages de profil)." }));
      friends.ontoggle = () => {
        // Le menu recréé déjà ouvert (à chaque nouvel état) se signale aussi : sans ce garde-fou, la fenêtre se redessine sans fin.
        if (friends.open === friendsOpen) return;
        friendsOpen = friends.open;
        if (friends.open) api("GET", "/hm/" + code + "/friends").then((list) => { friendList = list; if (friendsOpen) draw(); }, () => {});
      };
      const host = you.host || s.cohosts.includes(you.id);
      const queue = s.queue.map((x, i) => song(x, [
        you.can.skip && i > 0 ? mini("Monter", () => send("move", { qid: x.qid, to: i - 1 }), "expand") : null,
        you.can.skip || (x.by.id === you.id && you.can.add) ? mini("Retirer de la file", () => send("remove", { qid: x.qid }), "close") : null]));
      const perms = you.host ? el("div", { className: "hm-perms" }, ...Object.entries(PERM_LABELS).flatMap(([p, label]) => {
        const select = el("select", { ariaLabel: label, onchange: () => send("perms", { perms: { [p]: select.value } }) },
          ...Object.entries(LEVEL_LABELS).map(([v, l]) => el("option", { value: v, textContent: l, selected: s.perms[p] === v })));
        return [el("span", { textContent: label }), select];
      })) : el("p", { className: "muted", textContent: "Tes droits : " + (Object.entries(PERM_LABELS).filter(([p]) => you.can[p]).map(([, l]) => l.toLowerCase()).join(", ") || "écouter") + "." });
      const top = (dlg.querySelector(".hm-body") || {}).scrollTop || 0; // le nouvel état ne fait pas remonter la fenêtre
      dlg.replaceChildren(
        el("div", { className: "dlg-head" }, el("b", { textContent: s.name }), el("button", { className: "round", type: "button", ariaLabel: "Fermer", onclick: () => dlg.close() }, icon("close"))),
        el("div", { className: "hm-body" },
          el("section", {}, el("h3", { textContent: "Inviter" }), el("div", { className: "hm-link" }, link, copy),
            el("p", { className: "muted", style: "margin-top:8px", textContent: "Ceux qui ouvrent ce lien avec leur compte ONIRIQUE rejoignent le HM et écoutent la même chose que toi." }), friends),
          el("section", {}, el("h3", { textContent: "En écoute · " + s.members.length }), el("ul", {}, ...members)),
          el("section", {}, el("h3", { textContent: "En cours" }), n ? el("ul", {}, song(n, [ctl])) : el("p", { className: "muted", textContent: "Rien pour l'instant : lance un son du CLOUD ou de Spotify, il part dans la file du HM." })),
          el("section", {}, el("div", { className: "hm-head" }, el("h3", { textContent: "À suivre · " + s.queue.length }),
            host && you.can.add ? el("button", { className: "hm-mini", type: "button", onclick: openPick, title: "Ajouter un son de mon CLOUD", ariaLabel: "Ajouter un son de mon CLOUD" }, icon("plus"), " Ajouter") : null),
            s.queue.length ? el("ul", {}, ...queue) : el("p", { className: "muted", textContent: you.can.add ? "Pendant le HM, tout ce que tu lances ou mets dans la file s'ajoute ici." : "La file est vide." })),
          el("section", {}, el("h3", { textContent: "Droits" }), perms)),
        el("div", { className: "share-foot" },
          you.host ? el("button", { className: "btn btn-ghost", type: "button", textContent: "Fermer le HM pour tout le monde", onclick: () => confirm("Fermer le HM pour tout le monde ?") && api("DELETE", "/hm/" + s.code).then(() => leave(), (e) => alert(e.message)) })
            : el("button", { className: "btn btn-ghost", type: "button", textContent: "Quitter le HM", onclick: () => leave() })));
      dlg.querySelector(".hm-body").scrollTop = top;
      if (show && !dlg.open) dlg.showModal();
    }
    dlg.addEventListener("click", (event) => { if (event.target === dlg) dlg.close(); });
    pick.addEventListener("click", (event) => { if (event.target === pick) pick.close(); });

    // « + » (créateur et co-hôtes) : mes sons du CLOUD, à chercher et ajouter un par un à la file du HM.
    function openPick() {
      const results = el("div", { style: "display:grid;gap:14px" });
      const input = el("input", { type: "search", placeholder: "Chercher dans mon CLOUD", ariaLabel: "Chercher dans mon CLOUD", autocomplete: "off" });
      const lib = library(), loaded = new Map();
      const addAll = (items, btn) => { btn.disabled = true; items.reduce((p, it) => p.then(() => toHm(it)), Promise.resolve()).then(() => btn.replaceChildren("Tout ajouté"), () => { btn.disabled = false; }); };
      const list = () => {
        const q = input.value.trim().toLowerCase();
        const groups = lib.map((g) => {
          const items = g.load ? loaded.get(g) : g.items;
          if (!items) return !q || [g.title, g.by].join(" ").toLowerCase().includes(q) ? { ...g, items: null } : null;
          const hit = items.filter((it) => !q || [it.title, it.artist, it.feat, g.title].join(" ").toLowerCase().includes(q));
          return hit.length ? { ...g, items: hit } : null;
        }).filter(Boolean);
        results.replaceChildren(...(groups.length ? groups.map((g) => el("section", {},
          el("div", { className: "hm-head" }, el("h3", { textContent: g.title + (g.by ? " · " + g.by : "") }),
            g.items ? el("button", { className: "hm-mini", type: "button", textContent: "Tout ajouter", onclick: (e) => addAll(g.items, e.currentTarget) })
              : el("button", { className: "hm-mini", type: "button", textContent: "Voir les sons", onclick: (e) => {
                e.currentTarget.disabled = true;
                g.load().then((items) => { loaded.set(lib.find((x) => x.load === g.load), items); list(); }, (err) => { alert(err.message); e.currentTarget.disabled = false; });
              } })),
          !g.items ? null : el("ul", {}, ...g.items.map((it) => {
          const add = el("button", { className: "hm-mini", type: "button", title: "Ajouter à la file du HM", ariaLabel: "Ajouter " + it.title + " à la file du HM" }, icon("plus"));
          add.onclick = () => { add.disabled = true; toHm(it).then(() => add.replaceChildren("Ajouté"), () => { add.disabled = false; }); };
          const cover = it.cover || g.cover;
          return el("li", {}, el("img", { src: cover ? cover + (cover.startsWith("/api/") ? "?w=160" : "") : "assets/favicon.png?v=2", alt: "" }),
            el("div", { className: "grow" }, el("b", { textContent: it.title + (it.feat ? " (feat. " + it.feat + ")" : "") }), el("small", { textContent: it.artist || it.subtitle || "" })), add);
        })))) : [el("p", { className: "muted", textContent: q ? "Aucun son ne correspond." : "Ton CLOUD n'a pas encore de son à ajouter." })]));
      };
      input.oninput = list;
      pick.replaceChildren(
        el("div", { className: "dlg-head" }, el("b", { textContent: "Ajouter au HM" }), el("button", { className: "round", type: "button", ariaLabel: "Fermer", onclick: () => pick.close() }, icon("close"))),
        el("div", { className: "hm-body" }, input, results));
      list();
      pick.showModal();
      input.focus();
    }

    // L'invitation d'un ami : le pop-up « Refuser / Rejoindre » commun au HM et à la WATCHPARTY (assets/invites.js).
    if (token && window.OniriqueInvites) OniriqueInvites.watch({ base: "/hm", title: "Invitation au HM", says: (x) => x.from.name + " t'invite au HM",
      join: (c) => join(c), current: () => code, avatar });

    // Le lien d'un HM (#/hm/CODE), même ouvert avant de se connecter, et le HM en cours après un rechargement.
    const fromHash = () => {
      const m = /^#\/hm\/([\w-]+)/.exec(location.hash);
      if (!m) return null;
      history.replaceState(null, "", location.pathname + location.search);
      return m[1];
    };
    const enter = (c) => { if (token) join(c); else try { sessionStorage.setItem(KEY, c); } catch {} };
    // Dans un navigateur d'ordinateur, le lien essaie d'abord l'application ONIRIQUE CENTRAL (onirique://hm/CODE).
    // Si la page perd la main dans les deux secondes, l'application (ou la question du navigateur) s'est ouverte ;
    // sinon elle n'est pas installée et le HM se rejoint ici.
    const inApp = !!(window.oniriqueApp || window.oniriqueDialog);
    const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const launch = (c) => {
      const url = "onirique://hm/" + c;
      // Firefox affiche une page d'erreur pour un protocole inconnu : chez lui, l'essai passe par un cadre invisible.
      if (/Chrome|Edg/.test(navigator.userAgent)) location.href = url;
      else { const f = el("iframe", { src: url, hidden: true }); document.body.append(f); setTimeout(() => f.remove(), 3000); }
    };
    function arrive(c) {
      if (inApp || phone) return enter(c);
      let away = false;
      const left = () => { away = true; };
      addEventListener("blur", left);
      const msg = el("p", { className: "muted", textContent: "Ouverture du HM dans l'application ONIRIQUE CENTRAL…" });
      dlg.replaceChildren(
        el("div", { className: "dlg-head" }, el("b", { textContent: "HM" })),
        el("div", { className: "hm-body" }, msg),
        el("div", { className: "share-foot", style: "grid-template-columns:1fr 1fr" },
          el("button", { className: "btn btn-ghost", type: "button", textContent: "Ouvrir dans l'application", onclick: () => launch(c) }),
          el("button", { className: "btn btn-primary", type: "button", textContent: "Rejoindre ici", onclick: () => { dlg.close(); enter(c); } })));
      dlg.showModal();
      launch(c);
      setTimeout(() => {
        removeEventListener("blur", left);
        if (!away && !document.hidden) { dlg.close(); enter(c); }
        else msg.textContent = "Le HM s'est ouvert dans l'application ONIRIQUE CENTRAL. Tu ne l'as pas ? Rejoins-le ici, dans le navigateur.";
      }, 2000);
    }
    addEventListener("hashchange", () => { const c = fromHash(); if (c) arrive(c); });
    const linked = fromHash();
    if (linked) arrive(linked);
    else {
      // Le HM d'avant : celui de cet onglet ; dans l'application (un seul CLOUD), celui qu'elle avait avant d'être recréée.
      let saved = null; try { saved = sessionStorage.getItem(KEY); } catch {}
      if (!saved && window.oniriqueApp) saved = remembered();
      if (saved && token) join(saved);
    }
  }

  window.OniriqueHM = { setup, forward, shareToItems };
})();
