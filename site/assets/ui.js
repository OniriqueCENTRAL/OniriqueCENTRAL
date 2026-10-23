// Réglages communs à toutes les pages du site, chargé dans le <head> juste après i18n.js :
//
// - Mode léger : un navigateur qui dessine sans la carte graphique (accélération coupée, pilote absent, machine virtuelle)
//   n'a ni flous d'arrière-plan ni animations, comme avec « réduire les animations » ; les scripts le lisent avec
//   document.documentElement.classList.contains("lite"). Forcé par ?lite=1, retiré par ?lite=0.
// - Les listes déroulantes (<select>) et le choix d'une couleur (<input type="color">) s'ouvrent dans des menus aux
//   couleurs du site au lieu de ceux du système. Le champ d'origine reste en place et garde sa valeur : les pages
//   n'ont rien à changer, elles reçoivent les mêmes événements input et change. Sur un écran tactile, les listes
//   gardent le sélecteur du téléphone, plus pratique au doigt.
(() => {
  const root = document.documentElement;

  //------------------------------------------------------------------------------ Mode léger
  let lite = (location.search.match(/[?&]lite=([01])/) || [])[1] || null;
  try { if (lite) sessionStorage.setItem("onirique.lite", lite); else lite = sessionStorage.getItem("onirique.lite"); } catch {}
  if (lite === null) {
    // failIfMajorPerformanceCaveat : pas de contexte si le dessin se fait sans la carte graphique.
    let soft = true;
    try {
      const gl = document.createElement("canvas").getContext("webgl", { failIfMajorPerformanceCaveat: true });
      if (gl) {
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        soft = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "");
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    } catch {}
    lite = soft ? "1" : "0";
    try { sessionStorage.setItem("onirique.lite", lite); } catch {}
  }
  if (lite === "1") root.classList.add("lite");

  const css = `
html.lite *, html.lite *::before, html.lite *::after { animation: none !important; transition: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; scroll-behavior: auto !important; }
.ui-pop { position: fixed; inset: auto; margin: 0; z-index: 2147483000; box-sizing: border-box; border: 1px solid rgba(255,210,214,.18); border-radius: 14px; padding: 6px;
  background: #1a080a; color: #F6EEEE; box-shadow: 0 22px 60px -18px rgba(0,0,0,.95), 0 0 0 1px rgba(0,0,0,.4); font: 500 14px/1.3 "Hanken Grotesk", system-ui, sans-serif; overflow: visible; }
.ui-pop[hidden] { display: none; }
.ui-list { max-height: min(340px, 60vh); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(255,210,214,.25) transparent; }
.ui-opt { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 9px; cursor: pointer; white-space: nowrap; }
.ui-opt::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; }
.ui-opt[aria-selected="true"] { color: #FFECEE; font-weight: 700; }
.ui-opt[aria-selected="true"]::before { background: #E23444; box-shadow: 0 0 8px #E23444; }
.ui-opt.on { background: rgba(226,52,68,.16); }
.ui-opt[aria-disabled="true"] { opacity: .4; cursor: default; }
.ui-group { padding: 10px 12px 4px; font: 600 10.5px/1 "JetBrains Mono", monospace; letter-spacing: .14em; text-transform: uppercase; color: #B9A2A5; }
.ui-color { width: 248px; padding: 12px; display: grid; gap: 12px; }
.ui-sv { position: relative; height: 150px; border-radius: 10px; cursor: crosshair; touch-action: none;
  background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(var(--h), 100%, 50%)); }
.ui-hue { position: relative; height: 12px; border-radius: 999px; cursor: pointer; touch-action: none;
  background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
.ui-dot { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.6); pointer-events: none; }
.ui-hue .ui-dot { top: 50%; background: hsl(var(--h), 100%, 50%); }
.ui-row { display: flex; align-items: center; gap: 8px; }
.ui-swatch { flex: none; width: 34px; height: 34px; border-radius: 10px; border: 1px solid rgba(255,210,214,.18); }
.ui-hex { flex: 1; min-width: 0; height: 34px; padding: 0 10px; border-radius: 10px; border: 1px solid rgba(255,210,214,.18); background: rgba(0,0,0,.4); color: #F6EEEE; font: 500 13px "JetBrains Mono", monospace; text-transform: uppercase; }
.ui-hex:focus { outline: none; border-color: #E23444; }
.ui-eye { flex: none; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; border: 1px solid rgba(255,210,214,.18); background: none; color: #F6EEEE; cursor: pointer; }
.ui-eye:hover { border-color: #E23444; }
.ui-presets { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; }
.ui-presets button { aspect-ratio: 1; border-radius: 7px; border: 1px solid rgba(255,210,214,.18); cursor: pointer; padding: 0; }
.ui-presets button:hover { outline: 2px solid #E23444; outline-offset: 1px; }
`;
  const style = document.createElement("style");
  style.textContent = css;
  (document.head || root).append(style);

  //------------------------------------------------------------------------------ La fenêtre flottante commune
  // Un « popover » passe au premier plan, même devant une boîte de dialogue ouverte ; sinon, rangé dans le corps de page.
  const canPop = typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;
  let current = null; // { pop, close }
  function openPop(anchor, pop, onClose) {
    closePop();
    if (canPop) { pop.popover = "manual"; document.body.append(pop); pop.showPopover(); } else document.body.append(pop);
    place(anchor, pop);
    current = { pop, anchor, close: onClose };
  }
  function closePop(commit) {
    if (!current) return;
    const c = current; current = null;
    c.pop.remove();
    if (c.close) c.close(commit);
  }
  function place(anchor, pop) {
    const r = anchor.getBoundingClientRect(), gap = 6, w = Math.max(pop.offsetWidth, r.width);
    pop.style.minWidth = r.width + "px";
    const below = innerHeight - r.bottom - gap, above = r.top - gap, h = pop.offsetHeight;
    const top = h <= below || below >= above ? r.bottom + gap : Math.max(8, r.top - gap - h);
    pop.style.top = Math.round(top) + "px";
    pop.style.left = Math.round(Math.max(8, Math.min(r.left, innerWidth - w - 8))) + "px";
  }
  document.addEventListener("pointerdown", (e) => { if (current && !current.pop.contains(e.target) && e.target !== current.anchor) closePop(true); }, true);
  addEventListener("resize", () => closePop(true));
  document.addEventListener("scroll", (e) => { if (current && !current.pop.contains(e.target)) closePop(true); }, true);
  const fire = (input, type) => input.dispatchEvent(new Event(type, { bubbles: true }));
  const el = (tag, cls, props = {}) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, props);

  //------------------------------------------------------------------------------ Listes déroulantes
  const fine = matchMedia("(pointer: fine)");
  const usable = (s) => s instanceof HTMLSelectElement && !s.multiple && s.size <= 1 && !s.disabled && fine.matches;

  function openSelect(select) {
    const pop = el("div", "ui-pop"), list = el("div", "ui-list");
    list.setAttribute("role", "listbox");
    pop.append(list);
    const items = [];
    for (const node of select.children) {
      const group = node.tagName === "OPTGROUP" ? node : null;
      if (group) list.append(el("div", "ui-group", { textContent: group.label }));
      for (const opt of group ? group.children : [node]) {
        if (opt.tagName !== "OPTION" || opt.hidden) continue;
        const item = el("div", "ui-opt", { textContent: opt.textContent });
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(opt.selected));
        if (opt.disabled || group?.disabled) item.setAttribute("aria-disabled", "true");
        item.addEventListener("pointerenter", () => mark(items.findIndex((x) => x.item === item)));
        item.addEventListener("click", () => choose(opt));
        list.append(item);
        items.push({ item, opt });
      }
    }
    let active = Math.max(0, items.findIndex((x) => x.opt.selected));
    function mark(i) {
      if (i < 0) return;
      items.forEach((x, j) => x.item.classList.toggle("on", j === i));
      active = i;
      const it = items[i].item;
      if (it.offsetTop < list.scrollTop) list.scrollTop = it.offsetTop;
      else if (it.offsetTop + it.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = it.offsetTop + it.offsetHeight - list.clientHeight;
    }
    function choose(opt) {
      if (opt.disabled || opt.parentElement.disabled) return;
      const changed = !opt.selected;
      opt.selected = true;
      closePop();
      select.focus();
      if (changed) { fire(select, "input"); fire(select, "change"); }
    }
    pop.onkey = (e) => {
      const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[e.key];
      if (step) {
        let i = active;
        do i = Math.max(0, Math.min(items.length - 1, i + Math.sign(step))); while (items[i].opt.disabled && i > 0 && i < items.length - 1);
        mark(Math.abs(step) > 1 ? Math.max(0, Math.min(items.length - 1, active + step)) : i);
      } else if (e.key === "Home") mark(0);
      else if (e.key === "End") mark(items.length - 1);
      else if (e.key === "Enter" || e.key === " ") items[active] && choose(items[active].opt);
      else if (e.key === "Escape" || e.key === "Tab") { closePop(); if (e.key === "Escape") select.focus(); else return; }
      else if (e.key.length === 1) {
        // Une lettre : le choix suivant qui commence par elle.
        const k = e.key.toLowerCase(), n = items.length;
        for (let j = 1; j <= n; j++) { const i = (active + j) % n; if (items[i].item.textContent.trim().toLowerCase().startsWith(k)) { mark(i); break; } }
      } else return;
      e.preventDefault();
    };
    openPop(select, pop, null);
    mark(active);
  }
  document.addEventListener("mousedown", (e) => {
    const s = e.target.closest?.("select");
    if (!usable(s) || e.button !== 0) return;
    e.preventDefault();
    if (current?.anchor === s) return closePop();
    s.focus();
    openSelect(s);
  }, true);
  // Les touches vont d'abord à la fenêtre ouverte (liste ou couleurs), depuis son champ ou depuis elle-même.
  document.addEventListener("keydown", (e) => {
    if (current?.pop.onkey && (e.target === current.anchor || current.pop.contains(e.target))) current.pop.onkey(e);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (current || e.defaultPrevented) return;
    const s = e.target;
    if (!usable(s)) return;
    if (e.key === " " || e.key === "Enter" || e.key === "F4" || (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp"))) { e.preventDefault(); openSelect(s); }
  }, true);

  //------------------------------------------------------------------------------ Couleurs
  const hexToRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const rgbToHex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, max ? d / max : 0, max];
  }
  function hsvToRgb(h, s, v) {
    const f = (n) => { const k = (n + h / 60) % 6; return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255; };
    return [f(5), f(3), f(1)];
  }
  // Les couleurs d'ONIRIQUE, à portée de clic.
  const PRESETS = ["#0D0809", "#1A080A", "#5C0008", "#E23444", "#FF6B78", "#FFECEE", "#F6EEEE", "#FFFFFF"];

  function openColor(input) {
    let [h, s, v] = rgbToHsv(...hexToRgb(/^#[0-9a-f]{6}$/i.test(input.value) ? input.value : "#000000"));
    const start = input.value;
    const pop = el("div", "ui-pop ui-color");
    const sv = el("div", "ui-sv"), svDot = el("span", "ui-dot");
    const hue = el("div", "ui-hue"), hueDot = el("span", "ui-dot");
    const swatch = el("span", "ui-swatch"), hex = el("input", "ui-hex", { value: input.value, maxLength: 7, spellcheck: false, ariaLabel: "Code de la couleur" });
    sv.append(svDot); hue.append(hueDot);
    const row = el("div", "ui-row"); row.append(swatch, hex);
    if ("EyeDropper" in window) {
      const eye = el("button", "ui-eye", { type: "button", title: "Prendre une couleur à l'écran", ariaLabel: "Prendre une couleur à l'écran" });
      eye.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m14.5 4.5 5 5M12 7l5 5-8.5 8.5H4v-4.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
      eye.onclick = async () => { try { const { sRGBHex } = await new EyeDropper().open(); setHex(sRGBHex); } catch {} };
      row.append(eye);
    }
    const presets = el("div", "ui-presets");
    for (const c of PRESETS) { const b = el("button", "", { type: "button", title: c, ariaLabel: c }); b.style.background = c; b.onclick = () => setHex(c); presets.append(b); }
    pop.append(sv, hue, row, presets);

    function paint(fromHex) {
      const value = rgbToHex(...hsvToRgb(h, s, v));
      pop.style.setProperty("--h", Math.round(h));
      svDot.style.left = s * 100 + "%"; svDot.style.top = (1 - v) * 100 + "%"; svDot.style.background = value;
      hueDot.style.left = h / 360 * 100 + "%";
      swatch.style.background = value;
      if (!fromHex) hex.value = value.toUpperCase();
      if (input.value !== value) { input.value = value; fire(input, "input"); }
    }
    function setHex(c) { if (!/^#[0-9a-f]{6}$/i.test(c)) return; [h, s, v] = rgbToHsv(...hexToRgb(c)); paint(); }
    const drag = (zone, move) => zone.addEventListener("pointerdown", (e) => {
      zone.setPointerCapture(e.pointerId);
      const at = (ev) => { const r = zone.getBoundingClientRect(); move(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))); paint(); };
      at(e);
      zone.onpointermove = (ev) => { if (ev.buttons) at(ev); };
    });
    drag(sv, (x, y) => { s = x; v = 1 - y; });
    drag(hue, (x) => { h = x * 359.9; });
    hex.oninput = () => { const c = hex.value.trim().replace(/^([0-9a-f]{6})$/i, "#$1"); if (/^#[0-9a-f]{6}$/i.test(c)) { [h, s, v] = rgbToHsv(...hexToRgb(c)); paint(true); } };
    pop.onkey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); input.value = start; fire(input, "input"); closePop(); input.focus(); }
      else if (e.key === "Enter") { e.preventDefault(); closePop(true); input.focus(); }
    };
    openPop(input, pop, () => { if (input.value !== start) fire(input, "change"); });
    paint();
  }
  document.addEventListener("click", (e) => {
    const input = e.target.closest?.('input[type="color"]');
    if (!input || input.disabled) return;
    e.preventDefault();
    if (current?.anchor === input) return closePop(true);
    openColor(input);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (current || e.defaultPrevented) return;
    const input = e.target;
    if (input?.type === "color" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openColor(input); setTimeout(() => current?.pop.querySelector(".ui-hex")?.focus()); }
  }, true);
})();
