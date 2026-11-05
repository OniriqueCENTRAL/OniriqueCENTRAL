/* ==========================================================================
   abrasion — écrans animés des plugins (aucune dépendance)
     [data-ascii-scope]      oscilloscope ASCII de RAW (s'emballe au survol)
     canvas[data-viz=omnis]  goniomètre + spectre d'OMNIS
     canvas[data-viz=life]   automate cellulaire de RAW 2 (on peut y semer des cellules)
   Chaque écran ne tourne que lorsqu'il est visible.
   ========================================================================== */
(() => {
"use strict";
if (!("IntersectionObserver" in window) || !("ResizeObserver" in window)) return;
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const vis = new WeakMap();
const io = new IntersectionObserver(es => es.forEach(e => vis.set(e.target, e.isIntersecting)), { rootMargin: "120px" });
const live = el => vis.get(el) && !document.hidden;
const MONO = '"Space Mono", monospace';

/* ------------------------------------------------ RAW : oscilloscope ASCII */
document.querySelectorAll("[data-ascii-scope]").forEach(box => {
  const host = box.closest("[data-play]") || box, sc = box.querySelector(".sc"), fl = box.querySelector(".fl");
  const COLS = +box.dataset.cols || 46, ROWS = +box.dataset.rows || 11;
  let e = .18, target = .18, ph = 0, last = 0;
  const on = () => { target = 1; host.classList.add("play"); }, off = () => { target = .18; host.classList.remove("play"); };
  host.addEventListener("pointerenter", ev => { if (ev.pointerType === "mouse") on(); });
  host.addEventListener("pointerleave", ev => { if (ev.pointerType === "mouse") off(); });
  host.addEventListener("focusin", on); host.addEventListener("focusout", ev => { if (!host.contains(ev.relatedTarget)) off(); });
  host.addEventListener("pointerdown", ev => { if (ev.pointerType !== "mouse" && !ev.target.closest("a,button")) (target > .5 ? off : on)(); });
  io.observe(box);
  const FLOW = [
    ["          ", "   .-.    ", "  ( @ )   ", "   '-'    ", "    |     ", "   \\|     ", "    |/    ", "    |     "],
    [" \\  |  /  ", "  .-'-.   ", "-( (@) )- ", "  '-.-'   ", "  / | \\   ", "   \\|     ", "    |/    ", "    |     "],
  ];
  function frame(dt) {
    e += (target - e) * Math.min(1, dt * 4); ph += dt * (1 + e * 3);
    const g = Array.from({ length: ROWS }, () => Array(COLS).fill(" ")), ys = [];
    for (let i = 0; i <= COLS; i++) {
      const a = Math.sin(i * .34 + ph * 2.2) * .62 + Math.sin(i * .11 - ph * .9) * .38;
      const b = ((i * .9 + ph * 4) % (Math.PI * 2)) / Math.PI - 1;
      ys.push((a * .7 + b * .3 * e) * e);
    }
    const mid = (ROWS - 1) >> 1;
    for (let i = 0; i < COLS; i++) {
      const y = ys[i], r = Math.round((1 - (clamp(y, -1, 1) + 1) / 2) * (ROWS - 1)), dy = ys[i + 1] - y;
      if (g[mid][i] === " ") g[mid][i] = i % 2 ? " " : "·";
      g[r][i] = Math.abs(dy) < .06 ? (y > 0 ? "~" : "_") : dy > 0 ? "/" : "\\";
      if (e > .45) for (let k = r + 1; k < ROWS; k++) if ((i + k) % 3 === 0 && Math.random() < e * .5) g[k][i] = k === ROWS - 1 ? "." : ":";
    }
    const bar = Math.round(e * 16);
    sc.textContent = "OSC.A ~ SIN    OSC.B /| SAW\n" + "-".repeat(COLS) + "\n" + g.map(r => r.join("")).join("\n") + "\n" + "-".repeat(COLS) +
      "\nOUT [" + "#".repeat(bar) + ".".repeat(16 - bar) + "] " + (-24 + e * 21).toFixed(1).padStart(5) + " dB";
    if (fl) { const f = FLOW[e > .6 ? 1 : 0], sway = Math.round(Math.sin(ph * 1.3) * e * 1.2);
      fl.textContent = f.map((l, i) => i < 4 && sway ? (sway > 0 ? " " + l.slice(0, -1) : l.slice(1) + " ") : l).join("\n"); }
  }
  frame(0);
  if (RM) return;
  (function loop(t) { requestAnimationFrame(loop); if (!live(box) || t - last < 70) return; const dt = last ? (t - last) / 1000 : .07; last = t; frame(Math.min(dt, .2)); })(0);
});

/* ------------------------------------------------ boucle générique pour un canvas */
function screen(canvas, draw, fps = 30) {
  const x = canvas.getContext("2d"); let w = 0, h = 0, last = 0;
  const step = now => { if (w > 2) draw(x, w, h, now / 1000); };
  const size = () => { const r = canvas.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    if (Math.abs(r.width - w) < .5 && Math.abs(r.height - h) < .5 && canvas.width > 1) return;
    w = r.width; h = r.height;
    canvas.width = Math.max(1, Math.round(w * d)); canvas.height = Math.max(1, Math.round(h * d)); x.setTransform(d, 0, 0, d, 0, 0); x.fillStyle = "#050505"; x.fillRect(0, 0, w, h);
    step(performance.now());                       // redessine tout de suite (sinon écran noir si les animations sont réduites)
  };
  size(); new ResizeObserver(size).observe(canvas); io.observe(canvas);
  if (RM) return;
  (function loop(now) { requestAnimationFrame(loop); if (!live(canvas) || now - last < 1000 / fps) return; last = now; step(now); })(0);
}

/* ------------------------------------------------ OMNIS : goniomètre + spectre */
document.querySelectorAll('canvas[data-viz="omnis"]').forEach(cv => screen(cv, (x, w, h, t) => {
  const amb = "255,170,0";
  x.fillStyle = "rgba(5,5,6,.28)"; x.fillRect(0, 0, w, h);
  const gw = Math.min(h, w * .42), R = gw * .36, gx = gw * .52, gy = h * .5;
  x.strokeStyle = "rgba(255,255,255,.12)"; x.lineWidth = 1; x.beginPath();
  x.moveTo(gx - R, gy - R); x.lineTo(gx + R, gy + R); x.moveTo(gx + R, gy - R); x.lineTo(gx - R, gy + R); x.moveTo(gx, gy - R * 1.2); x.lineTo(gx, gy + R * 1.2); x.stroke();
  x.fillStyle = `rgba(${amb},.6)`;
  for (let i = 0; i < 220; i++) {
    const k = t * 1.7 + i * .029, L = Math.sin(k * 3.1) * .6 + Math.sin(k * 7.3 + 1) * .3 + (Math.random() - .5) * .18;
    const Rr = L * .5 + Math.sin(k * 5.2 + 2) * .4 + (Math.random() - .5) * .12, mid = (L + Rr) / 2, side = (L - Rr) / 2;
    x.fillRect(gx + side * R * 1.6, gy - mid * R, 1.4, 1.4);
  }
  const sx0 = gw + 6, sw = w - sx0 - 10, top = h * .16, bot = h * .82;
  x.fillStyle = "#050506"; x.fillRect(gw, 0, w - gw, h);
  x.strokeStyle = "rgba(255,255,255,.06)"; x.beginPath();
  for (let i = 0; i <= 6; i++) { const yy = top + (bot - top) * i / 6; x.moveTo(sx0, yy); x.lineTo(sx0 + sw, yy); }
  for (const f of [.12, .33, .55, .77]) { x.moveTo(sx0 + sw * f, top); x.lineTo(sx0 + sw * f, bot); } x.stroke();
  const N = 90, ys = [], peaks = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, base = .32 + u * .42 - Math.exp(-Math.pow((u - .06) * 9, 2)) * .25;
    const wob = Math.sin(u * 23 + t * 2.1) * .04 + Math.sin(u * 61 - t * 3.7) * .025 + Math.sin(u * 7 + t * .8) * .05;
    ys.push(top + (bot - top) * clamp(base + wob, .04, .98));
  }
  for (let i = 3; i < N - 3; i++) if (ys[i] < ys[i - 2] && ys[i] < ys[i + 2] && ys[i] < ys[i - 1] && ys[i] < ys[i + 1]) peaks.push(i);
  const gr = x.createLinearGradient(0, top, 0, bot); gr.addColorStop(0, `rgba(${amb},.28)`); gr.addColorStop(1, `rgba(${amb},0)`);
  x.beginPath(); x.moveTo(sx0, bot); ys.forEach((y, i) => x.lineTo(sx0 + sw * i / N, y)); x.lineTo(sx0 + sw, bot); x.closePath(); x.fillStyle = gr; x.fill();
  x.beginPath(); ys.forEach((y, i) => i ? x.lineTo(sx0 + sw * i / N, y) : x.moveTo(sx0, y)); x.strokeStyle = `rgb(${amb})`; x.lineWidth = 1.4; x.stroke();
  x.setLineDash([3, 4]); x.beginPath(); for (let i = 0; i <= N; i++) { const u = i / N; x.lineTo(sx0 + sw * u, top + (bot - top) * (.36 + u * .4)); }
  x.strokeStyle = "rgba(255,255,255,.35)"; x.lineWidth = 1; x.stroke(); x.setLineDash([]);
  x.font = `9px ${MONO}`; x.textBaseline = "top"; x.strokeStyle = "#fff"; x.fillStyle = "#fff";
  peaks.slice(0, 4).forEach((i, n) => { const px = sx0 + sw * i / N, py = ys[i], s = 12 + n * 3;
    x.strokeRect(Math.round(px - s / 2) + .5, Math.round(py - s / 2) + .5, s, s); x.fillText(String(1652 + i), px + s / 2 + 4, py - s / 2 - 1); });
  x.fillStyle = "rgba(255,255,255,.55)"; x.fillText("GONIO", 10, 9); x.fillText("SPECTRE · CIBLE", sx0, 9);
  const mods = ["SUB", "MEQ", "INF", "IMG", "MB", "CLP", "LIM"], mw = (w - 20) / mods.length;
  mods.forEach((m, i) => { const lit = Math.sin(t * 2 + i * 1.3) > -.2; x.fillStyle = "#050506"; x.fillRect(8 + i * mw, h - 21, mw - 2, 14);
    x.fillStyle = lit ? `rgb(${amb})` : "rgba(255,255,255,.18)"; x.fillRect(10 + i * mw, h - 16, 5, 5); x.fillStyle = "rgba(255,255,255,.5)"; x.fillText(m, 18 + i * mw, h - 18); });
}));

/* ------------------------------------------------ RAW 2 : automate cellulaire (B3/S23) */
document.querySelectorAll('canvas[data-viz="life"]').forEach(cv => {
  const C = +cv.dataset.cols || 64, R = +cv.dataset.rows || 32;
  let g = new Uint8Array(C * R), age = new Float32Array(C * R), gen = 0, head = 0, lastStep = 0, notes = [];
  const seed = () => { for (let i = 0; i < g.length; i++) g[i] = Math.random() < .2 ? 1 : 0; gen = 0; };
  const put = (cx, cy) => { g[((cy + R) % R) * C + (cx + C) % C] = 1; };
  const glider = (cx, cy) => [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]].forEach(([a, b]) => put(cx + a, cy + b));
  seed();
  function step() {
    const n = new Uint8Array(C * R); let alive = 0;
    for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
      let k = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (i || j) k += g[((y + j + R) % R) * C + (x + i + C) % C];
      const v = g[y * C + x], o = (v && (k === 2 || k === 3)) || (!v && k === 3) ? 1 : 0; n[y * C + x] = o; alive += o; if (v && !o) age[y * C + x] = 1;
    }
    g = n; gen++; head = (head + 1) % C;
    if (alive < C * R * .04 || gen > 520) seed();
    if (Math.random() < .08) glider(Math.floor(Math.random() * C), Math.floor(Math.random() * R));
    const now = performance.now(); let runs = 0;
    for (let y = 0; y < R && runs < 4; y++) if (g[y * C + head]) { let y1 = y; while (y1 + 1 < R && g[(y1 + 1) * C + head]) y1++; notes.push({ x: head, y0: y, y1, t: now }); runs++; y = y1 + 1; }
    notes = notes.filter(q => now - q.t < 900);
  }
  const NN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const sow = e => { const r = cv.getBoundingClientRect(), cx = Math.floor((e.clientX - r.left) / r.width * C), cy = Math.floor((e.clientY - r.top) / r.height * R);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (Math.random() < .7) put(cx + i, cy + j); if (RM) draw(); };
  cv.addEventListener("pointerdown", sow); cv.addEventListener("pointermove", e => { if (e.buttons) sow(e); });
  let draw = () => {};
  screen(cv, (x, w, h, t) => {
    draw = () => paint(x, w, h);
    if (t * 1000 - lastStep > 110) { lastStep = t * 1000; step(); }
    paint(x, w, h);
  }, 30);
  function paint(x, w, h) {
    const cw = w / C, ch = h / R, now = performance.now();
    x.fillStyle = "#0a0705"; x.fillRect(0, 0, w, h);
    for (let y = 0; y < R; y++) for (let i = 0; i < C; i++) {
      const k = y * C + i;
      if (g[k]) { x.fillStyle = i === head ? "#fff" : "#ff4d00"; x.fillRect(i * cw + .5, y * ch + .5, cw - 1, ch - 1); }
      else if (age[k] > .02) { x.fillStyle = `rgba(255,77,0,${age[k] * .28})`; x.fillRect(i * cw + .5, y * ch + .5, cw - 1, ch - 1); age[k] *= .9; }
    }
    x.fillStyle = "rgba(255,255,255,.07)"; x.fillRect(head * cw, 0, cw, h);
    x.strokeStyle = "#fff"; x.fillStyle = "#fff"; x.lineWidth = 1; x.font = `9px ${MONO}`; x.textBaseline = "top";
    for (const q of notes) {
      const a = 1 - (now - q.t) / 900; if (a <= 0) continue;
      x.globalAlpha = a; const bx = q.x * cw - 3, by = q.y0 * ch - 3, bw = cw + 6, bh = (q.y1 - q.y0 + 1) * ch + 6;
      x.strokeRect(Math.round(bx) + .5, Math.round(by) + .5, Math.round(bw), Math.round(bh));
      x.fillText(NN[(R - q.y0) % 12] + (2 + Math.floor((R - q.y0) / 12)), bx + bw + 4, by);
    }
    x.globalAlpha = 1; x.fillStyle = "rgba(0,0,0,.72)"; x.fillRect(6, 6, 150, 15);
    x.fillStyle = "rgba(255,255,255,.78)"; x.fillText("VIE · B3/S23 · GEN " + String(gen).padStart(4, "0"), 10, 9);
  }
});
})();
