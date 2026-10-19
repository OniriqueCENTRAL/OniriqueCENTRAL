// Le lecteur de « Mes sons », commun à mes-sons.html (le membre) et ecoute.html (l'auditeur d'un lien) :
// une barre fixe en bas de page avec la forme d'onde (cliquer pour aller à un moment), les commentaires placés
// dessus, la vitesse (hauteur gardée ou non), et une boucle entre deux points.
//
//   const player = OniriquePlayer.create({ onPlay(track), onComment(track, at, text, name) → Promise<comment>, askName, onDelete(track, comment) → Promise })
//   player.load(track, autoplay)   track : { id, title, subtitle, url, downloadUrl, duration, peaks, comments }
//   OniriquePlayer.peaksOf(file)   → Promise<{ peaks, duration }>, calculés dans le navigateur à l'envoi
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

  const css = `
.op-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; background: rgba(13,8,9,.94); backdrop-filter: blur(14px); border-top: 1px solid var(--line); padding: 12px 0 calc(12px + env(safe-area-inset-bottom)); }
.op-bar[hidden], .op-comments[hidden] { display: none; }
.op-in { width: 100%; max-width: 1180px; margin-inline: auto; padding-inline: clamp(16px, 4vw, 40px); display: grid; gap: 10px; }
.op-top { display: flex; align-items: center; gap: 12px; min-width: 0; }
.op-play { flex: none; width: 46px; height: 46px; border-radius: 50%; border: 0; background: var(--mist); color: var(--night); font-size: 18px; cursor: pointer; }
.op-title { min-width: 0; flex: 1; }
.op-title b { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.op-title span { color: var(--haze); font-size: 13px; }
.op-time { font: 500 12px var(--f-mono); color: var(--haze); white-space: nowrap; }
.op-wave { width: 100%; height: 64px; display: block; cursor: pointer; touch-action: none; }
.op-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; font-size: 13px; color: var(--haze); }
.op-tools label { display: inline-flex; flex-direction: row; align-items: center; gap: 8px; font: 400 13px var(--f-body); letter-spacing: 0; text-transform: none; color: var(--haze); }
.op-tools input[type=range] { width: 120px; min-height: 0; }
.op-tools input[type=checkbox] { width: 16px; height: 16px; min-height: 0; margin: 0; accent-color: var(--ember); }
.op-chip { padding: 6px 11px; border-radius: 999px; border: 1px solid var(--line); background: none; color: var(--mist); font: 600 12px var(--f-body); cursor: pointer; }
.op-chip:hover { border-color: var(--ember); }
.op-chip.on { background: var(--ember); border-color: var(--ember); }
.op-comments { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 120px; overflow: auto; font-size: 14px; }
.op-comments li { display: flex; gap: 8px; align-items: baseline; }
.op-comments button.at { flex: none; font: 600 12px var(--f-mono); color: var(--ember); background: none; border: 0; padding: 0; cursor: pointer; }
.op-comments .who { color: var(--haze); }
.op-say { display: flex; flex-wrap: wrap; gap: 8px; }
.op-say input { flex: 1 1 200px; min-height: 38px; }
.op-say input.op-name { flex: 0 1 150px; }
@media (max-width: 640px) { .op-wave { height: 48px; } .op-comments { max-height: 80px; } }
`;

  function create({ onPlay, onComment, askName, onDelete } = {}) {
    document.head.append(el("style", { textContent: css }));
    const audio = new Audio();
    audio.preload = "metadata";
    const play = el("button", { className: "op-play", type: "button", ariaLabel: "Lecture" }, "▶");
    const title = el("b"), sub = el("span"), clock = el("span", { className: "op-time" });
    const download = el("a", { className: "op-chip", hidden: true, textContent: "Télécharger", style: "text-decoration:none" });
    const canvas = el("canvas", { className: "op-wave", ariaLabel: "Forme d'onde : cliquer pour aller à ce moment" });
    const speed = el("input", { type: "range", min: 50, max: 150, step: 5, value: 100 });
    const speedText = el("span", { textContent: "100 %" });
    const keepPitch = el("input", { type: "checkbox", checked: true });
    const loopA = el("button", { className: "op-chip", type: "button", textContent: "Début boucle" });
    const loopB = el("button", { className: "op-chip", type: "button", textContent: "Fin boucle" });
    const loopOff = el("button", { className: "op-chip", type: "button", textContent: "Sans boucle", hidden: true });
    const list = el("ul", { className: "op-comments" });
    const name = el("input", { className: "op-name", placeholder: "Ton nom", maxLength: 60, ariaLabel: "Ton nom" });
    const text = el("input", { placeholder: "Un commentaire à ce moment du titre…", maxLength: 1000, ariaLabel: "Commentaire" });
    const send = el("button", { className: "op-chip", type: "submit", textContent: "Commenter" });
    const say = el("form", { className: "op-say" }, askName ? name : null, text, send);
    const bar = el("div", { className: "op-bar", hidden: true },
      el("div", { className: "op-in" },
        el("div", { className: "op-top" }, play, el("div", { className: "op-title" }, title, sub), clock, download),
        canvas,
        el("div", { className: "op-tools" },
          el("label", {}, "Vitesse", speed, speedText),
          el("label", {}, keepPitch, "Garder la hauteur"),
          loopA, loopB, loopOff),
        list, onComment ? say : null));
    document.body.append(bar);

    let track = null, loop = null;
    const duration = () => (Number.isFinite(audio.duration) && audio.duration) || (track && track.duration) || 0;

    function draw() {
      const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w) return;
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      const g = canvas.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const d = duration(), progress = d ? audio.currentTime / d : 0;
      if (loop && d) { g.fillStyle = "rgba(226,52,68,.18)"; g.fillRect(loop.a / d * w, 0, ((loop.b ?? d) - loop.a) / d * w, h); }
      const peaks = (track && track.peaks && track.peaks.length) ? track.peaks : null;
      const bars = Math.max(1, Math.floor(w / 3));
      for (let i = 0; i < bars; i++) {
        const p = peaks ? peaks[Math.floor(i / bars * peaks.length)] : 0.08;
        const bh = Math.max(2, p * (h - 10));
        g.fillStyle = i / bars < progress ? "#E23444" : "rgba(246,238,238,.35)";
        g.fillRect(i * 3, (h - bh) / 2, 2, bh);
      }
      // Les commentaires : un point au-dessus de la forme d'onde.
      if (track && d) for (const c of track.comments || []) {
        g.fillStyle = "#FFECEE";
        g.beginPath(); g.arc(Math.min(w - 3, Math.max(3, c.at / d * w)), 3, 3, 0, 7); g.fill();
      }
    }
    function listComments() {
      list.replaceChildren(...(track.comments || []).slice().sort((a, b) => a.at - b.at).map((c) => el("li", {},
        el("button", { className: "at", type: "button", textContent: time(c.at), onclick: () => { audio.currentTime = c.at; audio.play(); } }),
        el("span", {}, el("span", { className: "who", textContent: c.author + " — " }), c.body),
        onDelete ? el("button", { className: "at", type: "button", textContent: "✕", ariaLabel: "Supprimer ce commentaire", onclick: async () => {
          if (!confirm("Supprimer ce commentaire ?")) return;
          try { await onDelete(track, c); track.comments.splice(track.comments.indexOf(c), 1); listComments(); draw(); } catch (error) { alert(error.message); }
        } }) : null)));
      list.hidden = !list.children.length;
    }
    function tick() {
      clock.textContent = time(audio.currentTime) + " / " + time(duration());
      if (loop && loop.b != null && audio.currentTime >= loop.b) audio.currentTime = loop.a;
      draw();
    }

    audio.addEventListener("timeupdate", tick);
    audio.addEventListener("loadedmetadata", tick);
    audio.addEventListener("play", () => { play.textContent = "❚❚"; play.ariaLabel = "Pause"; });
    audio.addEventListener("pause", () => { play.textContent = "▶"; play.ariaLabel = "Lecture"; });
    let counted = null;
    audio.addEventListener("playing", () => { if (onPlay && counted !== track.id) { counted = track.id; onPlay(track); } });
    audio.addEventListener("error", () => { sub.textContent = "Lecture impossible : recharge la page."; });
    play.onclick = () => (audio.paused ? audio.play() : audio.pause());
    const seek = (event) => {
      const r = canvas.getBoundingClientRect(), d = duration();
      if (d) { audio.currentTime = Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)) * d; tick(); }
    };
    canvas.addEventListener("pointerdown", (event) => { seek(event); canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener("pointermove", (event) => { if (event.buttons) seek(event); });
    const applySpeed = () => {
      audio.playbackRate = speed.value / 100;
      audio.preservesPitch = keepPitch.checked;
      speedText.textContent = speed.value + " %";
    };
    speed.oninput = applySpeed;
    keepPitch.onchange = applySpeed;
    const showLoop = () => { loopA.classList.toggle("on", !!loop); loopB.classList.toggle("on", !!(loop && loop.b != null)); loopOff.hidden = !loop; draw(); };
    loopA.onclick = () => { loop = { a: audio.currentTime, b: null }; showLoop(); };
    loopB.onclick = () => {
      if (!loop) loop = { a: 0, b: null };
      if (audio.currentTime > loop.a) loop.b = audio.currentTime;
      showLoop();
    };
    loopOff.onclick = () => { loop = null; showLoop(); };
    say.onsubmit = async (event) => {
      event.preventDefault();
      if (!text.value.trim()) return;
      send.disabled = true;
      try {
        const c = await onComment(track, audio.currentTime, text.value.trim(), name.value.trim());
        (track.comments ||= []).push(c);
        text.value = "";
        listComments(); draw();
      } catch (error) { alert(error.message); } finally { send.disabled = false; }
    };
    addEventListener("resize", draw);
    document.addEventListener("keydown", (event) => {
      if (event.code === "Space" && track && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName)) { event.preventDefault(); play.onclick(); }
    });

    return {
      audio,
      get track() { return track; },
      load(next, autoplay = true) {
        if (track && next.id === track.id && next.url === track.url) { if (autoplay) audio.play(); return; }
        track = next; loop = null;
        bar.hidden = false;
        document.body.style.paddingBottom = bar.offsetHeight + "px";
        title.textContent = next.title;
        sub.textContent = next.subtitle || "";
        download.hidden = !next.downloadUrl;
        if (next.downloadUrl) download.href = next.downloadUrl;
        audio.src = next.url;
        applySpeed(); showLoop(); listComments(); tick();
        document.body.style.paddingBottom = bar.offsetHeight + "px";
        if (autoplay) audio.play().catch(() => {});
      },
      redraw() { if (track) { listComments(); draw(); } },
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

  window.OniriquePlayer = { create, peaksOf, time };
})();
