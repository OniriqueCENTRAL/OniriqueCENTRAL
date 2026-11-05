// Le mini ROCKY bâtisseur, dans l'application ONIRIQUE CENTRAL : quand on crée une playlist, un pack, un projet ou un
// dossier, ou qu'on ajoute un son, il apparaît en bas à gauche. Sa patte de droite tient la carte de la playlist, sa
// patte du haut y glisse les lignes une à une, puis il sautille. Même dessin que la bulle du site (assets/rocky/*.svg).
// Branché sur api() et upload() de mes-sons.html.
//   RockyBuild.fromApi("POST", "/me/sounds/projects", { kind: "playlist" })   → choisit l'animation d'après l'appel
//   RockyBuild.play("playlist" | "pack" | "project" | "folder" | "add")
(() => {
  const DARK = "#4a3626", STONE = "#9c7a58", SEAM = "#5e4532", JOINT = "#7d6046", HAND = "#8a6a4c", EMBER = "#E23444";
  const KINDS = {
    playlist: { n: 3, label: "Playlist construite !" },
    pack: { n: 3, label: "Pack construit !" },
    project: { n: 3, label: "Projet construit !" },
    folder: { n: 2, label: "Dossier rangé !", folder: true },
    add: { n: 1, label: "Son ajouté !" },
  };

  // Une patte : deux segments de pierre, l'articulation, la main en bloc. Comme dans assets/rocky/rocky-idle.svg.
  const limb = ([ax, ay], [bx, by], [cx, cy], rot, joint = JOINT) => {
    const seg = (x1, y1, x2, y2) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${DARK}" stroke-width="14"/><path d="M${x1} ${y1}L${x2} ${y2}" stroke="${STONE}" stroke-width="9"/>`;
    return `<g stroke-linecap="round">${seg(ax, ay, bx, by)}${seg(bx, by, cx, cy)}</g>
      <circle cx="${bx}" cy="${by}" r="5.2" fill="${joint}" stroke="${DARK}" stroke-width="2"/>
      <rect x="${cx - 7}" y="${cy - 6}" width="14" height="12" rx="4" fill="${HAND}" stroke="${DARK}" stroke-width="2.4" transform="rotate(${rot} ${cx} ${cy})"/>
      <path d="M${cx - 2} ${cy - 5}v10" stroke="${SEAM}" stroke-width="1.3" transform="rotate(${rot} ${cx} ${cy})"/>`;
  };
  const NOTE = '<g fill="#E23444"><ellipse cx="0" cy="8" rx="4" ry="3" transform="rotate(-20 0 8)"/><rect x="2.6" y="-6" width="1.8" height="14"/><path d="M4.4 -6q6 2 5 8q-1-4-5-4z"/></g>';

  // La carte de la playlist, tenue à bout de patte : un en-tête et trois lignes.
  const CARD = { x: 100, y: 14, w: 50, h: 54 };
  const rowY = (i) => CARD.y + 14 + i * 12.5;
  const row = (i, fresh, plus) => `<g class="rb-row" data-i="${i}" ${fresh ? 'opacity="0"' : 'opacity=".45"'}>
      <rect x="${CARD.x + 4}" y="${rowY(i)}" width="${CARD.w - 8}" height="10" rx="2.5" fill="${fresh ? "#3a1015" : "#24090c"}" stroke="${EMBER}" stroke-width="1.2"/>
      ${plus ? `<path d="M${CARD.x + 10} ${rowY(i) + 2.4}v5.2M${CARD.x + 7.4} ${rowY(i) + 5}h5.2" stroke="#FFECEE" stroke-width="1.5" stroke-linecap="round"/>`
        : `<circle cx="${CARD.x + 10}" cy="${rowY(i) + 5}" r="2.2" fill="${EMBER}"/>`}
      <path d="M${CARD.x + 16} ${rowY(i) + 3.6}h${CARD.w - 26}M${CARD.x + 16} ${rowY(i) + 6.6}h${CARD.w - 34}" stroke="#FFECEE" stroke-width="1.3" stroke-linecap="round" opacity=".85"/></g>`;

  function scene(kind) {
    const k = KINDS[kind], pre = 3 - k.n;
    const { x, y, w, h } = CARD;
    const tab = k.folder ? `<path d="M${x} ${y + 4}V${y - 2}a2 2 0 0 1 2-2h12l4 6Z" fill="#1A080A" stroke="${EMBER}" stroke-width="1.6" stroke-linejoin="round"/>` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 170 128" fill="none" aria-hidden="true">
      <ellipse cx="64" cy="108" rx="34" ry="5" fill="#000" opacity=".35"/>
      <g class="rb-all">
        <g class="rb-l2">${limb([73.4, 72.9], [84.6, 88.3], [87.5, 105.1], 75)}</g>
        <g class="rb-l3">${limb([54.6, 72.9], [43.4, 88.3], [40.5, 105.1], 105)}</g>
        <g class="rb-l4">${limb([48.8, 55.1], [30.7, 49.2], [14, 52.1], 170)}</g>
        <path d="M64 33 87 43.8 89.7 68.1 76.2 84.3 51.9 84.3 38.3 68.1 41 43.8Z" fill="#8f6f50" stroke="${DARK}" stroke-width="2.6" stroke-linejoin="round"/>
        <path d="M64 33 87 43.8 69.4 54.6Z" fill="#b38f69"/><path d="M41 43.8 64 33 69.4 54.6 53.2 60Z" fill="#a17f5d"/>
        <path d="M38.3 68.1 53.2 60 51.9 84.3Z" fill="#735840"/><path d="M89.7 68.1 76.2 84.3 69.4 68.1Z" fill="#6a503a"/>
        <path d="M55.9 41.1 61.3 51.9 54.5 62.7 60 73.5" stroke="${DARK}" stroke-width="1.4"/><path d="M74.8 49.2 80.2 60 76.2 70.8" stroke="${DARK}" stroke-width="1.2"/>
        <path class="rb-ember" d="M61.3 51.9 68 60 66.7 68.1" stroke="${EMBER}" stroke-width="1.6"/>
        <g class="rb-card">${tab}
          <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="#1A080A" stroke="${EMBER}" stroke-width="1.8"/>
          <g transform="translate(${x + 7} ${y + 2.5}) scale(.45)">${NOTE}</g>
          <path d="M${x + 15} ${y + 7}h${w - 24}" stroke="#FFECEE" stroke-width="2" stroke-linecap="round"/>
          ${[0, 1, 2].map((i) => row(i, i >= pre, kind === "add" && i >= pre)).join("")}
        </g>
        <g class="rb-l1">${limb([79.2, 55.1], [97.3, 55.2], [112, 67.5], 35, "#5fae86")}</g>
        <g class="rb-l0">${limb([64, 44], [64, 25], [69.8, 9], -70)}</g>
      </g>
      ${[0, 1, 2].map((i) => `<g class="rb-note" opacity="0"><g transform="translate(${x + 8 + i * 15} ${y - 6}) scale(${0.7 - i * 0.12})">${NOTE}</g></g>`).join("")}
    </svg>`;
  }

  const css = `#rocky-builder{position:fixed;left:18px;bottom:14px;z-index:9998;width:200px;pointer-events:none;font:600 13px/1.3 "Hanken Grotesk","Segoe UI",system-ui,sans-serif}
    #rocky-builder svg{display:block;width:100%;overflow:visible;filter:drop-shadow(0 6px 14px rgba(0,0,0,.45))}
    #rocky-builder svg *{transform-box:view-box}
    #rocky-builder .rb-say{position:absolute;left:112px;top:-14px;white-space:nowrap;padding:5px 10px;border-radius:999px;background:#E23444;color:#fff;opacity:0;box-shadow:0 4px 14px rgba(226,52,68,.4)}`;

  let playing = null;
  function play(kind = "add") {
    if (!KINDS[kind] || playing || document.hidden) return;
    if (!document.getElementById("rocky-builder-css")) document.head.append(Object.assign(document.createElement("style"), { id: "rocky-builder-css", textContent: css }));
    const box = Object.assign(document.createElement("div"), { id: "rocky-builder", innerHTML: scene(kind) + `<div class="rb-say">${KINDS[kind].label}</div>` });
    box.setAttribute("aria-hidden", "true");
    document.body.append(box);
    const $ = (s) => box.querySelector(s), $$ = (s) => [...box.querySelectorAll(s)];
    const n = KINDS[kind].n, pre = 3 - n, STEP = 600, START = 650;
    const end = START + n * STEP, TOTAL = end + 1500;
    // Une animation sur toute la durée : des images clés placées en millisecondes, adoucies entre elles.
    const anim = (node, origin, frames) => {
      if (!node) return;
      if (origin) node.style.transformOrigin = origin;
      const kf = frames.map(([ms, f]) => ({ offset: Math.min(1, Math.max(0, ms / TOTAL)), easing: "cubic-bezier(.45,0,.25,1)", ...f }));
      if (kf[0].offset > 0) kf.unshift({ ...kf[0], offset: 0 });
      if (kf.at(-1).offset < 1) kf.push({ ...kf.at(-1), offset: 1 });
      node.animate(kf, { duration: TOTAL, fill: "both" });
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      $$(".rb-row").forEach((r) => r.setAttribute("opacity", 1));
      anim(box, null, [[0, { opacity: 0 }], [200, { opacity: 1 }], [TOTAL - 300, { opacity: 1 }], [TOTAL, { opacity: 0 }]]);
      anim($(".rb-say"), null, [[0, { opacity: 1 }]]);
    } else {
      // Arrivée par le bas avec un petit rebond, départ en glissant.
      anim(box, null, [[0, { opacity: 0, transform: "translateY(46px)" }], [300, { opacity: 1, transform: "translateY(-5px)" }],
        [430, { transform: "translateY(0)" }], [TOTAL - 380, { opacity: 1, transform: "translateY(0)" }], [TOTAL, { opacity: 0, transform: "translateY(30px)" }]]);
      // La carte sort de sa patte en grandissant, puis suit chaque petit coup.
      const card = [[150, { opacity: 0, transform: "scale(.3) rotate(-12deg)" }], [480, { opacity: 1, transform: "scale(1.06) rotate(2deg)" }], [620, { transform: "none" }]];
      const body = [[0, { transform: "none" }]], top = [[0, { transform: "rotate(0deg)" }]], hold = [[0, { transform: "rotate(0deg)" }]];
      for (let i = 0; i < n; i++) {
        const p = START + i * STEP, r = 62 + (pre + i) * 19; // l'angle où la main du haut arrive au bord de la ligne
        // La patte du haut prend une ligne au-dessus, la descend et la glisse dans la carte.
        top.push([p - 300, { transform: `rotate(${r - 40}deg)` }], [p - 140, { transform: `rotate(${r - 22}deg)` }],
          [p, { transform: `rotate(${r}deg)` }], [p + 120, { transform: `rotate(${r - 4}deg)` }], [p + 300, { transform: `rotate(${r - 30}deg)` }]);
        anim($(`.rb-row[data-i="${pre + i}"]`), `${CARD.x + 4}px ${rowY(pre + i) + 5}px`, [
          [p - 300, { opacity: 0, transform: "translate(-12px,-24px) rotate(-14deg) scale(.8)" }],
          [p - 160, { opacity: 1, transform: "translate(-8px,-12px) rotate(-6deg) scale(.95)" }],
          [p, { opacity: 1, transform: "translate(2px,0) rotate(0deg) scale(1.04,.9)" }],
          [p + 140, { opacity: 1, transform: "translate(-.5px,0) scale(.98,1.04)" }], [p + 260, { opacity: 1, transform: "none" }]]);
        // La patte qui tient la carte la remonte d'un coup sec pour la caler, et tout le corps suit.
        hold.push([p - 20, { transform: "rotate(0deg)" }], [p + 90, { transform: "rotate(-5deg)" }], [p + 240, { transform: "rotate(0deg)" }]);
        card.push([p - 20, { transform: "none" }], [p + 90, { transform: "translateY(-2.5px)" }], [p + 240, { transform: "none" }]);
        body.push([p - 140, { transform: "translateY(-1.5px) rotate(1.5deg)" }], [p + 90, { transform: "translateY(1px) rotate(-1deg)" }], [p + 360, { transform: "none" }]);
      }
      // Fini : deux sauts de joie, les pattes libres en l'air, des notes qui s'envolent de la carte.
      body.push([end + 120, { transform: "translateY(-9px)" }], [end + 280, { transform: "translateY(0) scale(1.04,.96)" }],
        [end + 440, { transform: "translateY(-7px)" }], [end + 620, { transform: "none" }]);
      top.push([end, { transform: "rotate(20deg)" }], [end + 160, { transform: "rotate(-16deg)" }], [end + 340, { transform: "rotate(12deg)" }],
        [end + 520, { transform: "rotate(-12deg)" }], [end + 760, { transform: "rotate(0deg)" }]);
      anim($(".rb-all"), "64px 110px", body);
      anim($(".rb-l0"), "64px 44px", top);
      anim($(".rb-l1"), "79px 55px", hold);
      anim($(".rb-card"), `${CARD.x + CARD.w / 2}px ${CARD.y + CARD.h}px`, card);
      anim($(".rb-l4"), "49px 55px", [[0, { transform: "rotate(0deg)" }], [end + 160, { transform: "rotate(42deg)" }],
        [end + 340, { transform: "rotate(20deg)" }], [end + 520, { transform: "rotate(42deg)" }], [end + 780, { transform: "rotate(0deg)" }]]);
      anim($(".rb-ember"), null, [[0, { opacity: 1 }], [end, { opacity: .4 }], [end + 200, { opacity: 1 }], [end + 500, { opacity: .5 }], [end + 800, { opacity: 1 }]]);
      $$(".rb-note").forEach((note, i) => anim(note, null, [[end + i * 160, { opacity: 0, transform: "translateY(0)" }],
        [end + i * 160 + 200, { opacity: 1 }], [end + i * 160 + 1000, { opacity: 0, transform: `translate(${i * 4 - 4}px,-24px)` }]]));
      anim($(".rb-say"), null, [[end, { opacity: 0, transform: "translateY(6px) scale(.9)" }], [end + 200, { opacity: 1, transform: "translateY(0) scale(1)" }],
        [TOTAL - 400, { opacity: 1 }], [TOTAL - 200, { opacity: 0 }]]);
    }
    playing = setTimeout(() => { box.remove(); playing = null; }, TOTAL + 50);
  }

  // L'appel réussi qui vient d'être fait → l'animation qui lui va (rien pour les autres appels).
  function kindOf(method, path, body) {
    if (method !== "POST") return null;
    path = path.split("?")[0];
    if (path === "/me/sounds/projects") return KINDS[body && body.kind] ? body.kind : "project";
    if (path === "/me/sounds/folders") return "folder";
    if (/^\/me\/sounds\/(tracks\/\d+\/(add|duplicate|versions)|projects\/\d+\/(tracks|platform-items))$/.test(path)) return "add";
    return null;
  }
  // Seulement dans l'application (son preload y pose oniriqueApp), pas sur le site.
  const inApp = () => !!(window.oniriqueApp || window.oniriqueDialog);
  window.RockyBuild = { play, kindOf, fromApi: (method, path, body) => { const k = inApp() && kindOf(method, path, body); if (k) play(k); } };
})();
