// Rejoue la démo interactive d'un plugin : l'image réelle de son interface, et pour chaque bouton les images
// de ses positions, enregistrées à partir du .vst3 par l'outil onirique-probe. Aucun son n'est traité.
//
//   OniriqueDemo.mount(element, "/api/media/….json")  →  Promise   (le site : télécharge puis affiche)
//   OniriqueDemo.render(element, demo)                 →  affiche une démo déjà chargée (l'application)
window.OniriqueDemo = {
  async mount(root, url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Démo indisponible.");
    return this.render(root, await response.json());
  },

  render(root, demo, hint) {

    const stage = document.createElement("div");
    stage.className = "demo-stage";
    stage.style.aspectRatio = `${demo.width} / ${demo.height}`;
    stage.style.backgroundImage = `url("${demo.base}")`;

    const status = document.createElement("p");
    status.className = "demo-status";
    status.setAttribute("aria-live", "polite");
    status.textContent = hint || "Tourne un bouton, clique un interrupteur : c'est l'interface réelle du plugin.";

    let top = 1;
    const area = (control) => control.parts.reduce((sum, p) => sum + p.w * p.h, 0);

    // Les grandes zones d'abord : les petits boutons restent cliquables par-dessus.
    for (const control of [...demo.controls].sort((a, b) => area(b) - area(a))) {
      let frame = control.start;
      const last = control.frames - 1;
      const parts = control.parts.map((part, index) => {
        const el = document.createElement("div");
        el.className = "demo-part" + (control.discrete ? " discrete" : "");
        Object.assign(el.style, { left: part.x * 100 + "%", top: part.y * 100 + "%", width: part.w * 100 + "%", height: part.h * 100 + "%" });
        if (index === 0) {
          el.tabIndex = 0;
          el.setAttribute("role", control.discrete && control.frames === 2 ? "switch" : "slider");
          el.setAttribute("aria-label", control.name);
        } else {
          el.setAttribute("aria-hidden", "true");
        }
        stage.append(el);
        return el;
      });

      const show = (next, touched = true) => {
        frame = Math.max(0, Math.min(last, next));
        parts.forEach((el, index) => {
          // L'image du bouton n'est posée qu'à la première manipulation : au repos, c'est l'interface d'origine qu'on voit.
          if (touched) {
            el.style.backgroundImage = `url("${control.parts[index].sprite}")`;
            el.style.backgroundSize = `100% ${control.frames * 100}%`;
            el.style.backgroundPosition = `0 ${last ? (frame / last) * 100 : 0}%`;
            el.style.zIndex = String(top); // le dernier bouton touché passe au-dessus des zones qu'il partage
          }
        });
        if (touched) top++;
        const main = parts[0];
        if (main.getAttribute("role") === "switch") main.setAttribute("aria-checked", String(frame === last));
        else {
          main.setAttribute("aria-valuemin", "0");
          main.setAttribute("aria-valuemax", String(last));
          main.setAttribute("aria-valuenow", String(frame));
          main.setAttribute("aria-valuetext", control.texts[frame] || "");
        }
        if (touched) status.textContent = `${control.name} : ${control.texts[frame] || ""}`;
      };
      show(frame, false);

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

    root.replaceChildren(stage, status);
    return demo;
  },
};
