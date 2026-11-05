/* ==========================================================================
   abrasion / abrasion labs — script commun à toutes les pages
   Aucune dépendance, aucune requête réseau, aucun cookie.
   --------------------------------------------------------------------------
   ACHAT (à brancher par le site hôte) — voir README-INTEGRATION.md
   Chaque bouton [data-buy="<id>"] ouvre la fenêtre de confirmation. Quand
   l'acheteur a coché les deux cases et confirme, la page émet :

     document.addEventListener("abrasion:buy", (e) => {
       e.preventDefault();            // dit à la page : « je m'en occupe »
       const { plugin, price, currency, consent } = e.detail;
       // … ouvrir le paiement du site hôte ici …
     });

   Si personne n'écoute, la fenêtre affiche « Paiement bientôt disponible ».
   ========================================================================== */
(() => {
"use strict";
const doc = document, root = doc.documentElement;
// navigateur trop ancien : on laisse la page statique, entièrement lisible (classe no-js conservée)
if (!("IntersectionObserver" in window) || !("CustomEvent" in window) || !window.Promise) return;
root.classList.remove("no-js");
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, r = doc) => r.querySelector(s);
const $$ = (s, r = doc) => Array.from(r.querySelectorAll(s));
const store = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} } };

/* ---------------------------------------------------------------- catalogue
   Seule source des prix : en centimes, TTC. null = « Prix à venir ».       */
const PRODUCTS = Object.freeze({
  "raw":   { id: "raw",   name: "RAW",   world: "abrasion", page: "/abrasion/raw",   price: null, currency: "EUR", kind: "Synthé" },
  "raw-2": { id: "raw-2", name: "RAW 2", world: "labs",     page: "/abrasion/raw-2", price: null, currency: "EUR", kind: "Synthé" },
  "omnis": { id: "omnis", name: "OMNIS", world: "labs",     page: "/abrasion/omnis", price: null, currency: "EUR", kind: "Mastering" },
});
const CGV_VERSION = "2026-11-05";
const fmt = p => p.price == null ? "Prix à venir" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: p.currency }).format(p.price / 100);
// Les prix viennent du catalogue ONIRIQUE (onirique.js), qui rappelle fillPrices() une fois lu.
const fillPrices = () => $$("[data-price]").forEach(el => { const p = PRODUCTS[el.dataset.price]; if (!p) return; el.textContent = fmt(p);
  if (p.price != null && el.dataset.ttc !== undefined) { const s = doc.createElement("small"); s.textContent = "TTC"; el.append(s); } });
fillPrices();
window.ABRASION = Object.freeze({ products: PRODUCTS, cgvVersion: CGV_VERSION, version: "1.0.0", fillPrices, toast: m => toast(m) });

/* ---------------------------------------------------------------- toast */
let toastT;
function toast(msg) {
  let t = $(".ab-toast"); if (!t) { t = doc.createElement("div"); t.className = "ab-toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); doc.body.append(t); }
  t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 4200);
}

/* ---------------------------------------------------------------- en-tête */
const top = $(".ab-top");
if (top) { const onS = () => top.classList.toggle("scrolled", scrollY > 8); onS(); addEventListener("scroll", onS, { passive: true }); }
const mBtn = $(".ab-menu-btn"), menu = $("#ab-menu");
if (mBtn && menu) {
  const set = open => { mBtn.setAttribute("aria-expanded", String(open)); menu.hidden = !open; mBtn.textContent = open ? "Fermer" : "Menu"; if (open) { const a = $("a", menu); a && a.focus(); } };
  mBtn.addEventListener("click", () => set(menu.hidden));
  addEventListener("keydown", e => { if (e.key === "Escape" && !menu.hidden) { set(false); mBtn.focus(); } });
  doc.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target) && !mBtn.contains(e.target)) set(false); });
  addEventListener("resize", () => { if (innerWidth > 760 && !menu.hidden) set(false); });
}

/* transitions entre pages + bouton abrasion / labs */
const sw = $(".ab-switch"), swWorld = sw ? sw.dataset.world : null, swCur = sw ? $$("a", sw).map(a => a.getAttribute("aria-current")) : [];
function leave(href) {
  if (RM) { location.href = href; return; }
  doc.body.classList.add("leaving"); setTimeout(() => { location.href = href; }, 300);
}
doc.addEventListener("click", e => {
  const a = e.target.closest("a[href]"); if (!a || e.defaultPrevented) return;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target || a.hasAttribute("download")) return;
  let url; try { url = new URL(a.href, location.href); } catch (err) { return; }
  if (url.origin !== location.origin || !/^\/abrasion\/[\w-]*$/.test(url.pathname)) return; // une page ABRASION (adresses sans .html)
  if (url.pathname === location.pathname) return;                    // même page : ancre normale
  e.preventDefault();
  if (sw && sw.contains(a)) { sw.dataset.world = a.dataset.world; $$("a", sw).forEach(o => o === a ? o.setAttribute("aria-current", "true") : o.removeAttribute("aria-current"));
    setTimeout(() => leave(url.href), RM ? 0 : 260); }
  else leave(url.href);
});
addEventListener("pageshow", e => { if (e.persisted) { doc.body.classList.remove("leaving");
  if (sw) { sw.dataset.world = swWorld; $$("a", sw).forEach((a, i) => swCur[i] ? a.setAttribute("aria-current", swCur[i]) : a.removeAttribute("aria-current")); } } });

/* ---------------------------------------------------------------- étoiles */
const sc = $(".ab-stars");
if (sc) {
  const x = sc.getContext("2d"); let w, h, pts = [], last = 0;
  const size = () => { const d = Math.min(devicePixelRatio || 1, 2); w = innerWidth; h = innerHeight; sc.width = w * d; sc.height = h * d; x.setTransform(d, 0, 0, d, 0, 0);
    pts = Array.from({ length: Math.round(w * h / 4200) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() < .9 ? .7 : 1.4, s: .4 + Math.random() * 1.8, p: Math.random() * 7 })); draw(0); };
  const draw = t => { x.clearRect(0, 0, w, h); x.fillStyle = "#fff"; for (const p of pts) { x.globalAlpha = .22 + .78 * Math.abs(Math.sin(t * .001 * p.s + p.p)); x.fillRect(p.x, p.y, p.r, p.r); } x.globalAlpha = 1; };
  size(); addEventListener("resize", () => { clearTimeout(size.t); size.t = setTimeout(size, 150); });
  if (!RM) (function loop(t) { requestAnimationFrame(loop); if (t - last < 50 || doc.hidden) return; last = t; draw(t); })(0);
}

/* ---------------------------------------------------------------- apparitions */
const rio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("on"); rio.unobserve(e.target); } }), { threshold: .14, rootMargin: "0px 0px -6% 0px" });
$$(".ab-rv,.ab-up,.ab-scan").forEach(el => rio.observe(el));

/* ---------------------------------------------------------------- carrés qui suivent le pointeur */
$$(".ab-lcard,.ab-trackable").forEach(card => {
  const f1 = $(".ab-fol.f1", card); if (!f1) return;
  card.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") card.classList.add("hov"); });
  card.addEventListener("pointerleave", () => card.classList.remove("hov"));
  card.addEventListener("pointermove", e => { const r = card.getBoundingClientRect(), x = Math.round(e.clientX - r.left), y = Math.round(e.clientY - r.top);
    card.style.setProperty("--x", x + "px"); card.style.setProperty("--y", y + "px"); f1.dataset.l = String(x).padStart(3, "0") + " " + String(y).padStart(3, "0"); });
});

/* ---------------------------------------------------------------- achat */
let dlg, dlgProduct = null, lastFocus = null;
function buildDialog() {
  dlg = doc.createElement("dialog"); dlg.className = "ab-dlg"; dlg.setAttribute("aria-labelledby", "ab-dlg-t");
  dlg.innerHTML = `
  <form method="dialog" class="ab-dlg-in" novalidate>
    <div class="ab-dlg-h"><p class="ab-eyebrow"><i></i><span data-f="world"></span></p>
      <button type="button" class="ab-dlg-x" value="close" aria-label="Fermer">×</button></div>
    <h2 class="ab-dlg-t" id="ab-dlg-t"><span data-f="name"></span><span class="ab-price" data-f="price"></span></h2>
    <ul class="ab-incl">
      <li>Licence personnelle, jusqu’à 3 appareils</li>
      <li>Téléchargement immédiat et clé de licence</li>
      <li>Mises à jour de la version achetée incluses</li>
    </ul>
    <div class="ab-consent">
      <label class="ab-check"><input type="checkbox" name="cgv"><span>J’ai lu et j’accepte les <a href="/cgv">conditions générales de vente</a> et la <a href="/cgv">licence d’utilisation</a>.</span></label>
      <label class="ab-check"><input type="checkbox" name="waiver"><span>Je demande l’accès immédiat au plugin et je reconnais perdre mon droit de rétractation dès le début du téléchargement (article L221-28 13° du Code de la consommation).</span></label>
    </div>
    <p class="ab-buymsg" role="status" aria-live="polite"></p>
    <div class="ab-dlg-act">
      <button type="submit" class="ab-btn acc wide" value="buy" data-f="cta">Continuer vers le paiement</button>
    </div>
    <div class="ab-dlg-done" hidden>
      <p class="ab-h3">Paiement bientôt disponible</p>
      <p class="ab-p">La boutique en ligne sera branchée ici. Rien n’a été payé ni enregistré.</p>
      <button type="button" class="ab-btn ghost sm" value="close">Fermer</button>
    </div>
    <div class="ab-pay" aria-label="Paiement"><span>paiement sécurisé</span><span>prix TTC</span><span>facture par e-mail</span></div>
  </form>`;
  doc.body.append(dlg);
  const form = $("form", dlg), msg = $(".ab-buymsg", dlg);
  $$("[value=close]", dlg).forEach(b => b.addEventListener("click", () => close()));
  dlg.addEventListener("click", e => { if (e.target === dlg) close(); });   // clic sur le fond
  dlg.addEventListener("cancel", e => { e.preventDefault(); close(); });
  $$("input", dlg).forEach(i => i.addEventListener("change", () => { msg.textContent = ""; msg.classList.remove("err"); }));
  form.addEventListener("submit", e => {
    e.preventDefault();
    const cgv = form.elements.cgv, waiver = form.elements.waiver;
    if (!cgv.checked || !waiver.checked) { msg.textContent = "Coche les deux cases pour continuer."; msg.classList.add("err"); (cgv.checked ? waiver : cgv).focus(); return; }
    const p = dlgProduct, detail = Object.freeze({ plugin: p.id, name: p.name, price: p.price, currency: p.currency,
      consent: Object.freeze({ cgv: true, cgvVersion: CGV_VERSION, immediateAccessWithdrawalWaiver: true, at: new Date().toISOString() }) });
    const ev = new CustomEvent("abrasion:buy", { detail, cancelable: true, bubbles: true });
    const handled = !doc.dispatchEvent(ev);
    if (!handled) { $(".ab-dlg-act", dlg).hidden = true; $(".ab-consent", dlg).hidden = true; msg.textContent = ""; const d = $(".ab-dlg-done", dlg); d.hidden = false; $("button", d).focus(); }
    else close();
  });
}
function open(id, opener) {
  const p = PRODUCTS[id]; if (!p) return;
  if (!dlg) buildDialog();
  dlgProduct = p; lastFocus = opener || doc.activeElement;
  dlg.className = "ab-dlg " + (p.id === "raw" ? "p-raw" : p.id === "omnis" ? "p-omnis" : "p-raw2");
  $("[data-f=world]", dlg).textContent = (p.world === "labs" ? "abrasion labs" : "abrasion") + " · " + p.kind;
  $("[data-f=name]", dlg).textContent = p.name; $("[data-f=price]", dlg).textContent = fmt(p);
  $("[data-f=cta]", dlg).textContent = "Continuer vers le paiement";
  const form = $("form", dlg); form.reset(); $(".ab-buymsg", dlg).textContent = ""; $(".ab-buymsg", dlg).classList.remove("err");
  $(".ab-dlg-act", dlg).hidden = false; $(".ab-consent", dlg).hidden = false; $(".ab-dlg-done", dlg).hidden = true;
  if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  doc.body.classList.add("ab-locked");
  setTimeout(() => form.elements.cgv.focus(), 30);
}
function close() {
  if (!dlg) return; if (typeof dlg.close === "function" && dlg.open) dlg.close(); else dlg.removeAttribute("open");
  doc.body.classList.remove("ab-locked"); if (lastFocus && lastFocus.focus) lastFocus.focus();
}
doc.addEventListener("click", e => { const b = e.target.closest("[data-buy]"); if (!b) return; e.preventDefault(); open(b.dataset.buy, b); });

/* ---------------------------------------------------------------- onglets (clavier compris) */
$$("[role=tablist]").forEach(list => {
  const tabs = $$("[role=tab]", list);
  const pick = (t, focus) => { tabs.forEach(o => { const on = o === t; o.setAttribute("aria-selected", String(on)); o.tabIndex = on ? 0 : -1;
      const p = doc.getElementById(o.getAttribute("aria-controls")); if (p) p.hidden = !on; });
    if (focus) t.focus(); if (innerWidth <= 900) t.scrollIntoView({ block: "nearest", inline: "center", behavior: RM ? "auto" : "smooth" }); };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => pick(t));
    t.addEventListener("keydown", e => { const k = e.key; let j = null;
      if (k === "ArrowDown" || k === "ArrowRight") j = (i + 1) % tabs.length; else if (k === "ArrowUp" || k === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
      else if (k === "Home") j = 0; else if (k === "End") j = tabs.length - 1;
      if (j !== null) { e.preventDefault(); pick(tabs[j], true); } });
  });
});

/* ---------------------------------------------------------------- thèmes (RAW 2) */
$$("[data-themes]").forEach(group => {
  const img = doc.getElementById(group.dataset.themes), cap = doc.getElementById(group.dataset.themes + "-cap");
  $$(".ab-theme", group).forEach(b => {
    b.addEventListener("pointerenter", () => { const i = new Image(); i.src = b.dataset.src; }, { once: true });
    b.addEventListener("click", () => {
      if (b.getAttribute("aria-pressed") === "true" || !img) return;
      $$(".ab-theme", group).forEach(o => o.setAttribute("aria-pressed", String(o === b)));
      const next = new Image(); next.src = b.dataset.src;
      const swap = () => { img.classList.add("swap"); setTimeout(() => { img.src = b.dataset.src; img.alt = b.dataset.alt; img.classList.remove("swap"); }, RM ? 0 : 200); if (cap) cap.textContent = b.dataset.label; };
      next.decode ? next.decode().then(swap, swap) : swap();
    });
  });
});

/* ---------------------------------------------------------------- loupe */
$$("[data-zoom]").forEach(btn => btn.addEventListener("click", () => {
  const src = doc.getElementById(btn.dataset.zoom); if (!src) return;
  const lb = doc.createElement("div"); lb.className = "ab-lb"; lb.setAttribute("role", "dialog"); lb.setAttribute("aria-modal", "true"); lb.setAttribute("aria-label", "Capture en grand");
  const p = doc.createElement("p"); p.textContent = "taille réelle · Échap pour fermer";
  const im = doc.createElement("img"); im.src = src.currentSrc || src.src; im.alt = src.alt;
  const x = doc.createElement("button"); x.type = "button"; x.className = "ab-btn ghost sm"; x.textContent = "Fermer";
  lb.append(p, im, x); doc.body.append(lb); doc.body.classList.add("ab-locked"); x.focus();
  const shut = () => { lb.remove(); doc.body.classList.remove("ab-locked"); removeEventListener("keydown", key); btn.focus(); };
  const key = e => { if (e.key === "Escape") shut(); if (e.key === "Tab") { e.preventDefault(); x.focus(); } };
  lb.addEventListener("click", shut); addEventListener("keydown", key);
}));

/* ---------------------------------------------------------------- points d'intérêt sur les captures */
$$("[data-hotspots]").forEach(fig => {
  const box = $(".ab-shot-in", fig), tip = doc.createElement("div"); tip.className = "ab-hot-tip"; tip.hidden = true; tip.id = "tip-" + Math.random().toString(36).slice(2, 8);
  tip.setAttribute("role", "tooltip"); box.append(tip);
  let cur = null;
  const show = h => { cur = h; $$(".ab-hot", box).forEach(o => o.setAttribute("aria-expanded", String(o === h)));
    tip.replaceChildren(); const b = doc.createElement("b"); b.textContent = h.dataset.t; tip.append(b, doc.createTextNode(h.dataset.d)); tip.hidden = false;
    const W = box.clientWidth, x = h.offsetLeft, y = h.offsetTop, tw = Math.min(270, W * .7);
    tip.style.left = Math.max(8, Math.min(W - tw - 8, x - tw / 2)) + "px";
    tip.style.top = (y > box.clientHeight * .6 ? y - tip.offsetHeight - 22 : y + 22) + "px"; h.setAttribute("aria-describedby", tip.id); };
  const hide = () => { cur = null; tip.hidden = true; $$(".ab-hot", box).forEach(o => o.setAttribute("aria-expanded", "false")); };
  $$(".ab-hot", box).forEach(h => {
    h.style.left = (+h.dataset.x || 50) + "%"; h.style.top = (+h.dataset.y || 50) + "%";
    h.setAttribute("aria-expanded", "false");
    h.addEventListener("click", () => cur === h ? hide() : show(h));
    h.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") show(h); });
    h.addEventListener("focus", () => show(h)); h.addEventListener("blur", hide);
  });
  box.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") hide(); });
  addEventListener("keydown", e => { if (e.key === "Escape" && cur) hide(); });
});

/* ---------------------------------------------------------------- démo IA (OMNIS) */
$$("[data-ia]").forEach(box => {
  const line = $(".ab-ia-bar span", box), out = $$(".ab-ia-out div", box), text = box.dataset.ia;
  if (RM) { line.textContent = text; out.forEach(o => o.classList.add("on")); return; }
  let running = false;
  const run = async () => {
    if (running) return; running = true;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    while (true) {
      line.textContent = ""; out.forEach(o => o.classList.remove("on"));
      for (let i = 1; i <= text.length; i++) { line.textContent = text.slice(0, i); await wait(34 + Math.random() * 40); }
      await wait(500);
      for (const o of out) { o.classList.add("on"); await wait(420); }
      await wait(4200);
    }
  };
  new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { o.disconnect(); run(); } }, { threshold: .4 }).observe(box);
});

/* ---------------------------------------------------------------- sommaire de la page légale */
const toc = $(".ab-toc");
if (toc) {
  const links = $$("a", toc), secs = links.map(a => doc.getElementById(a.hash.slice(1))).filter(Boolean);
  const mark = id => links.forEach(a => a.setAttribute("aria-current", String(a.hash === "#" + id)));
  const tocIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) mark(e.target.id); }), { rootMargin: "-25% 0px -65% 0px" });
  secs.forEach(s => tocIO.observe(s));
  if (location.hash) mark(location.hash.slice(1));
}

/* ---------------------------------------------------------------- année */
$$("[data-year]").forEach(el => { el.textContent = String(new Date().getFullYear()); });

/* ---------------------------------------------------------------- petit bonhomme d'aide
   Présent seulement sur les pages qui portent data-buddy. Il monte une fois par
   visite, donne une astuce, puis redescend. Le bouton « ? » le rappelle.       */
const tipsAttr = doc.body.dataset.buddy;
if (tipsAttr) {
  const touch = matchMedia("(hover: none)").matches;
  const adapt = s => touch ? s.replace(/Survole/g, "Touche").replace(/survole/g, "touche").replace(/bouge sur/g, "glisse sur").replace(/Clique/g, "Touche").replace(/clique/g, "touche") : s;
  const TIPS = tipsAttr.split("|").map(s => s.trim()).filter(Boolean);
  const el = doc.createElement("div"); el.className = "ab-buddy";
  el.innerHTML = '<div class="ab-bubble" role="status" aria-live="polite"><p></p><button class="ab-bx" type="button" aria-label="Fermer l’aide">×</button></div>' +
    '<button class="ab-bot" type="button" aria-label="Petite aide : astuce suivante"><svg viewBox="0 0 12 16" aria-hidden="true"></svg></button>';
  const help = doc.createElement("button"); help.className = "ab-help"; help.type = "button"; help.setAttribute("aria-label", "Afficher la petite aide"); help.textContent = "?";
  doc.body.append(el, help);
  const say = $("p", el), svg = $("svg", el);
  const PAL = { W: "#ffffff", L: "#cfd3da", M: "#8d939e", D: "#4b505a", V: "#0b0d12", G: "#9fb3ff" };
  const IDLE = ["....MMMM....", "...MLLLLM...", "..MLWWLLLM..", "..MVVVVVVM..", "..MVGVVGVM..", "..MLLLLLLM..", "...MMMMMM...", ".....DD.....",
    "...MLLLLM...", "..MLWLLLLM..", ".DMLWLLLLMD.", ".DMLLLLLLMD.", ".L.MLLLLM.L.", "...MMDDMM...", "...ML..LM...", "..DDD..DDD.."];
  const WAVE = IDLE.slice(); WAVE[8] = "...MLLLLM.L."; WAVE[9] = "..MLWLLLLMD."; WAVE[10] = ".DMLWLLLLM.."; WAVE[11] = ".DMLLLLLLM.."; WAVE[12] = ".L.MLLLLM...";
  const NS = "http://www.w3.org/2000/svg";
  const paint = m => { svg.replaceChildren(); m.forEach((row, y) => [...row].forEach((c, x) => { if (!PAL[c]) return; const r = doc.createElementNS(NS, "rect");
    r.setAttribute("x", x); r.setAttribute("y", y); r.setAttribute("width", 1); r.setAttribute("height", 1); r.setAttribute("fill", PAL[c]); svg.append(r); })); };
  paint(IDLE);
  let i = 0, hideT, waveT; const seen = new Set();
  const show = text => { say.textContent = adapt(text); el.classList.add("up"); help.classList.add("away");
    paint(WAVE); clearTimeout(waveT); waveT = setTimeout(() => paint(IDLE), 900);
    clearTimeout(hideT); hideT = setTimeout(hide, Math.max(5200, text.length * 72)); };
  const hide = () => { el.classList.remove("up"); help.classList.remove("away"); clearTimeout(hideT); };
  el.addEventListener("pointerenter", () => clearTimeout(hideT));
  el.addEventListener("pointerleave", () => { if (el.classList.contains("up")) hideT = setTimeout(hide, 3000); });
  $(".ab-bot", el).addEventListener("click", () => show(TIPS[i = (i + 1) % TIPS.length]));
  $(".ab-bx", el).addEventListener("click", () => { hide(); help.focus(); });
  help.addEventListener("click", () => show(TIPS[i]));
  addEventListener("keydown", e => { if (e.key === "Escape" && el.classList.contains("up")) hide(); });
  const key = "ab-buddy:" + (doc.body.dataset.page || "p");
  if (!store.get(key)) { store.set(key, "1"); setTimeout(() => show(TIPS[0]), 2200); }
  $$("[data-tip]").forEach(card => { let t;
    card.addEventListener("pointerenter", e => { if (e.pointerType !== "mouse" || seen.has(card)) return; t = setTimeout(() => { seen.add(card); show(card.dataset.tip); }, 1700); });
    card.addEventListener("pointerleave", () => clearTimeout(t)); });
}
})();
