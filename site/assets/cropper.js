// Rogner une image avant de l'envoyer : on la déplace et on la zoome dans un cadre aux proportions de la boutique.
// Le même fichier sert au panel admin du site et à celui de l'application (copié dans app/renderer/).
//
//   OniriqueCropper.open(src, { aspect: 16 / 10, width: 1600 })  →  Promise<{ dataUrl, blob } | null>   (null : annulé)
//
// Tout est posé en JavaScript, sans feuille de style ni attribut style : la politique de sécurité de l'application
// n'autorise ni l'un ni l'autre.
window.OniriqueCropper = (() => {
  const css = (node, styles) => { Object.assign(node.style, styles); return node; };
  const make = (tag, styles = {}, props = {}) => css(Object.assign(document.createElement(tag), props), styles);
  const BACK = "#0d0809";

  function open(src, { aspect = 16 / 10, width = 1600 } = {}) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onerror = () => reject(new Error("Cette image n'a pas pu être lue."));
      image.onload = () => {
        const veil = make("div", { position: "fixed", inset: "0", zIndex: "9999", display: "grid", placeItems: "center", padding: "16px", background: "rgba(5,3,4,.86)" });
        const panel = make("div", { width: "min(760px, 100%)", display: "grid", gap: "14px", padding: "18px", borderRadius: "18px", border: "1px solid rgba(255,236,238,.16)", background: "#170d10", color: "#ffecee", font: "500 14px/1.4 system-ui, sans-serif" });
        const title = make("strong", { font: "700 16px/1.2 system-ui, sans-serif" }, { textContent: "Cadrer l'image" });
        const hint = make("span", { color: "rgba(255,236,238,.62)" }, { textContent: "Fais glisser l'image pour la placer, zoome avec la molette ou le curseur. Ce qui est dans le cadre est ce que montrera la boutique." });
        const canvas = make("canvas", { width: "100%", display: "block", borderRadius: "12px", border: "1px solid rgba(255,236,238,.22)", cursor: "grab", touchAction: "none", background: BACK });
        const zoom = make("input", { flex: "1", accentColor: "#e23444" }, { type: "range", min: "0", max: "1000", value: "0" });
        zoom.setAttribute("aria-label", "Zoom");
        const pill = (label, primary) => make("button", { padding: "9px 16px", borderRadius: "999px", cursor: "pointer", font: "600 13px/1 system-ui, sans-serif", whiteSpace: "nowrap",
          border: primary ? "0" : "1px solid rgba(255,236,238,.22)", background: primary ? "#ffecee" : "transparent", color: primary ? "#0d0809" : "#ffecee" }, { type: "button", textContent: label });
        const fill = pill("Remplir le cadre"), whole = pill("Image entière"), cancel = pill("Annuler"), save = pill("Enregistrer", true);
        const tools = make("div", { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" });
        const actions = make("div", { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "10px" });
        tools.append(make("span", {}, { textContent: "Zoom" }), zoom, fill, whole);
        actions.append(cancel, save);
        panel.append(title, hint, canvas, tools, actions);
        veil.append(panel);
        document.body.append(veil);

        // Le cadre a les proportions demandées ; l'image y est décrite par son échelle et la position de son centre,
        // en unités du cadre (1 = la largeur du cadre).
        const frame = { w: 1, h: 1 / aspect };
        const ratio = image.naturalWidth / image.naturalHeight;
        const cover = Math.max(frame.w, frame.h * ratio);      // largeur de l'image quand elle remplit juste le cadre
        const contain = Math.min(frame.w, frame.h * ratio);    // et quand elle y tient tout entière
        const widest = cover * 5;
        const state = { w: cover, x: 0.5, y: frame.h / 2 };

        const clamp = () => {
          const h = state.w / ratio;
          // Une image plus grande que le cadre ne laisse pas de vide ; plus petite, elle reste dedans.
          const range = (size, span) => (size >= span ? [span - size / 2, size / 2] : [size / 2, span - size / 2]);
          const [x0, x1] = range(state.w, frame.w), [y0, y1] = range(h, frame.h);
          state.x = Math.min(x1, Math.max(x0, state.x));
          state.y = Math.min(y1, Math.max(y0, state.y));
        };
        const paint = (context, size) => {
          context.fillStyle = BACK;
          context.fillRect(0, 0, size, size / aspect);
          const w = state.w * size, h = w / ratio;
          context.imageSmoothingQuality = "high";
          context.drawImage(image, state.x * size - w / 2, state.y * size - h / 2, w, h);
        };
        const draw = () => {
          clamp();
          const size = Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)) || 720;
          canvas.width = size;
          canvas.height = Math.round(size / aspect);
          paint(canvas.getContext("2d"), size);
          zoom.value = String(Math.round(1000 * Math.log(state.w / contain) / Math.log(widest / contain)));
        };
        const setWidth = (w, anchorX = 0.5, anchorY = frame.h / 2) => {
          const next = Math.min(widest, Math.max(contain, w)), k = next / state.w;
          // Le point sous le curseur reste sous le curseur.
          state.x = anchorX + (state.x - anchorX) * k;
          state.y = anchorY + (state.y - anchorY) * k;
          state.w = next;
          draw();
        };

        zoom.oninput = () => setWidth(contain * Math.pow(widest / contain, Number(zoom.value) / 1000));
        fill.onclick = () => { state.w = cover; state.x = 0.5; state.y = frame.h / 2; draw(); };
        whole.onclick = () => { state.w = contain; state.x = 0.5; state.y = frame.h / 2; draw(); };
        canvas.addEventListener("wheel", (event) => {
          event.preventDefault();
          const box = canvas.getBoundingClientRect();
          setWidth(state.w * (event.deltaY < 0 ? 1.08 : 1 / 1.08), (event.clientX - box.left) / box.width, (event.clientY - box.top) / box.width);
        }, { passive: false });
        let grab = null;
        canvas.onpointerdown = (event) => { canvas.setPointerCapture(event.pointerId); grab = { x: event.clientX, y: event.clientY, sx: state.x, sy: state.y }; canvas.style.cursor = "grabbing"; };
        canvas.onpointermove = (event) => {
          if (!grab) return;
          const box = canvas.getBoundingClientRect();
          state.x = grab.sx + (event.clientX - grab.x) / box.width;
          state.y = grab.sy + (event.clientY - grab.y) / box.width;
          draw();
        };
        canvas.onpointerup = canvas.onpointercancel = () => { grab = null; canvas.style.cursor = "grab"; };

        const close = (result) => { removeEventListener("keydown", onKey); removeEventListener("resize", draw); veil.remove(); resolve(result); };
        const onKey = (event) => { if (event.key === "Escape") close(null); };
        addEventListener("keydown", onKey);
        addEventListener("resize", draw);
        cancel.onclick = () => close(null);
        save.onclick = () => {
          clamp();
          const out = make("canvas", {}, { width, height: Math.round(width / aspect) });
          paint(out.getContext("2d"), width);
          const dataUrl = out.toDataURL("image/jpeg", 0.92);
          out.toBlob((blob) => close({ dataUrl, blob }), "image/jpeg", 0.92);
        };
        draw();
      };
      image.src = src;
    });
  }

  return { open };
})();
