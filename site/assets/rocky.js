// ROCKY, le chatbot IA du site : une bulle en bas à droite de chaque page (chargée par site-nav.js). Il répond par
// /api/rocky (server/src/rocky.js) et joue un petit accord à chaque réponse : il « parle » en musique.
(() => {
  if (document.getElementById("rocky")) return;
  const KEY = "rocky-chat";
  // Un caillou à carapace de roche en 3D (rendu Blender, tools/rocky), cinq pattes à trois doigts, braise dans les
  // sillons : son humeur change avec la conversation (assets/rocky/rocky-<humeur>.webp).
  const MOODS = ["idle", "wave", "thinking", "talk", "happy", "sad", "sleeping"];
  const src = (m) => `/assets/rocky/rocky-${m}.webp?v=7`;
  const AVATAR = `<img src="${src("idle")}" alt="">`;
  let state = "idle", nap, back, busy = false;
  const mood = (m, then, ms) => {
    clearTimeout(back);
    if (then) back = setTimeout(() => mood(...then), ms);
    if (m === state) return;
    state = m;
    root.querySelectorAll(".rk-av img, .rk-fab img, .rk-hello").forEach((i) => (i.src = src(m)));
  };
  // Sans qu'on lui parle pendant 40 s, Rocky s'endort (ZZzz) ; il se réveille dès qu'on s'approche ou qu'on écrit.
  const wake = () => {
    clearTimeout(nap);
    if (state === "sleeping" && !busy) mood("idle");
    nap = setTimeout(() => !busy && mood("sleeping"), 40000);
  };

  const css = document.createElement("style");
  css.textContent = `
  #rocky{position:fixed;right:18px;bottom:18px;z-index:9999;font:400 15px/1.5 "Hanken Grotesk","Segoe UI",system-ui,sans-serif;color:#F6EEEE}
  #rocky .rk-fab{width:62px;height:62px;border-radius:50%;border:1px solid rgba(255,210,214,.25);background:#1A080A;cursor:pointer;padding:2px;box-shadow:0 6px 24px rgba(0,0,0,.5),0 0 18px rgba(var(--acc, 229,56,74),.35)}
  #rocky .rk-fab:hover{transform:scale(1.06)}#rocky img{width:100%;height:100%;display:block}
  #rocky .rk-panel{position:absolute;right:0;bottom:76px;width:min(360px,calc(100vw - 36px));height:min(500px,calc(100vh - 120px));display:flex;flex-direction:column;background:#0D0809;border:1px solid rgba(255,210,214,.18);border-radius:18px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.6)}
  #rocky .rk-panel[hidden]{display:none}
  #rocky .rk-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#1A080A;border-bottom:1px solid rgba(255,210,214,.12)}
  #rocky .rk-head .rk-av{width:38px;height:38px}#rocky .rk-head b{font:700 15px "Unbounded","Arial Black",sans-serif;letter-spacing:.04em}
  #rocky .rk-head small{display:block;color:#B9A2A5;font-size:12px}
  #rocky .rk-close{margin-left:auto;background:none;border:0;color:#B9A2A5;font-size:22px;cursor:pointer}
  #rocky .rk-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px}
  #rocky .rk-hello{width:120px;height:120px;align-self:center;margin:-4px 0 -6px;flex:none}
  #rocky .rk-msg{max-width:85%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}
  #rocky .rk-bot{align-self:flex-start;background:#1A080A;border:1px solid rgba(255,210,214,.12)}
  #rocky .rk-me{align-self:flex-end;background:rgb(var(--acc, 229,56,74));color:#fff}
  #rocky .rk-bot a{color:rgb(var(--acc-hi, 255,142,154))}
  #rocky form{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,210,214,.12)}
  #rocky input{flex:1;min-width:0;background:#1A080A;border:1px solid rgba(255,210,214,.18);border-radius:12px;color:#F6EEEE;padding:10px 12px;font:inherit}
  #rocky form button{background:rgb(var(--acc, 229,56,74));color:#fff;border:0;border-radius:12px;padding:0 14px;font-weight:700;cursor:pointer}
  #rocky form button:disabled{opacity:.5}`;
  document.head.append(css);

  const root = document.createElement("div");
  root.id = "rocky";
  root.innerHTML = `<div class="rk-panel" role="dialog" aria-label="Discuter avec Rocky" hidden>
      <div class="rk-head"><span class="rk-av">${AVATAR}</span><div><b>ROCKY</b><small>Assistant IA d'ONIRIQUE</small></div>
        <button class="rk-close" type="button" aria-label="Fermer">×</button></div>
      <div class="rk-log" aria-live="polite"></div>
      <form><input name="q" maxlength="1000" autocomplete="off" placeholder="Écris à Rocky…" aria-label="Message pour Rocky"><button>Envoyer</button></form>
    </div>
    <button class="rk-fab" type="button" aria-label="Ouvrir le chat avec Rocky">${AVATAR}</button>`;
  document.body.append(root);
  ["pointerenter", "input", "focusin"].forEach((e) => root.addEventListener(e, wake));
  wake();
  const [panel, fab, log, form] = ["rk-panel", "rk-fab", "rk-log"].map((c) => root.querySelector("." + c)).concat(root.querySelector("form"));
  const input = form.q, send = form.querySelector("button");

  let history = [];
  try { history = JSON.parse(sessionStorage.getItem(KEY)) || []; } catch {}
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(history.slice(-12))); } catch {} };

  // Le texte reste du texte ; seuls les liens https deviennent cliquables.
  const add = (role, text) => {
    const div = document.createElement("div");
    div.className = "rk-msg " + (role === "user" ? "rk-me" : "rk-bot");
    text.split(/(https:\/\/[^\s)]+)/).forEach((part, i) => {
      if (i % 2) { const a = document.createElement("a"); a.href = a.textContent = part.replace(/[.,!?]+$/, ""); div.append(a, part.slice(a.textContent.length)); }
      else div.append(part);
    });
    log.append(div);
    log.scrollTop = log.scrollHeight;
    return div;
  };

  // Un accord de trois notes, doux et court : la voix de Rocky.
  let audio;
  const chord = () => {
    try {
      audio ||= new AudioContext();
      const t = audio.currentTime, base = 220 * 2 ** (Math.floor(Math.random() * 7) / 12);
      [1, 1.26, 1.5].forEach((ratio, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = "triangle"; o.frequency.value = base * ratio;
        g.gain.setValueAtTime(0, t + i * .07); g.gain.linearRampToValueAtTime(.06, t + i * .07 + .02); g.gain.exponentialRampToValueAtTime(.0001, t + i * .07 + .5);
        o.connect(g).connect(audio.destination); o.start(t + i * .07); o.stop(t + i * .07 + .55);
      });
    } catch {}
  };

  const open = (show) => {
    if (show) MOODS.forEach((m) => (new Image().src = src(m))); // pas de trou au changement d'humeur
    panel.hidden = !show;
    if (show && !busy) mood("wave", ["idle"], 2400); // il salue quand on ouvre
    if (show && !log.childElementCount) {
      log.append(Object.assign(document.createElement("img"), { className: "rk-hello", src: src(state), alt: "" }));
      add("assistant", "Salut, ami ! Moi Rocky. Je connais le site ONIRIQUE bien bien bien. Tu cherches quoi, question ?");
      history.forEach((m) => add(m.role, m.content));
    }
    if (show) input.focus();
  };
  fab.addEventListener("click", () => open(panel.hidden));
  // Les boutons « Demande à ROCKY » des pages (data-rocky-open) ouvrent la discussion.
  document.addEventListener("click", (e) => { if (e.target.closest("[data-rocky-open]")) { e.preventDefault(); open(true); } });
  root.querySelector(".rk-close").addEventListener("click", () => open(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) open(false); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || send.disabled) return;
    input.value = "";
    add("user", text);
    history.push({ role: "user", content: text });
    send.disabled = busy = true;
    clearTimeout(nap);
    const wait = add("assistant", "…");
    mood("thinking");
    try {
      const r = await fetch("/api/rocky", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history }) });
      const data = await r.json().catch(() => ({}));
      wait.remove();
      if (!r.ok) { mood("sad", ["idle"], 4000); add("assistant", data.error || "Rocky n'entend plus rien. Réessaie, ami."); history.pop(); return; }
      add("assistant", data.reply);
      history.push({ role: "assistant", content: data.reply });
      chord();
      mood("talk", ["happy", ["idle"], 1600], 2000); // il dit sa réponse, puis il est content
    } catch {
      wait.remove();
      mood("sad", ["idle"], 4000);
      add("assistant", "Pas de réseau, ami. Réessaie.");
      history.pop();
    } finally {
      save();
      send.disabled = busy = false;
      nap = setTimeout(() => mood("sleeping"), 40000);
      input.focus();
    }
  });
})();
