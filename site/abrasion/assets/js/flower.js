/* ==========================================================================
   abrasion — la fleur ASCII de la page RAW (décor de fond)
   Une fleur low poly en 3D (trois couronnes de pétales, un cœur, une tige),
   rastérisée en caractères. Elle tourne doucement et s'ouvre au fil du
   défilement, jusqu'à la section d'achat. Quand RAW « joue » (survol de
   l'oscilloscope), elle palpite. Un brouillard de caractères l'entoure.
   ========================================================================== */
(() => {
"use strict";
const fl = document.querySelector(".ab-flower"); if (!fl) return;
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fx = fl.getContext("2d");
const openAt = document.querySelector(fl.dataset.openAt || "#acheter");
const host = document.querySelector("[data-play]");
const TAU = Math.PI * 2, clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t, smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const FONT = '"Space Mono",ui-monospace,Menlo,Consolas,monospace';

/* palette : blanc vers gris, 8 teintes × 6 niveaux */
const MAG = [255, 255, 255], CY = [140, 140, 140], HUES = 8, LEVELS = 6, pal = [""];
for (let h = 0; h < HUES; h++) { const base = MAG.map((m, i) => lerp(m, CY[i], h / (HUES - 1)));
  for (let l = 0; l < LEVELS; l++) { const k = .3 + .7 * l / (LEVELS - 1); pal.push("rgb(" + base.map(v => Math.round(v * k)).join(",") + ")"); } }
const RAMP = " .:-=+*#%@", FOGR = ".,:;+*", FOGC = [.16, .28, .4, .52, .66, .8].map(a => "rgba(255,255,255," + a + ")");

let W, H, fs, cw, ch, cols, rows, zb, chi, ci;
function resize() {
  W = innerWidth; H = innerHeight; const d = Math.min(2, devicePixelRatio || 1);
  fl.width = Math.round(W * d); fl.height = Math.round(H * d); fx.setTransform(d, 0, 0, d, 0, 0);
  fs = clamp(W / 105, 11, 17); fx.font = "700 " + fs + "px " + FONT; fx.textBaseline = "top";
  cw = fx.measureText("M").width || fs * .6; ch = fs * 1.15;
  cols = Math.ceil(W / cw); rows = Math.ceil(H / ch);
  zb = new Float32Array(cols * rows); chi = new Uint8Array(cols * rows); ci = new Uint8Array(cols * rows);
}

/* fleur : triangles 3D */
const rotX = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; };
const rotY = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };
const RINGS = [{ n: 7, len: 1, w: .34, off: 0, p0: .1, p1: 1.5, d: 0 }, { n: 7, len: .84, w: .32, off: .5, p0: .08, p1: 1.12, d: .18 }, { n: 6, len: .62, w: .28, off: .25, p0: .06, p1: .72, d: .36 }];
function buildFlower(open, pulse, t) {
  const tris = []; let face = 0;
  RINGS.forEach((r, ri) => {
    const o = smooth((open - r.d) / (1 - r.d)), phi = lerp(r.p0, r.p1, o) + pulse * (ri === 0 ? .12 : .08);
    const L = r.len, w = r.w * lerp(.75, 1, o), curl = lerp(-.25, .14, o) * L, z0 = .06 + .02 * ri;
    for (let i = 0; i < r.n; i++) {
      const az = (i + r.off) / r.n * TAU + ri * .35, wob = Math.sin(t * 2 + i) * pulse * .05;
      const tf = v => rotY(rotX([v[0], v[1], v[2] + z0], phi + wob), az);
      const B = tf([0, 0, 0]), Lf = tf([-w, .42 * L, .03 * L * (1 - o)]), Rt = tf([w, .42 * L, .03 * L * (1 - o)]), M = tf([0, .55 * L, -.06 * L]), T = tf([0, L, curl]);
      tris.push([B, Lf, M, face++], [B, M, Rt, face++], [Lf, T, M, face++], [M, T, Rt, face++]);
    }
  });
  const r = .17 + pulse * .05, C = [0, .1 + pulse * .03, 0], sp = t * .8;
  const oc = [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]].map(v => { const q = rotY(v, sp); return [q[0] + C[0], q[1] + C[1], q[2] + C[2]]; });
  [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]].forEach(f => tris.push([oc[f[0]], oc[f[1]], oc[f[2]], face++]));
  const top = [], bot = [];
  for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + .4; top.push([Math.cos(a) * .045, -.05, Math.sin(a) * .045]); bot.push([Math.cos(a) * .06, -1.7, Math.sin(a) * .06]); }
  for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; tris.push([top[k], top[k2], bot[k], face++], [top[k2], bot[k2], bot[k], face++]); }
  return tris;
}

/* rastérisation en cellules ASCII */
let cx, cy, S, ry, tilt, boost;
function raster(tri) {
  const V = [], P = [];
  for (let k = 0; k < 3; k++) { const v = rotX(rotY(tri[k], ry), tilt); V.push(v); const f = 6 / (6 - v[2]); P.push([cx + v[0] * S * f, cy - v[1] * S * f, v[2]]); }
  const ux = V[1][0] - V[0][0], uy = V[1][1] - V[0][1], uz = V[1][2] - V[0][2], vx = V[2][0] - V[0][0], vy = V[2][1] - V[0][1], vz = V[2][2] - V[0][2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const lam = Math.min(1, Math.abs((nx * .3 + ny * .6 + nz * .75) / ((Math.hypot(nx, ny, nz) || 1) * 1.01)));
  const a = P[0], b = P[1], c = P[2], area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]), A = Math.abs(area); if (A < 1e-3) return;
  const e0 = Math.hypot(b[0] - c[0], b[1] - c[1]) || 1, e1 = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1, e2 = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) / cw)), x1 = Math.min(cols - 1, Math.floor(Math.max(a[0], b[0], c[0]) / cw));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) / ch)), y1 = Math.min(rows - 1, Math.floor(Math.max(a[1], b[1], c[1]) / ch));
  const br = clamp(.25 + .75 * lam + boost, 0, 1), hue = Math.floor((((tri[3] * .173 + .4 * lam) % 1) + 1) % 1 * HUES);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = (x + .5) * cw, py = (y + .5) * ch;
    const w0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area, w1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area, w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const z = w0 * a[2] + w1 * b[2] + w2 * c[2], i = y * cols + x; if (z <= zb[i]) continue; zb[i] = z;
    const d = Math.min(w0 * A / e0, w1 * A / e1, w2 * A / e2);
    if (d < cw * .9) { chi[i] = 7; ci[i] = 1 + hue * LEVELS + (LEVELS - 1); }
    else { chi[i] = 1 + Math.floor(br * 5.99); ci[i] = 1 + hue * LEVELS + Math.floor(br * (LEVELS - 1)); }
  }
}

/* boucle */
let t = 0, pulse = 0, last = 0, visible = true;
function draw(dt) {
  t += dt;
  const playing = host && host.classList.contains("play");
  pulse = playing ? .5 + .5 * Math.sin(t * 6) : Math.max(0, pulse - dt * 1.8);
  const sy = scrollY, tgt = openAt ? Math.max(1, openAt.getBoundingClientRect().top + sy - H * .62) : Math.max(1, document.documentElement.scrollHeight - H);
  const open = smooth(clamp(sy / tgt, 0, 1));
  cx = W / 2; cy = H * lerp(.47, .36, open); S = Math.min(W * .4, H * .3);
  ry = .6 + (RM ? 0 : t * .3) + sy * .0015; tilt = lerp(.12, .72, open); boost = pulse * .25;
  zb.fill(-1e9); chi.fill(0);
  buildFlower(open, pulse, t).forEach(raster);
  fx.clearRect(0, 0, W, H);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const i = y * cols + x, c = chi[i]; if (!c) continue; fx.fillStyle = pal[ci[i]]; fx.fillText(RAMP[c], x * cw, y * ch); }
  const tt = RM ? 0 : t, fo = .12 + .88 * open + pulse * .25;           // brouillard ASCII
  for (let y = 0; y < rows; y++) {
    const ny = (y / rows - .5) * 2, py = (y + .5) * ch;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x; if (chi[i]) continue;
      const nx = (x / cols - .5) * 2, px = (x + .5) * cw;
      const corner = Math.pow(clamp((Math.abs(nx) * Math.abs(ny) - .15) / .85, 0, 1), .8);
      const fm = clamp(1 - Math.hypot((px - cx) / (S * 1.35), (py - cy) / S), 0, 1) * fo, dens = Math.max(corner * .9, fm);
      if (dens < .06) continue;
      const f = Math.sin(x * .13 + tt * .4) + Math.sin((y + tt * 2) * .19) + Math.sin((x + y) * .08 + tt * .25) + Math.sin(Math.hypot(x - cols / 2, y - rows / 2) * .15 - tt * .5);
      const v = (f + 4) / 8 * dens * 1.3; if (v < .3) continue;
      const k = Math.min(5, Math.floor((v - .3) * 8)); fx.fillStyle = FOGC[k]; fx.fillText(FOGR[k], x * cw, y * ch);
    }
  }
  fl.style.setProperty("--fo", String(lerp(1, .75, open)));
}
resize(); draw(0);
addEventListener("resize", () => { clearTimeout(resize.t); resize.t = setTimeout(() => { resize(); draw(0); }, 120); });
document.fonts && document.fonts.ready.then(() => { resize(); draw(0); });
if (RM) { let q = false; addEventListener("scroll", () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; draw(0); }); }, { passive: true }); return; }
document.addEventListener("visibilitychange", () => { last = 0; });
(function loop(now) {
  requestAnimationFrame(loop);
  if (document.hidden || now - last < 33) return;                     // ~30 images/s suffisent
  const dt = last ? Math.min((now - last) / 1000, .1) : .033; last = now; draw(dt);
})(0);
})();
