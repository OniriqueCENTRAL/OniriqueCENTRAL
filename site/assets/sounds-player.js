// Le lecteur de « Mes sons », commun à mes-sons.html (le membre) et ecoute.html (l'auditeur d'un lien) : une barre
// flottante en bas de page (pochette, forme d'onde, précédent, lecture, suivant, aléatoire, répétition, file, volume)
// et, en la dépliant, la grande forme d'onde avec les commentaires placés dessus, la vitesse et la boucle.
//
//   const player = OniriquePlayer.create({ onPlay(item), onComment(item, at, text, name) → Promise<comment>, askName,
//                                          onDelete(item, comment) → Promise, onChange(item) })
//   player.play(items, index)   joue une liste (un projet) à partir de ce titre ; player.enqueue(item) l'ajoute à la file
//   item : { key, id, trackId, title, subtitle, cover, url, downloadUrl, duration, peaks, comments }
//   player.setAccent(color)      la couleur de la lecture (celle de la pochette du projet), null : la braise d'ONIRIQUE
//   OniriquePlayer.peaksOf(file) → Promise<{ peaks, duration }>, calculés dans le navigateur à l'envoi
//   OniriquePlayer.tint(url)     → Promise<{ accent, glow, deep } | null>, les couleurs tirées d'une pochette
//   OniriquePlayer.stageLabel(s) → « Maquette », « V2 », « Final », ou rien
//   OniriquePlayer.releaseLabel(d) → « Date de sortie prévue : 4 décembre 2026 » (à venir) ou « Date de sortie : … » (passée)
//   OniriquePlayer.icon(name)    → une icône SVG (play, pause, prev, next, shuffle, repeat, repeat1, queue, volume, mute,
//                                  link, more, plus, close, back, download, chevron, star)
(() => {
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter((c) => c !== null && c !== undefined));
    return node;
  };
  const time = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };

  const PATHS = {
    play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor"/>',
    pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/>',
    prev: '<path d="M18 6.5v11a.8.8 0 0 1-1.25.66L9 12.66a.8.8 0 0 1 0-1.32l7.75-5.5A.8.8 0 0 1 18 6.5Z" fill="currentColor"/><rect x="5.5" y="6" width="2.4" height="12" rx="1" fill="currentColor"/>',
    next: '<path d="M6 6.5v11a.8.8 0 0 0 1.25.66L15 12.66a.8.8 0 0 0 0-1.32l-7.75-5.5A.8.8 0 0 0 6 6.5Z" fill="currentColor"/><rect x="16.1" y="6" width="2.4" height="12" rx="1" fill="currentColor"/>',
    shuffle: '<path d="M3 7h3.5c2 0 3 1 4.2 2.8l2.6 4.4C14.5 16 15.5 17 17.5 17H21M3 17h3.5c1.4 0 2.3-.5 3.1-1.4M14.4 8.4c.8-.9 1.7-1.4 3.1-1.4H21M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    repeat: '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19m0 0-2.5-2.5M19 6l-2.5 2.5M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5m0 0 2.5 2.5M5 18l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    repeat1: '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19m0 0-2.5-2.5M19 6l-2.5 2.5M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5m0 0 2.5 2.5M5 18l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.2 10.2 12.4 9.4v5.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    queue: '<path d="M4 6h16M4 11h16M4 16h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 14.5v5l4-2.5Z" fill="currentColor"/>',
    volume: '<path d="M4 9.5h3l4.5-4v13L7 14.5H4Z" fill="currentColor"/><path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    mute: '<path d="M4 9.5h3l4.5-4v13L7 14.5H4Z" fill="currentColor"/><path d="m15.5 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    more: '<circle cx="5.5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="18.5" cy="12" r="1.7" fill="currentColor"/>',
    plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    close: '<path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    back: '<path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    chevron: '<path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
    expand: '<path d="m6 15 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    star: '<path d="M12 1.5 13.3 10.7 22.5 12 13.3 13.3 12 22.5 10.7 13.3 1.5 12 10.7 10.7Z" fill="currentColor"/>',
  };
  const icon = (name) => {
    const span = document.createElement("span");
    span.className = "op-icon";
    span.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${PATHS[name]}</svg>`;
    return span;
  };

  const css = `
.op-icon { display: inline-grid; place-items: center; line-height: 0; }
.op-pill { position: fixed; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 40; width: min(1120px, calc(100vw - 24px));
  display: flex; align-items: center; gap: 10px; padding: 8px 12px 8px 8px; border-radius: 999px; border: 1px solid rgba(255,210,214,.16);
  background: rgba(20,9,11,.92); backdrop-filter: blur(18px); box-shadow: 0 20px 60px -20px rgba(0,0,0,.9), 0 0 40px -18px var(--op-accent, rgba(226,52,68,.55)); }
.op-pill[hidden], .op-sheet[hidden], .op-queue[hidden], .op-comments[hidden] { display: none; }
.op-cover { flex: none; width: 44px; height: 44px; border-radius: 50%; object-fit: cover; background: linear-gradient(135deg, #5C0008, #2A0A0E); border: 1px solid rgba(255,210,214,.16); cursor: pointer; }
.op-pill.playing .op-cover { animation: op-spin 9s linear infinite; }
@keyframes op-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .op-pill.playing .op-cover { animation: none; } }
.op-meta { min-width: 0; width: 170px; flex: none; cursor: pointer; line-height: 1.25; }
.op-meta b { display: block; font: 700 13px var(--f-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.op-meta span { display: block; font-size: 12px; color: var(--haze); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.op-mini { flex: 1; min-width: 200px; height: 44px; cursor: pointer; touch-action: none; display: block; }
.op-time { flex: none; font: 500 11px var(--f-mono); color: var(--haze); white-space: nowrap; }
.op-btn { flex: none; width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 50%; background: none; color: var(--mist); cursor: pointer; }
.op-btn:hover { background: rgba(255,255,255,.06); }
.op-btn.on { color: var(--op-accent, var(--ember)); }
.op-btn.main { width: 42px; height: 42px; background: var(--mist); color: var(--night); }
.op-btn.main:hover { background: #fff; }
.op-vol { width: 80px; accent-color: var(--op-accent, var(--ember)); min-height: 0; padding: 0; }
.op-sheet, .op-queue { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(80px + env(safe-area-inset-bottom)); z-index: 39; width: min(1120px, calc(100vw - 24px));
  max-height: min(62vh, 560px); overflow: auto; padding: 18px; border-radius: 22px; border: 1px solid rgba(255,210,214,.16);
  background: rgba(20,9,11,.96); backdrop-filter: blur(18px); box-shadow: 0 20px 60px -20px rgba(0,0,0,.9); display: grid; gap: 14px; }
.op-head { display: flex; align-items: center; gap: 12px; }
.op-head b { flex: 1; min-width: 0; font: 700 16px var(--f-display); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.op-wave { width: 100%; height: 110px; display: block; cursor: pointer; touch-action: none; }
.op-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; font-size: 13px; color: var(--haze); }
.op-tools label { display: inline-flex; flex-direction: row; align-items: center; gap: 8px; font: 400 13px var(--f-body); letter-spacing: 0; text-transform: none; color: var(--haze); }
.op-tools input[type=range] { width: 120px; min-height: 0; padding: 0; accent-color: var(--ember); }
.op-tools input[type=checkbox] { width: 16px; height: 16px; min-height: 0; margin: 0; accent-color: var(--ember); }
.op-chip { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px; border: 1px solid rgba(255,210,214,.16); background: none; color: var(--mist); font: 600 12px var(--f-body); cursor: pointer; text-decoration: none; }
.op-chip:hover { border-color: var(--ember); }
.op-chip.on { background: var(--op-accent, var(--ember)); border-color: var(--op-accent, var(--ember)); color: var(--night); }
.op-comments { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 14px; }
.op-comments li { display: flex; gap: 10px; align-items: baseline; }
.op-comments button.at { flex: none; font: 600 12px var(--f-mono); color: var(--ember); background: none; border: 0; padding: 0; cursor: pointer; }
.op-comments .who { color: var(--haze); }
.op-say { display: flex; flex-wrap: wrap; gap: 8px; }
.op-say input { flex: 1 1 220px; min-height: 40px; }
.op-say input.op-name { flex: 0 1 150px; }
.op-queue ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.op-queue li button { width: 100%; display: flex; align-items: center; gap: 12px; padding: 8px; border: 0; border-radius: 12px; background: none; color: var(--mist); font: 500 14px var(--f-body); text-align: left; cursor: pointer; }
.op-queue li button:hover { background: rgba(255,255,255,.05); }
.op-queue li.now button { color: var(--ember); }
.op-queue img, .op-queue .op-q-cover { width: 36px; height: 36px; border-radius: 8px; object-fit: cover; flex: none; background: linear-gradient(135deg, #5C0008, #2A0A0E); }
.op-queue small { display: block; color: var(--haze); font-size: 12px; }
@media (max-width: 1000px) { .op-vol { display: none; } .op-mini { min-width: 120px; } }
@media (max-width: 720px) {
  .op-pill { gap: 4px; padding-right: 8px; }
  .op-meta { width: auto; flex: 1; }
  .op-mini, .op-time, .op-hide-sm { display: none; }
}
`;

  function create({ onPlay, onComment, askName, onDelete, onChange } = {}) {
    document.head.append(el("style", { textContent: css }));
    const audio = new Audio();
    audio.preload = "metadata";
    let list = [], index = -1, upNext = [], shuffle = false, repeat = "off", loop = null;
    let volume = 1, accent = "#E23444";
    try { volume = Math.min(1, Math.max(0, Number(localStorage.getItem("onirique.volume") ?? 1))); } catch {}
    audio.volume = volume;

    const btn = (name, label, extra = "") => {
      const b = el("button", { className: "op-btn " + extra, type: "button", ariaLabel: label, title: label });
      b.append(icon(name));
      return b;
    };
    const setIcon = (b, name) => b.replaceChildren(icon(name));

    // La barre.
    const cover = el("img", { className: "op-cover", alt: "" });
    const title = el("b"), sub = el("span");
    const meta = el("div", { className: "op-meta", title: "Détails" }, title, sub);
    const mini = el("canvas", { className: "op-mini", ariaLabel: "Forme d'onde : cliquer pour aller à ce moment" });
    const clock = el("span", { className: "op-time" });
    const prev = btn("prev", "Précédent"), play = btn("play", "Lecture", "main"), next = btn("next", "Suivant");
    const shuffleBtn = btn("shuffle", "Aléatoire", "op-hide-sm"), repeatBtn = btn("repeat", "Répéter", "op-hide-sm");
    const queueBtn = btn("queue", "File d'attente"), volBtn = btn("volume", "Couper le son", "op-hide-sm");
    const vol = el("input", { className: "op-vol op-hide-sm", type: "range", min: 0, max: 1, step: 0.01, value: volume, ariaLabel: "Volume" });
    const more = btn("expand", "Détails : commentaires, vitesse, boucle");
    const pill = el("div", { className: "op-pill", hidden: true, role: "region", ariaLabel: "Lecteur" },
      cover, meta, mini, clock, prev, play, next, shuffleBtn, repeatBtn, queueBtn, volBtn, vol, more);

    // Le panneau déplié : grande forme d'onde, commentaires, vitesse, boucle, téléchargement.
    const sheetTitle = el("b");
    const download = el("a", { className: "op-chip", hidden: true }, icon("download"), "Télécharger");
    const closeSheet = btn("close", "Fermer");
    const wave = el("canvas", { className: "op-wave", ariaLabel: "Forme d'onde : cliquer pour aller à ce moment" });
    const speed = el("input", { type: "range", min: 50, max: 150, step: 5, value: 100 });
    const speedText = el("span", { textContent: "100 %" });
    const keepPitch = el("input", { type: "checkbox", checked: true });
    const loopA = el("button", { className: "op-chip", type: "button", textContent: "Début boucle" });
    const loopB = el("button", { className: "op-chip", type: "button", textContent: "Fin boucle" });
    const loopOff = el("button", { className: "op-chip", type: "button", textContent: "Sans boucle", hidden: true });
    const comments = el("ul", { className: "op-comments" });
    const name = el("input", { className: "op-name", placeholder: "Ton nom", maxLength: 60, ariaLabel: "Ton nom" });
    const text = el("input", { placeholder: "Un commentaire à ce moment du titre…", maxLength: 1000, ariaLabel: "Commentaire" });
    const send = el("button", { className: "op-chip", type: "submit", textContent: "Commenter" });
    const say = el("form", { className: "op-say" }, askName ? name : null, text, send);
    const sheet = el("div", { className: "op-sheet", hidden: true },
      el("div", { className: "op-head" }, sheetTitle, download, closeSheet),
      wave,
      el("div", { className: "op-tools" },
        el("label", {}, "Vitesse", speed, speedText),
        el("label", {}, keepPitch, "Garder la hauteur"),
        loopA, loopB, loopOff),
      comments, onComment ? say : null);

    // La file d'attente.
    const queueList = el("ol");
    const closeQueue = btn("close", "Fermer");
    const queue = el("div", { className: "op-queue", hidden: true },
      el("div", { className: "op-head" }, el("b", { textContent: "File d'attente" }), closeQueue), queueList);
    document.body.append(sheet, queue, pill);

    const item = () => list[index] || null;
    const duration = () => (Number.isFinite(audio.duration) && audio.duration) || (item() && item().duration) || 0;

    function drawWave(canvas, gap, markers) {
      const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      const g = canvas.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const t = item(), d = duration(), progress = d ? audio.currentTime / d : 0;
      if (loop && d) { g.globalAlpha = .2; g.fillStyle = accent; g.fillRect(loop.a / d * w, 0, ((loop.b ?? d) - loop.a) / d * w, h); g.globalAlpha = 1; }
      const peaks = t && t.peaks && t.peaks.length ? t.peaks : null;
      const top = markers ? 8 : 0, bars = Math.max(1, Math.floor(w / gap));
      for (let i = 0; i < bars; i++) {
        const p = peaks ? peaks[Math.floor(i / bars * peaks.length)] : 0.1;
        const bh = Math.max(2, p * (h - top - 4));
        g.fillStyle = i / bars < progress ? accent : "rgba(246,238,238,.32)";
        g.fillRect(i * gap, top + (h - top - bh) / 2, Math.max(1, gap - 1), bh);
      }
      g.fillStyle = "#FFECEE";
      g.fillRect(Math.round(progress * w), top, 1.5, h - top);
      if (markers && t && d) for (const c of t.comments || []) {
        g.beginPath(); g.arc(Math.min(w - 4, Math.max(4, c.at / d * w)), 4, 3.5, 0, 7); g.fill();
      }
    }
    const draw = () => { if (!pill.hidden) drawWave(mini, 3, false); if (!sheet.hidden) drawWave(wave, 3, true); };

    function listComments() {
      const t = item();
      comments.replaceChildren(...((t && t.comments) || []).slice().sort((a, b) => a.at - b.at).map((c) => el("li", {},
        el("button", { className: "at", type: "button", textContent: time(c.at), onclick: () => { audio.currentTime = c.at; audio.play(); } }),
        el("span", {}, el("span", { className: "who", textContent: c.author + " — " }), c.body),
        onDelete ? el("button", { className: "at", type: "button", textContent: "✕", ariaLabel: "Supprimer ce commentaire", onclick: async () => {
          if (!confirm("Supprimer ce commentaire ?")) return;
          try { await onDelete(t, c); t.comments.splice(t.comments.indexOf(c), 1); listComments(); draw(); } catch (error) { alert(error.message); }
        } }) : null)));
      comments.hidden = !comments.children.length;
    }
    function listQueue() {
      const rows = list.map((t, i) => ({ t, i, now: i === index })).filter((r) => r.i >= index).concat(upNext.map((t) => ({ t, i: -1 })));
      queueList.replaceChildren(...rows.map(({ t, i, now }) => el("li", { className: now ? "now" : "" }, el("button", {
        type: "button", onclick: () => (i >= 0 ? go(i) : (upNext.splice(upNext.indexOf(t), 1), insertNext(t))),
      }, t.cover ? el("img", { src: t.cover, alt: "" }) : el("span", { className: "op-q-cover" }),
      el("span", {}, t.title, el("small", { textContent: (now ? "En cours · " : "") + (t.subtitle || "") }))))));
    }
    const insertNext = (t) => { list.splice(index + 1, 0, t); go(index + 1); };

    function tick() {
      clock.textContent = time(audio.currentTime) + " / " + time(duration());
      if (loop && loop.b != null && audio.currentTime >= loop.b) audio.currentTime = loop.a;
      draw();
    }
    function show() {
      const t = item();
      pill.hidden = false;
      document.body.style.paddingBottom = "110px";
      title.textContent = sheetTitle.textContent = t.title;
      sub.textContent = t.subtitle || "";
      if (t.cover) cover.src = t.cover; else cover.removeAttribute("src");
      download.hidden = !t.downloadUrl;
      if (t.downloadUrl) download.href = t.downloadUrl;
      listComments(); listQueue(); tick();
      if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.subtitle || "", artwork: t.cover ? [{ src: t.cover }] : [] });
      if (onChange) onChange(t);
    }
    function go(i, autoplay = true) {
      if (i < 0 || i >= list.length) return;
      index = i; loop = null;
      audio.src = list[i].url;
      applySpeed(); showLoop(); show();
      if (autoplay) audio.play().catch(() => {});
    }
    // La suite : la file d'abord, puis la liste (au hasard si demandé), puis du début si la répétition est mise.
    function advance(manual) {
      if (repeat === "one" && !manual) { audio.currentTime = 0; audio.play(); return; }
      if (upNext.length) return insertNext(upNext.shift());
      if (shuffle && list.length > 1) { let j; do j = Math.floor(Math.random() * list.length); while (j === index); return go(j); }
      if (index + 1 < list.length) return go(index + 1);
      if (repeat === "all" && list.length) return go(0);
      audio.pause(); audio.currentTime = 0;
    }

    audio.addEventListener("timeupdate", tick);
    audio.addEventListener("loadedmetadata", tick);
    audio.addEventListener("play", () => { setIcon(play, "pause"); play.ariaLabel = play.title = "Pause"; pill.classList.add("playing"); });
    audio.addEventListener("pause", () => { setIcon(play, "play"); play.ariaLabel = play.title = "Lecture"; pill.classList.remove("playing"); });
    audio.addEventListener("ended", () => advance(false));
    let counted = null;
    audio.addEventListener("playing", () => { const t = item(); if (onPlay && t && counted !== t.key) { counted = t.key; onPlay(t); } });
    audio.addEventListener("error", () => { if (item()) sub.textContent = "Lecture impossible : recharge la page."; });
    play.onclick = () => (audio.paused ? audio.play() : audio.pause());
    prev.onclick = () => (audio.currentTime > 3 || index === 0 ? (audio.currentTime = 0) : go(index - 1));
    next.onclick = () => advance(true);
    shuffleBtn.onclick = () => { shuffle = !shuffle; shuffleBtn.classList.toggle("on", shuffle); };
    repeatBtn.onclick = () => {
      repeat = { off: "all", all: "one", one: "off" }[repeat];
      repeatBtn.classList.toggle("on", repeat !== "off");
      setIcon(repeatBtn, repeat === "one" ? "repeat1" : "repeat");
      repeatBtn.title = repeatBtn.ariaLabel = { off: "Répéter", all: "Répéter la liste", one: "Répéter le titre" }[repeat];
    };
    const setVolume = (v) => {
      audio.volume = v; vol.value = v;
      setIcon(volBtn, v ? "volume" : "mute");
      try { localStorage.setItem("onirique.volume", String(v)); } catch {}
    };
    let before = volume || 1;
    vol.oninput = () => setVolume(Number(vol.value));
    volBtn.onclick = () => { if (audio.volume) { before = audio.volume; setVolume(0); } else setVolume(before); };
    queueBtn.onclick = () => { queue.hidden = !queue.hidden; sheet.hidden = true; queueBtn.classList.toggle("on", !queue.hidden); listQueue(); };
    closeQueue.onclick = () => { queue.hidden = true; queueBtn.classList.remove("on"); };
    const toggleSheet = () => { sheet.hidden = !sheet.hidden; queue.hidden = true; more.classList.toggle("on", !sheet.hidden); draw(); };
    more.onclick = meta.onclick = cover.onclick = toggleSheet;
    closeSheet.onclick = () => { sheet.hidden = true; more.classList.remove("on"); };

    const seek = (canvas) => (event) => {
      const r = canvas.getBoundingClientRect(), d = duration();
      if (d) { audio.currentTime = Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)) * d; tick(); }
    };
    for (const c of [mini, wave]) {
      c.addEventListener("pointerdown", (event) => { seek(c)(event); c.setPointerCapture(event.pointerId); });
      c.addEventListener("pointermove", (event) => { if (event.buttons) seek(c)(event); });
    }
    function applySpeed() {
      audio.playbackRate = speed.value / 100;
      audio.preservesPitch = keepPitch.checked;
      speedText.textContent = speed.value + " %";
    }
    speed.oninput = applySpeed;
    keepPitch.onchange = applySpeed;
    function showLoop() { loopA.classList.toggle("on", !!loop); loopB.classList.toggle("on", !!(loop && loop.b != null)); loopOff.hidden = !loop; draw(); }
    loopA.onclick = () => { loop = { a: audio.currentTime, b: null }; showLoop(); };
    loopB.onclick = () => {
      if (!loop) loop = { a: 0, b: null };
      if (audio.currentTime > loop.a) loop.b = audio.currentTime;
      showLoop();
    };
    loopOff.onclick = () => { loop = null; showLoop(); };
    say.onsubmit = async (event) => {
      event.preventDefault();
      const t = item();
      if (!t || !text.value.trim()) return;
      send.disabled = true;
      try {
        const c = await onComment(t, audio.currentTime, text.value.trim(), name.value.trim());
        (t.comments ||= []).push(c);
        text.value = "";
        listComments(); draw();
      } catch (error) { alert(error.message); } finally { send.disabled = false; }
    };
    addEventListener("resize", draw);
    document.addEventListener("keydown", (event) => {
      if (event.code === "Space" && item() && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName) && !document.querySelector("dialog[open]")) { event.preventDefault(); play.onclick(); }
    });
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("previoustrack", () => prev.onclick());
      navigator.mediaSession.setActionHandler("nexttrack", () => next.onclick());
    }

    return {
      audio,
      get item() { return item(); },
      get playing() { return !audio.paused; },
      play(items, i = 0, autoplay = true) {
        const same = item() && items[i] && items[i].key === item().key && items[i].url === item().url;
        list = items.slice();
        if (same) { index = i; listQueue(); if (autoplay) audio.play(); return; }
        go(i, autoplay);
      },
      toggle() { play.onclick(); },
      enqueue(t) { upNext.push(t); if (index < 0) { list = []; insertNext(upNext.shift()); } listQueue(); },
      openDetails() { if (sheet.hidden) toggleSheet(); },
      setAccent(color) {
        accent = color || "#E23444";
        for (const node of [pill, sheet, queue]) node.style.setProperty("--op-accent", accent);
        draw();
      },
      redraw() { if (item()) { listComments(); draw(); } },
    };
  }

  /** La forme d'onde (600 valeurs entre 0 et 1) et la durée d'un fichier, lus dans le navigateur ; null si le format ne se décode pas. */
  async function peaksOf(file) {
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      context.close();
      const data = buffer.getChannelData(0), n = 600, size = Math.max(1, Math.floor(data.length / n)), peaks = [];
      for (let i = 0; i < n; i++) {
        let max = 0;
        for (let j = i * size, end = Math.min(data.length, j + size); j < end; j += 4) max = Math.max(max, Math.abs(data[j]));
        peaks.push(max);
      }
      const top = Math.max(...peaks) || 1;
      return { peaks: peaks.map((p) => Math.round(p / top * 1000) / 1000), duration: buffer.duration };
    } catch {
      return null;
    }
  }

  /** Les couleurs d'une pochette : la teinte dominante (pondérée par sa saturation), éclaircie pour l'accent, assombrie
   *  pour le fond. Une pochette en noir et blanc donne un thème gris. null si l'image ne se lit pas. */
  function tint(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = c.height = 40;
          const g = c.getContext("2d", { willReadFrequently: true });
          g.drawImage(img, 0, 0, 40, 40);
          const px = g.getImageData(0, 0, 40, 40).data;
          let x = 0, y = 0, weight = 0, sat = 0, n = 0;
          for (let i = 0; i < px.length; i += 4) {
            const [h, s, l] = hsl(px[i], px[i + 1], px[i + 2]);
            const w = s * (1 - Math.abs(l - 0.5) * 1.6);
            if (w > 0) { x += Math.cos(h * 2 * Math.PI) * w; y += Math.sin(h * 2 * Math.PI) * w; weight += w; }
            sat += s; n++;
          }
          const hue = Math.round(((Math.atan2(y, x) / (2 * Math.PI)) + 1) % 1 * 360);
          const grey = weight / n < 0.06 || sat / n < 0.1;
          resolve(grey
            ? { accent: "hsl(0 0% 82%)", glow: "hsla(0, 0%, 55%, .55)", deep: "hsla(0, 0%, 20%, .5)" }
            : { accent: `hsl(${hue} 78% 62%)`, glow: `hsla(${hue}, 80%, 40%, .8)`, deep: `hsla(${hue}, 90%, 18%, .5)` });
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  function hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  const stageLabel = (s) => (s === "maquette" ? "Maquette" : s === "final" ? "Final" : /^v\d+$/.test(s || "") ? s.toUpperCase() : "");

  const releaseLabel = (day) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || "");
    if (!m) return "";
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), today = new Date();
    today.setHours(0, 0, 0, 0);
    const text = date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    return date > today ? `Date de sortie prévue : ${text}` : `Date de sortie : ${text}`;
  };

  window.OniriquePlayer = { create, peaksOf, time, icon, tint, stageLabel, releaseLabel };
})();
