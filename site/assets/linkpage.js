// Affichage d'une page de liens de fondateur : la page publique (/l/<pseudo>) et l'aperçu de l'éditeur (mes-liens.html)
// passent par le même rendu. Les choix d'apparence sont ceux que le serveur accepte (server/src/linkpage.js).
(function () {
  const FONTS = {
    unbounded: ["Unbounded", "'Unbounded', sans-serif"],
    grenze: ["Grenze Gotisch", "'Grenze Gotisch', serif"],
    hanken: ["Hanken Grotesk", "'Hanken Grotesk', sans-serif"],
    mono: ["JetBrains Mono", "'JetBrains Mono', monospace"],
    system: ["Système", "system-ui, -apple-system, 'Segoe UI', sans-serif"],
    serif: ["Classique", "Georgia, 'Times New Roman', serif"],
  };

  // Points de départ de l'éditeur ; chaque réglage se change ensuite un par un.
  const PRESETS = {
    nuit: { label: "Nuit & sang", theme: { bg: "gradient", bg1: "#0d0809", bg2: "#4a0d16", angle: 160, text: "#f6eeee", font: "hanken", titleFont: "unbounded", button: { style: "glass", shape: "pill", color: "#e23444", text: "#ffffff", shadow: true } } },
    braise: { label: "Braise", theme: { bg: "gradient", bg1: "#140604", bg2: "#6b1d07", angle: 200, text: "#fff1e8", font: "hanken", titleFont: "grenze", button: { style: "fill", shape: "round", color: "#ff6a2b", text: "#1a0703", shadow: true } } },
    clair: { label: "Clair", theme: { bg: "color", bg1: "#f4efe9", bg2: "#e6dcd2", angle: 180, text: "#1b1214", font: "hanken", titleFont: "unbounded", button: { style: "outline", shape: "pill", color: "#1b1214", text: "#1b1214", shadow: false } } },
    neon: { label: "Néon", theme: { bg: "gradient", bg1: "#05060f", bg2: "#2a0f5c", angle: 135, text: "#f1ecff", font: "mono", titleFont: "unbounded", button: { style: "fill", shape: "square", color: "#8a5cff", text: "#ffffff", shadow: true } } },
    gothique: { label: "Gothique", theme: { bg: "color", bg1: "#000000", bg2: "#1a1a1a", angle: 180, text: "#e8e1d9", font: "serif", titleFont: "grenze", button: { style: "outline", shape: "square", color: "#e8e1d9", text: "#e8e1d9", shadow: false } } },
  };

  const CSS = `
.lp, .lp * { box-sizing: border-box; }
.lp { position: relative; min-height: 100%; color: var(--lp-text); font-family: var(--lp-font); overflow: hidden; isolation: isolate; }
.lp-bg { position: absolute; inset: 0; z-index: -1; background: var(--lp-bg); background-size: cover; background-position: center; }
.lp-bg::after { content: ""; position: absolute; inset: 0; background: rgba(0,0,0,var(--lp-dim)); }
.lp-inner { max-width: 580px; margin: 0 auto; padding: 56px 18px 40px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 14px; }
.lp-avatar { width: 104px; height: 104px; object-fit: cover; border-radius: 50%; box-shadow: 0 10px 34px -12px rgba(0,0,0,.7); }
.lp-avatar.square { border-radius: 22px; }
.lp-name { margin: 6px 0 0; font: 700 clamp(22px, 6vw, 30px)/1.15 var(--lp-title); letter-spacing: .01em; overflow-wrap: anywhere; }
.lp-bio { margin: 0; max-width: 46ch; font-size: 15px; line-height: 1.5; opacity: .86; white-space: pre-line; overflow-wrap: anywhere; }
.lp-icons { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; margin: 4px 0 6px; }
.lp-icons a { display: grid; place-items: center; width: 40px; height: 40px; color: var(--lp-text); border-radius: 50%; transition: transform .15s; }
.lp-icons a:hover, .lp-icons a:focus-visible { transform: scale(1.12); outline: none; }
.lp-icon { width: 24px; height: 24px; flex: none; background: currentColor; -webkit-mask: var(--icon) center / contain no-repeat; mask: var(--icon) center / contain no-repeat; }
.lp-links { width: 100%; display: grid; gap: 14px; margin-top: 6px; }
.lp-btn { position: relative; display: flex; align-items: center; justify-content: center; min-height: 58px; padding: 14px 54px; text-decoration: none; font: 600 15.5px/1.3 var(--lp-font); color: var(--lp-btn-text); border: 2px solid var(--lp-btn); border-radius: var(--lp-radius); transition: transform .15s, filter .15s; overflow-wrap: anywhere; }
.lp-btn .lp-icon { position: absolute; left: 18px; top: 50%; margin-top: -12px; }
.lp-btn:hover, .lp-btn:focus-visible { transform: translateY(-2px) scale(1.01); filter: brightness(1.08); outline: none; }
.lp-btn.fill { background: var(--lp-btn); }
.lp-btn.outline { background: transparent; }
.lp-btn.glass { background: color-mix(in srgb, var(--lp-btn) 22%, transparent); border-color: color-mix(in srgb, var(--lp-btn) 70%, transparent); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
.lp.shadow .lp-btn { box-shadow: 0 10px 26px -14px rgba(0,0,0,.85); }
.lp-foot { margin-top: 26px; font: 600 11px/1 'JetBrains Mono', monospace; letter-spacing: .2em; text-transform: uppercase; color: var(--lp-text); opacity: .55; text-decoration: none; }
.lp-foot:hover { opacity: .9; }
.lp-empty { opacity: .6; font-size: 14px; }
.lp-btn .lp-more { position: absolute; right: 20px; top: 50%; width: 9px; height: 9px; margin-top: -7px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg); opacity: .8; }
.lp-sheet { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-end; justify-content: center; }
.lp.preview .lp-sheet { position: absolute; }
.lp-sheet-back { position: absolute; inset: 0; background: rgba(0,0,0,.6); animation: lp-fade .2s ease-out; }
.lp-sheet-card { position: relative; width: 100%; max-width: 480px; max-height: 86%; overflow: auto; padding: 22px 18px calc(22px + env(safe-area-inset-bottom)); border-radius: 26px 26px 0 0;
  background: color-mix(in srgb, var(--lp-sheet) 92%, #000); color: var(--lp-text); text-align: center; animation: lp-rise .25s ease-out; box-shadow: 0 -20px 60px -20px rgba(0,0,0,.8); }
@keyframes lp-fade { from { opacity: 0; } }
@keyframes lp-rise { from { transform: translateY(40px); opacity: 0; } }
.lp-sheet-close { position: absolute; right: 12px; top: 12px; width: 36px; height: 36px; border-radius: 50%; border: 0; background: rgba(255,255,255,.08); color: inherit; font-size: 15px; cursor: pointer; }
.lp-sheet-cover { width: 120px; height: 120px; border-radius: 14px; object-fit: cover; box-shadow: 0 14px 34px -14px rgba(0,0,0,.9); }
.lp-sheet-cover.artist { border-radius: 50%; }
.lp-sheet-title { margin: 12px 0 0; font: 700 18px/1.25 var(--lp-title); overflow-wrap: anywhere; }
.lp-sheet-artist { margin: 4px 0 0; font-size: 14px; opacity: .75; }
.lp-sheet-list { display: grid; gap: 8px; margin-top: 18px; text-align: left; }
.lp-plat { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--lp-text) 16%, transparent); color: inherit; text-decoration: none; font: 600 15px/1.2 var(--lp-font); }
.lp-plat:hover, .lp-plat:focus-visible { background: color-mix(in srgb, var(--lp-text) 8%, transparent); outline: none; }
.lp-plat b { flex: 1; font-weight: 600; }
.lp-plat em { font: 600 11px/1 'JetBrains Mono', monospace; font-style: normal; letter-spacing: .12em; text-transform: uppercase; padding: 8px 12px; border-radius: 999px; background: var(--lp-btn); color: var(--lp-btn-text); }`;

  function injectCss() {
    if (document.getElementById("lp-css")) return;
    document.head.append(Object.assign(document.createElement("style"), { id: "lp-css", textContent: CSS }));
  }

  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter(Boolean));
    return node;
  };
  const icon = (id) => {
    const span = el("span", { className: "lp-icon" });
    span.setAttribute("aria-hidden", "true");
    span.style.setProperty("--icon", `url("/assets/icons/${id}.svg")`);
    return span;
  };

  /** Dessine la page dans root. media : { avatar, background } (adresses des images) ; preview : clics coupés ;
      handle : la page publique, dont les clics sont comptés (statistiques du fondateur). */
  function render(root, page, media = {}, preview = false, handle = null) {
    injectCss();
    const t = page.theme;
    const DL = window.OniriqueDeepLink;
    const background = t.bg === "image" && media.background ? `url("${media.background}?w=1280") center / cover`
      : t.bg === "gradient" ? `linear-gradient(${t.angle}deg, ${t.bg1}, ${t.bg2})` : t.bg1;
    const lp = el("div", { className: "lp" + (t.button.shadow ? " shadow" : "") + (preview ? " preview" : "") });
    const vars = { "--lp-bg": background, "--lp-dim": t.bg === "image" && media.background ? t.dim / 100 : 0, "--lp-text": t.text,
      "--lp-font": FONTS[t.font][1], "--lp-title": FONTS[t.titleFont][1], "--lp-btn": t.button.color, "--lp-btn-text": t.button.text,
      "--lp-radius": { square: "6px", round: "16px", pill: "999px" }[t.button.shape], "--lp-sheet": t.bg1 };
    for (const [k, v] of Object.entries(vars)) lp.style.setProperty(k, v);

    // Envoyé même si la page est quittée aussitôt (ouverture de l'application).
    const beacon = (link) => { if (handle && navigator.sendBeacon) navigator.sendBeacon(`/api/links/${encodeURIComponent(handle)}/click`, new Blob([JSON.stringify({ id: link.id })], { type: "application/json" })); };
    const openUrl = (url, event) => { if (DL && DL.open(url)) event.preventDefault(); };
    const go = (link) => (event) => {
      if (preview) return event.preventDefault();
      beacon(link);
      openUrl(link.url, event);
    };

    // Lien « Musique » : un panneau où le visiteur choisit sa plateforme d'écoute (ouvert aussi dans l'aperçu).
    function chooser(link) {
      const m = link.music;
      const close = () => { sheet.remove(); document.removeEventListener("keydown", onKey); };
      const onKey = (event) => { if (event.key === "Escape") close(); };
      const names = Object.fromEntries((DL ? DL.APPS : []).map((a) => [a.id, a.name]));
      const shut = el("button", { className: "lp-sheet-close", type: "button", textContent: "✕" });
      shut.setAttribute("aria-label", "Fermer");
      shut.onclick = close;
      const list = m.platforms.map((p) => {
        const a = el("a", { className: "lp-plat", href: p.url, target: "_blank", rel: "noopener" }, icon(p.id),
          el("b", { textContent: names[p.id] || p.id }), el("em", { textContent: m.type === "artist" ? "Voir" : "Écouter" }));
        a.onclick = (event) => { if (preview) return event.preventDefault(); beacon(link); openUrl(p.url, event); };
        return a;
      });
      const back = el("div", { className: "lp-sheet-back" });
      back.onclick = close;
      const sheet = el("div", { className: "lp-sheet" }, back, el("div", { className: "lp-sheet-card" }, shut,
        m.cover ? el("img", { className: "lp-sheet-cover" + (m.type === "artist" ? " artist" : ""), src: m.cover, alt: "" }) : null,
        el("p", { className: "lp-sheet-title", textContent: m.title }),
        m.artist && m.type !== "artist" ? el("p", { className: "lp-sheet-artist", textContent: m.artist }) : null,
        el("div", { className: "lp-sheet-list" }, ...list)));
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
      sheet.setAttribute("aria-label", (m.type === "artist" ? "Voir " : "Écouter ") + m.title);
      document.addEventListener("keydown", onKey);
      lp.append(sheet);
      shut.focus();
    }
    const visible = page.links.filter((l) => l.on);
    const platform = (l) => (DL && DL.platformOf(l.url)) || { id: "link", name: "" };
    const icons = visible.filter((l) => l.kind === "icon").map((l) => {
      const p = platform(l);
      const a = el("a", { href: l.url, target: "_blank", rel: "noopener", title: l.label || p.name }, icon(p.id));
      a.setAttribute("aria-label", l.label || p.name || l.url);
      a.onclick = go(l);
      return a;
    });
    const buttons = visible.filter((l) => l.kind !== "icon").map((l) => {
      const p = platform(l);
      const music = l.kind === "music" && l.music && l.music.platforms.length;
      const a = el("a", { className: "lp-btn " + t.button.style, href: l.url, target: "_blank", rel: "noopener" }, icon(music ? "music" : p.id),
        el("span", { textContent: l.label || (music ? l.music.title : "") || p.name || l.url.replace(/^https?:\/\//, "") }), music ? el("i", { className: "lp-more" }) : null);
      // Sans plateformes trouvées, un lien « Musique » s'ouvre comme un lien ordinaire.
      a.onclick = music ? (event) => { event.preventDefault(); chooser(l); } : go(l);
      return a;
    });
    const avatar = media.avatar ? el("img", { className: "lp-avatar" + (t.avatarShape === "square" ? " square" : ""), src: `${media.avatar}?w=320`, alt: page.name }) : null;
    const foot = el("a", { className: "lp-foot", href: "https://onirique.store", textContent: "✦ ONIRIQUE" });
    if (preview) foot.onclick = (e) => e.preventDefault();
    lp.append(el("div", { className: "lp-bg" }), el("div", { className: "lp-inner" },
      avatar,
      page.name ? el("h1", { className: "lp-name", textContent: page.name }) : null,
      page.bio ? el("p", { className: "lp-bio", textContent: page.bio }) : null,
      icons.length ? el("div", { className: "lp-icons" }, ...icons) : null,
      buttons.length ? el("div", { className: "lp-links" }, ...buttons) : null,
      !icons.length && !buttons.length && preview ? el("p", { className: "lp-empty", textContent: "Ajoute un premier lien pour le voir ici." }) : null,
      foot));
    root.replaceChildren(lp);
  }

  window.OniriqueLinkPage = { FONTS, PRESETS, render };
})();
