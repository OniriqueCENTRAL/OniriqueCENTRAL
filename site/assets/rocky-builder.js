// Le mini ROCKY bâtisseur, dans l'application ONIRIQUE CENTRAL : quand on crée une playlist, un pack, un projet ou un
// dossier, ou qu'on ajoute des sons, il arrive en marchant depuis le bord gauche, sort la carte de la playlist, y glisse
// les sons un par un (la liste défile quand elle est longue, un compteur monte), sautille, puis traverse l'écran avec sa
// carte et s'en va à droite. Tant que des sons arrivent (envoi de plusieurs fichiers, import Spotify), il continue.
// Même ROCKY en 3D que la bulle du site : planches d'images rendues dans Blender (tools/rocky), marche, travail, saut ;
// la carte est dessinée par-dessus, calée sur la patte qui la tient. Branché sur api() et upload() de mes-sons.html.
//   RockyBuild.fromApi("POST", "/me/sounds/projects/4/platform-items", { items: [...] })  → choisit l'animation
//   RockyBuild.play("playlist" | "pack" | "project" | "folder" | "add", nombreDeSons)
(() => {
  const EMBER = "#E23444";
  const KINDS = {
    playlist: { decor: 3, label: "Playlist construite !" },
    pack: { decor: 3, label: "Pack construit !" },
    project: { decor: 3, label: "Projet construit !" },
    folder: { decor: 2, label: "Dossier rangé !", folder: true },
    add: { decor: 0, label: "Son ajouté !" },
  };
  const MAX_ROWS = 14; // au-delà, chaque ligne posée compte pour plusieurs sons : une longue playlist ne dure pas une minute
  const VISIBLE = 3;   // lignes visibles dans la carte ; les suivantes font défiler la liste

  // Les planches : 12 images de 168 px côte à côte (2x pour les écrans fins), lues avec steps().
  const FRAME = 168, SRC = (name) => `/assets/rocky/rocky-${name}.webp?v=7`, SHEET = (name) => `url(${SRC(name)})`;
  const SPRITE = { x: -17, y: -13 }; // place de l'image dans la scène (px) : sa patte droite tient le coin de la carte
  const NOTE = '<g fill="#E23444"><ellipse cx="0" cy="8" rx="4" ry="3" transform="rotate(-20 0 8)"/><rect x="2.6" y="-6" width="1.8" height="14"/><path d="M4.4 -6q6 2 5 8q-1-4-5-4z"/></g>';

  // La carte de la playlist, tenue à bout de patte : un en-tête, un compteur, et la liste des lignes.
  const CARD = { x: 100, y: 8, w: 50, h: 54 };
  const rowY = (i) => CARD.y + 14 + i * 12.5;
  const row = (i, fresh, plus) => `<g class="rb-row" data-i="${i}" opacity="${fresh ? 0 : 0.45}">
      <rect x="${CARD.x + 4}" y="${rowY(i)}" width="${CARD.w - 8}" height="10" rx="2.5" fill="${fresh ? "#3a1015" : "#24090c"}" stroke="${EMBER}" stroke-width="1.2"/>
      ${plus ? `<path d="M${CARD.x + 10} ${rowY(i) + 2.4}v5.2M${CARD.x + 7.4} ${rowY(i) + 5}h5.2" stroke="#FFECEE" stroke-width="1.5" stroke-linecap="round"/>`
        : `<circle cx="${CARD.x + 10}" cy="${rowY(i) + 5}" r="2.2" fill="${EMBER}"/>`}
      <path d="M${CARD.x + 16} ${rowY(i) + 3.6}h${CARD.w - 26}M${CARD.x + 16} ${rowY(i) + 6.6}h${CARD.w - 34}" stroke="#FFECEE" stroke-width="1.3" stroke-linecap="round" opacity=".85"/></g>`;

  function scene(kind) {
    const { x, y, w, h } = CARD;
    const tab = KINDS[kind].folder ? `<path d="M${x} ${y + 4}V${y - 2}a2 2 0 0 1 2-2h12l4 6Z" fill="#1A080A" stroke="${EMBER}" stroke-width="1.6" stroke-linejoin="round"/>` : "";
    // Ajout à une playlist qui existe : deux lignes déjà là, plus pâles.
    const old = kind === "add" ? row(0, false) + row(1, false) : "";
    return `<div class="rb-all"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 170 128" fill="none" aria-hidden="true">
      <defs><clipPath id="rb-clip"><rect x="${x}" y="${y + 12}" width="${w}" height="${h - 13}"/></clipPath></defs>
        <g class="rb-card" opacity="0">${tab}
          <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="#1A080A" stroke="${EMBER}" stroke-width="1.8"/>
          <g transform="translate(${x + 7} ${y + 2.5}) scale(.45)">${NOTE}</g>
          <path d="M${x + 15} ${y + 7}h${w - 34}" stroke="#FFECEE" stroke-width="2" stroke-linecap="round"/>
          <text class="rb-count" x="${x + w - 5}" y="${y + 9.4}" text-anchor="end" font-size="7.5" font-weight="700" fill="#FFECEE" font-family="Hanken Grotesk, Segoe UI, sans-serif"></text>
          <g clip-path="url(#rb-clip)"><g class="rb-list">${old}</g></g>
        </g>
      ${[0, 1, 2].map((i) => `<g class="rb-note" opacity="0"><g transform="translate(${x + 8 + i * 15} ${y - 6}) scale(${0.7 - i * 0.12})">${NOTE}</g></g>`).join("")}
    </svg><div class="rb-sprite"></div></div>`;
  }

  const css = `#rocky-builder{position:fixed;left:0;bottom:14px;z-index:9998;width:200px;pointer-events:none;font:600 13px/1.3 "Hanken Grotesk","Segoe UI",system-ui,sans-serif}
    #rocky-builder .rb-all{position:relative;filter:drop-shadow(0 6px 14px rgba(0,0,0,.45))}
    #rocky-builder svg{display:block;width:100%;overflow:visible}
    #rocky-builder .rb-sprite{position:absolute;left:${SPRITE.x}px;top:${SPRITE.y}px;width:${FRAME}px;height:${FRAME}px;background:${SHEET("work")} 0 0/${FRAME * 12}px ${FRAME}px no-repeat}
    #rocky-builder svg *{transform-box:view-box}
    #rocky-builder .rb-say{position:absolute;left:112px;top:-14px;white-space:nowrap;padding:5px 10px;border-radius:999px;background:#E23444;color:#fff;opacity:0;box-shadow:0 4px 14px rgba(226,52,68,.4)}`;

  const EASE = "cubic-bezier(.45,0,.25,1)";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Une animation courte, en images clés placées en millisecondes ; rend une promesse tenue à la fin. L'enchaînement suit
  // l'horloge, pas l'affichage : CLOUD caché un moment (Paramètres ouverts), Rocky reprend où il en est sans rester figé.
  function run(node, frames, total, origin) {
    if (!node) return Promise.resolve();
    if (origin) node.style.transformOrigin = origin;
    const kf = frames.map(([ms, f]) => ({ offset: Math.min(1, Math.max(0, ms / total)), easing: EASE, ...f }));
    if (kf[0].offset > 0) kf.unshift({ ...kf[0], offset: 0 });
    if (kf.at(-1).offset < 1) kf.push({ ...kf.at(-1), offset: 1 });
    node.animate(kf, { duration: total, fill: "forwards" });
    return wait(total);
  }

  let current = null; // la scène en cours : { pending, kind, … }

  async function perform(s) {
    const { box } = s;
    const $ = (q) => box.querySelector(q), $$ = (q) => [...box.querySelectorAll(q)];
    const spr = $(".rb-sprite");
    // Une planche jouée une fois (ou en boucle) sur ms millisecondes ; à la fin, l'image 0 (Rocky qui tient la carte).
    const sheet = (name, ms, iterations = 1) => {
      spr.style.backgroundImage = SHEET(name);
      return spr.animate([{ backgroundPositionX: "0px" }, { backgroundPositionX: `${-FRAME * 12}px` }], { duration: ms, iterations, easing: "steps(12)" });
    };
    // La marche : la planche en boucle, et toute la scène qui dodeline un peu.
    const walk = () => [sheet("walk", 380, Infinity),
      $(".rb-all").animate([{ transform: "translateY(0)" }, { transform: "translateY(-2px) rotate(1deg)" }], { duration: 190, direction: "alternate", iterations: Infinity, easing: "ease-in-out" })];
    const stop = (list) => list.forEach((a) => a.cancel());
    const say = $(".rb-say"), count = $(".rb-count"), list = $(".rb-list");
    const X = 18; // là où il s'arrête pour travailler

    // 1. Il arrive en marchant depuis le bord gauche.
    let steps = walk();
    await box.animate([{ transform: "translateX(-210px)" }, { transform: `translateX(${X}px)` }], { duration: 1100, easing: "cubic-bezier(.2,.6,.35,1)", fill: "forwards" });
    await wait(1100);
    stop(steps);
    spr.style.backgroundImage = SHEET("work");
    // 2. Il sort la carte de sa patte.
    await run($(".rb-card"), [[0, { opacity: 0, transform: "scale(.3) rotate(-12deg)" }], [260, { opacity: 1, transform: "scale(1.06) rotate(2deg)" }], [380, { opacity: 1, transform: "none" }]],
      380, `${CARD.x + CARD.w / 2}px ${CARD.y + CARD.h}px`);
    // Une création sans sons qui suivent : il pose les lignes de décor de la carte.
    let decor = s.pending ? 0 : KINDS[s.kind].decor;
    let placed = 0, total = 0, slots = s.kind === "add" ? 2 : 0; // slots : lignes déjà dans la liste
    const card = $(".rb-card"), all = $(".rb-all");

    // 3. Une ligne par son : la patte du haut la prend, la descend et la glisse (au tiers de la planche « work ») ;
    //    celle de droite tient la carte, qui plie un peu sous le geste.
    const place = async (sounds) => {
      const i = slots++, D = Math.max(420, 900 - placed * 60), k = D / 900;
      const scroll = Math.max(0, i - (VISIBLE - 1)) * 12.5;
      list.insertAdjacentHTML("beforeend", row(i, true, s.kind === "add"));
      const node = list.lastElementChild;
      const steps = [
        // La liste remonte d'un cran pour faire de la place quand la carte est pleine.
        scroll ? run(list, [[0, { transform: `translateY(${-(scroll - 12.5)}px)` }], [260 * k, { transform: `translateY(${-scroll}px)` }]], D) : null,
        (sheet("work", D), wait(D)),
        run(node, [[0, { opacity: 0, transform: "translate(-12px,-24px) rotate(-14deg) scale(.8)" }], [140 * k, { opacity: 1, transform: "translate(-8px,-12px) rotate(-6deg) scale(.95)" }],
          [300 * k, { opacity: 1, transform: "translate(2px,0) scale(1.04,.9)" }], [440 * k, { opacity: 1, transform: "translate(-.5px,0) scale(.98,1.04)" }],
          [560 * k, { opacity: 1, transform: "none" }]], D, `${CARD.x + 4}px ${rowY(i) + 5}px`),
        run(card, [[280 * k, { opacity: 1, transform: "none" }], [390 * k, { opacity: 1, transform: "translateY(-2.5px)" }], [540 * k, { opacity: 1, transform: "none" }]], D),
        run(all, [[160 * k, { transform: "translateY(-1.5px) rotate(1.5deg)" }], [390 * k, { transform: "translateY(1px) rotate(-1deg)" }], [660 * k, { transform: "none" }]], D),
      ];
      // Le compteur monte au moment où la ligne se pose.
      setTimeout(() => { total += sounds; if (sounds) count.textContent = (s.kind === "add" ? "+" : "") + total; }, 300 * k);
      placed++;
      await Promise.all(steps);
    };
    for (;;) {
      while (decor > 0) { decor--; await place(0); }
      while (s.pending > 0) {
        // Au-delà de MAX_ROWS lignes, chaque ligne vaut plusieurs sons.
        const chunk = Math.max(1, Math.ceil(s.pending / Math.max(1, MAX_ROWS - placed)));
        s.pending -= chunk;
        await place(chunk);
      }
      // D'autres sons en route (le fichier suivant qui s'envoie) ? Il attend un peu, en tapotant la carte.
      const tap = run(card, [[0, { opacity: 1, transform: "none" }], [300, { opacity: 1, transform: "translateY(-1.5px)" }], [600, { opacity: 1, transform: "none" }],
        [900, { opacity: 1, transform: "translateY(-1.5px)" }], [1200, { opacity: 1, transform: "none" }]], 1200);
      for (let t = 0; t < 12 && !s.pending; t++) await wait(100);
      await tap;
      if (!s.pending) break;
    }

    // 4. Fini : deux sauts de joie (la planche « cheer », la carte suit sa patte), des notes qui s'envolent, la bulle.
    s.done = true;
    const label = s.kind === "add" ? (total > 1 ? `${total} sons ajoutés !` : KINDS.add.label)
      : total ? `${KINDS[s.kind].label.replace(/ !$/, "")} : ${total} son${total > 1 ? "s" : ""} !` : KINDS[s.kind].label;
    say.textContent = label;
    await Promise.all([
      (sheet("cheer", 760), wait(760)),
      run(card, [[0, { opacity: 1, transform: "none" }], [190, { opacity: 1, transform: "translateY(-13px)" }], [380, { opacity: 1, transform: "none" }],
        [570, { opacity: 1, transform: "translateY(-13px)" }], [760, { opacity: 1, transform: "none" }]], 760),
      ...$$(".rb-note").map((note, i) => run(note, [[i * 160, { opacity: 0, transform: "translateY(0)" }], [i * 160 + 200, { opacity: 1 }],
        [i * 160 + 1000, { opacity: 0, transform: `translate(${i * 4 - 4}px,-24px)` }]], 1400)),
      run(say, [[0, { opacity: 0, transform: "translateY(6px) scale(.9)" }], [200, { opacity: 1, transform: "none" }]], 400),
    ]);
    // 5. Il traverse l'écran avec sa carte et sort par la droite ; la bulle s'efface en route.
    run(say, [[0, { opacity: 1 }], [900, { opacity: 1 }], [1200, { opacity: 0 }]], 1200);
    steps = walk();
    const far = innerWidth + 20, ms = Math.min(4200, Math.max(1800, (far - X) * 3.2));
    await box.animate([{ transform: `translateX(${X}px)` }, { transform: `translateX(${far}px)` }], { duration: ms, easing: "cubic-bezier(.45,0,.7,1)", fill: "forwards" });
    await wait(ms);
    stop(steps);
  }

  function play(kind = "add", sounds = 0) {
    if (!KINDS[kind] || document.hidden) return;
    if (kind === "add" && !sounds) sounds = 1;
    // Déjà là et encore au travail : les nouveaux sons s'ajoutent à sa pile (création suivie de l'import Spotify,
    // fichiers envoyés l'un après l'autre).
    if (current) { if (!current.done) current.pending += sounds; return; }
    if (!document.getElementById("rocky-builder-css")) document.head.append(Object.assign(document.createElement("style"), { id: "rocky-builder-css", textContent: css }));
    const box = Object.assign(document.createElement("div"), { id: "rocky-builder", innerHTML: scene(kind) + '<div class="rb-say"></div>' });
    box.setAttribute("aria-hidden", "true");
    document.body.append(box);
    current = { box, kind, pending: sounds, done: false };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Sans animation : la carte et la bulle, immobiles, le temps de les lire.
      box.style.transform = "translateX(18px)";
      box.querySelector(".rb-card").setAttribute("opacity", 1);
      Object.assign(box.querySelector(".rb-say"), { textContent: KINDS[kind].label }).style.opacity = 1;
      setTimeout(() => { box.remove(); current = null; }, 1800);
      return;
    }
    perform(current).catch(() => {}).finally(() => { box.remove(); current = null; });
  }

  // L'appel réussi qui vient d'être fait → [animation, nombre de sons] (rien pour les autres appels).
  function kindOf(method, path, body) {
    if (method !== "POST") return null;
    path = path.split("?")[0];
    if (path === "/me/sounds/projects") return [KINDS[body && body.kind] && body.kind !== "add" ? body.kind : "project", 0];
    if (path === "/me/sounds/folders") return ["folder", 0];
    if (/^\/me\/sounds\/projects\/\d+\/platform-items$/.test(path)) return ["add", Math.max(1, (body && Array.isArray(body.items) && body.items.length) || 1)];
    if (/^\/me\/sounds\/(tracks\/\d+\/(add|duplicate|versions)|projects\/\d+\/tracks)$/.test(path)) return ["add", 1];
    return null;
  }
  // Seulement dans l'application (son preload y pose oniriqueApp), pas sur le site ; on : false quand le compte l'a coupé
  // dans les Paramètres de l'application (mes-sons.html le relit sur le compte).
  const inApp = () => !!(window.oniriqueApp || window.oniriqueDialog);
  if (inApp()) ["walk", "work", "cheer"].forEach((n) => (new Image().src = SRC(n))); // prêtes avant sa première entrée
  window.RockyBuild = { play, kindOf, inApp, on: true,
    fromApi: (method, path, body) => { const k = inApp() && window.RockyBuild.on !== false && kindOf(method, path, body); if (k) play(...k); } };
})();
