// Rejoue la démo interactive d'un plugin : l'image réelle de son interface, et pour chaque bouton les images
// de ses positions, enregistrées à partir du .vst3 par l'outil onirique-probe. Aucun son n'est traité.
//
//   OniriqueDemo.mount(element, "/api/media/….json")  →  Promise   (le site : télécharge puis affiche)
//   OniriqueDemo.render(element, demo)                 →  affiche une démo déjà chargée (l'application)
//
// Deux sortes de réglages :
//   - un bouton (control.parts : les zones de l'interface qu'il change) se manipule sur l'image même ;
//   - un réglage qui change toute l'interface (control.global : une couleur, un mode) a ses positions en images
//     entières ; il se choisit sous l'interface, avec une pastille par position.
// Chaque image a été enregistrée à partir de l'interface au repos, un réglage à la fois : deux réglages dont les
// zones se recouvrent ne peuvent pas être montrés ensemble sans mélanger deux images. Toucher l'un remet donc
// l'autre au repos, et ce qui s'affiche est toujours une image réelle du plugin.
window.OniriqueDemo = {
  // Les plugins dont l'interface est elle-même une page web (RAW) : cette page, en « aperçu simulé », sert d'aperçu.
  // La liste est dans /previews/previews.json (tools/sync-web-previews.mjs) ; null si le plugin n'en a pas.
  web(slug) {
    this.webList ??= fetch("/previews/previews.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    return this.webList.then((list) => list[slug] || null);
  },

  // La page est affichée à la taille de la fenêtre du plugin (entry.width × entry.height), puis réduite pour tenir
  // dans la largeur disponible : on la voit comme dans le DAW, jamais tassée.
  mountWeb(root, entry, name) {
    const width = entry.width || 1100, height = entry.height || 760;
    const box = document.createElement("div");
    box.className = "demo-web";
    Object.assign(box.style, { position: "relative", width: "100%", aspectRatio: `${width} / ${height}`, overflow: "hidden", background: "#0d0809" });
    const frame = document.createElement("iframe");
    frame.src = entry.url;
    frame.title = "Interface de " + name;
    frame.loading = "lazy";
    Object.assign(frame.style, { position: "absolute", left: "0", top: "0", width: width + "px", height: height + "px", border: "0", transformOrigin: "0 0" });
    box.append(frame);
    const fit = () => { frame.style.transform = `scale(${box.clientWidth / width})`; };
    new ResizeObserver(fit).observe(box);
    const status = document.createElement("p");
    status.className = "demo-status";
    status.textContent = "L'interface réelle du plugin, en direct : clique, tourne les boutons, joue sur le clavier. Aucun son ici.";
    root.replaceChildren(box, status);
    fit();
  },

  async mount(root, url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Démo indisponible.");
    return this.render(root, await response.json());
  },

  render(root, demo, hint) {
    // Les captures plus anciennes écrivaient l'unité deux fois (« 82 % % », « 2.82 kHz Hz ») : une seule suffit.
    const unit = (text) => String(text || "").replace(/(\S+)\s+\1$/, "$1").replace(/(kHz|ms|dB)\s+(Hz|s|dB)$/, "$1");
    for (const control of demo.controls) control.texts = (control.texts || []).map(unit);

    const stage = document.createElement("div");
    stage.className = "demo-stage";
    stage.style.aspectRatio = `${demo.width} / ${demo.height}`;
    stage.style.backgroundImage = `url("${demo.base}")`;

    const globals = document.createElement("div");
    globals.className = "demo-globals";

    const status = document.createElement("p");
    status.className = "demo-status";
    status.setAttribute("aria-live", "polite");
    const hasButtons = demo.controls.some((c) => !c.global);
    status.textContent = hint || (hasButtons ? "Tourne un bouton, clique un interrupteur : c'est l'interface réelle du plugin."
      : "Choisis un réglage sous l'interface : ce sont les vraies images du plugin.");

    let top = 1;
    const touched = []; // les réglages montrés hors de leur position de repos
    const overlap = (a, b) => a.some((r) => b.some((s) => r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h));
    const area = (control) => control.parts.reduce((sum, p) => sum + p.w * p.h, 0);

    // Les grandes zones d'abord : les petits boutons restent cliquables par-dessus.
    for (const control of [...demo.controls].sort((a, b) => area(b) - area(a))) {
      let frame = control.start;
      const last = control.frames - 1;
      const parts = control.parts.map((part, index) => {
        const el = document.createElement("div");
        el.className = "demo-part" + (control.discrete ? " discrete" : "");
        Object.assign(el.style, { left: part.x * 100 + "%", top: part.y * 100 + "%", width: part.w * 100 + "%", height: part.h * 100 + "%" });
        if (control.global) {
          // Une image entière posée sur l'interface : elle ne prend pas les clics, les boutons restent dessous.
          el.style.pointerEvents = "none";
          el.style.borderRadius = "0";
        } else if (index === 0) {
          el.tabIndex = 0;
          el.setAttribute("role", control.discrete && control.frames === 2 ? "switch" : "slider");
          el.setAttribute("aria-label", control.name);
        } else {
          el.setAttribute("aria-hidden", "true");
        }
        stage.append(el);
        return el;
      });

      // Réglage global : une rangée de pastilles sous l'interface.
      const chips = [];
      if (control.global) {
        const group = document.createElement("div");
        group.className = "demo-global";
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", control.name);
        const label = document.createElement("span");
        label.textContent = control.name;
        group.append(label);
        control.texts.forEach((text, k) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.textContent = text || String(k + 1);
          chip.addEventListener("click", () => show(k));
          chips.push(chip);
          group.append(chip);
        });
        globals.append(group);
      }
      const mark = () => chips.forEach((chip, k) => chip.setAttribute("aria-pressed", String(k === frame)));

      const self = {
        rects: control.parts,
        reset: () => {
          frame = control.start;
          parts.forEach((el) => { el.style.backgroundImage = ""; el.style.zIndex = ""; });
          mark();
        },
      };

      const show = (next, manipulated = true) => {
        frame = Math.max(0, Math.min(last, next));
        if (manipulated) {
          for (const other of touched.filter((o) => o !== self && overlap(o.rects, self.rects))) {
            other.reset();
            touched.splice(touched.indexOf(other), 1);
          }
          if (!touched.includes(self)) touched.push(self);
        }
        parts.forEach((el, index) => {
          // L'image n'est posée qu'à la première manipulation : au repos, c'est l'interface d'origine qu'on voit.
          if (manipulated) {
            el.style.backgroundImage = `url("${control.parts[index].sprite}")`;
            el.style.backgroundSize = `100% ${control.frames * 100}%`;
            el.style.backgroundPosition = `0 ${last ? (frame / last) * 100 : 0}%`;
            el.style.zIndex = String(top); // le dernier réglage touché passe au-dessus des zones qu'il partage
          }
        });
        if (manipulated) top++;
        mark();
        if (!control.global) {
          const main = parts[0];
          if (main.getAttribute("role") === "switch") main.setAttribute("aria-checked", String(frame === last));
          else {
            main.setAttribute("aria-valuemin", "0");
            main.setAttribute("aria-valuemax", String(last));
            main.setAttribute("aria-valuenow", String(frame));
            main.setAttribute("aria-valuetext", control.texts[frame] || "");
          }
        }
        if (manipulated) status.textContent = `${control.name} : ${control.texts[frame] || ""}`;
      };
      show(frame, false);
      if (control.global) continue;

      for (const el of parts) {
        if (control.discrete) {
          el.addEventListener("click", () => show(frame === last ? 0 : frame + 1));
        } else {
          // Un bouton rotatif se règle en glissant verticalement, comme dans le plugin.
          el.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            el.setPointerCapture(event.pointerId);
            const startY = event.clientY, startFrame = frame;
            const move = (e) => show(startFrame + Math.round(((startY - e.clientY) / 160) * last));
            const stop = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", stop); el.removeEventListener("pointercancel", stop); };
            el.addEventListener("pointermove", move);
            el.addEventListener("pointerup", stop);
            el.addEventListener("pointercancel", stop);
          });
          el.addEventListener("dblclick", () => show(control.start));
          el.addEventListener("wheel", (event) => { event.preventDefault(); show(frame + (event.deltaY < 0 ? 1 : -1)); }, { passive: false });
        }
        el.addEventListener("keydown", (event) => {
          const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
          if (step) { event.preventDefault(); show(control.discrete && frame + step > last ? 0 : frame + step); }
          else if (control.discrete && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); show(frame === last ? 0 : frame + 1); }
        });
      }
    }

    root.replaceChildren(...[stage, globals.children.length ? globals : null, status].filter(Boolean));
    return demo;
  },
};
