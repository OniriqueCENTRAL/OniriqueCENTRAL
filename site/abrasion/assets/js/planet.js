/* ==========================================================================
   abrasion — la petite planète de l'accueil (décor de fond, WebGL sans librairie)
   Terre low poly : continents, océans, calottes, cinq cratères de lave d'où
   montent flammes, fumée et étincelles. Elle apparaît, tourne, et suit un peu
   la souris. Rendu en demi-résolution, pixelisé, comme le site d'origine.

   Placement :
   - écran large : centrée dans la colonne de droite du hero (.ab-planet-slot) ;
   - écran étroit (téléphone, fenêtre réduite) : elle passe DERRIÈRE le titre,
     entre le fond étoilé et le texte.
   Trois calques empilés dans le hero : halo (2D) · planète (WebGL) · flammes (2D).
   ========================================================================== */
(() => {
"use strict";
const hero = document.querySelector("[data-planet]");
if (!hero || !("IntersectionObserver" in window) || !("ResizeObserver" in window)) return;
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const backC = hero.querySelector(".ab-pl-back"), glc = hero.querySelector(".ab-pl-gl"), frontC = hero.querySelector(".ab-pl-front"), slot = hero.querySelector(".ab-planet-slot");
let gl = null; try { gl = glc.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false }); } catch (e) { gl = null; }
if (!gl) { hero.classList.add("no-planet"); return; }
const bx = backC.getContext("2d"), fx = frontC.getContext("2d");

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
const hsh = n => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dirLL = (lat, lon) => { const a = lat * Math.PI / 180, b = lon * Math.PI / 180; return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)]; };

/* ---------------------------------------------------------------- géométrie */
const CRATERS = [[22, 80, .26], [-14, 205, .22], [34, 300, .24], [-32, 20, .2], [8, 150, .18]].map(c => ({ n: dirLL(c[0], c[1]), a: c[2], d: c[2] * .3 }));
const land = n => Math.sin(n[0] * 3.1 + 1.3) * Math.sin(n[1] * 2.7 + .4) + .8 * Math.sin(n[2] * 3.7 + n[0] * 1.9) + .35 * Math.sin(n[1] * 5.3 + n[2] * 2.1);
const radiusAt = n => {
  let r = 1 + (land(n) > .15 ? .022 : 0);
  for (const c of CRATERS) { const t = Math.acos(clamp(dot(n, c.n), -1, 1)) / c.a; if (t < 1) r -= c.d * (1 - t * t); else if (t < 1.25) r += .018 * (1 - (t - 1) / .25); }
  return r;
};
const G = (1 + Math.sqrt(5)) / 2;
const IV = [[-1, G, 0], [1, G, 0], [-1, -G, 0], [1, -G, 0], [0, -1, G], [0, 1, G], [0, -1, -G], [0, 1, -G], [G, 0, -1], [G, 0, 1], [-G, 0, -1], [-G, 0, 1]].map(norm);
const IF = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
const SUB = 8, P = [], NR = [], CO = [], EM = [], cache = new Map(); let face = 0;
function vtx(A, B, C, i, j) {
  const p = norm([A[0] + (B[0] - A[0]) * i / SUB + (C[0] - A[0]) * j / SUB, A[1] + (B[1] - A[1]) * i / SUB + (C[1] - A[1]) * j / SUB, A[2] + (B[2] - A[2]) * i / SUB + (C[2] - A[2]) * j / SUB]);
  const key = p[0].toFixed(4) + "," + p[1].toFixed(4) + "," + p[2].toFixed(4);
  let r = cache.get(key); if (r === undefined) { r = radiusAt(p); cache.set(key, r); }
  return [p[0] * r, p[1] * r, p[2] * r];
}
function tri(a, b, c) {
  const cen = norm([a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]]), L = land(cen), v = hsh(face++ * 3 * .731);
  let col = L > .15 ? (L > .7 ? [.46 + .06 * v, .4, .28] : [.22 + .1 * v, .52 + .08 * v, .27]) : (L > .05 ? [.14, .42 + .06 * v, .7] : [.09 + .04 * v, .28 + .08 * v, .6 + .08 * v]);
  if (Math.abs(cen[1]) > .86) col = [.9 + .08 * v, .94 + .05 * v, 1];
  let lava = 0;
  for (const cr of CRATERS) { const ang = Math.acos(clamp(dot(cen, cr.n), -1, 1));
    if (ang < cr.a * .65) { lava = 1; col = [1, .3 + .4 * v, .05 + .05 * v]; } else if (ang < cr.a * 1.1 && !lava) col = [.17 + .05 * v, .1, .08]; }
  let n = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
  if (dot(n, cen) < 0) n = [-n[0], -n[1], -n[2]];
  for (const p of [a, b, c]) { P.push(p[0], p[1], p[2]); NR.push(n[0], n[1], n[2]); CO.push(col[0], col[1], col[2]); EM.push(lava); }
}
for (const f of IF) {
  const A = IV[f[0]], B = IV[f[1]], C = IV[f[2]];
  for (let i = 0; i < SUB; i++) for (let j = 0; j < SUB - i; j++) {
    tri(vtx(A, B, C, i, j), vtx(A, B, C, i + 1, j), vtx(A, B, C, i, j + 1));
    if (i + j < SUB - 1) tri(vtx(A, B, C, i + 1, j), vtx(A, B, C, i + 1, j + 1), vtx(A, B, C, i, j + 1));
  }
}
const COUNT = P.length / 3;

/* ---------------------------------------------------------------- WebGL */
const VS = "attribute vec3 aP;attribute vec3 aN;attribute vec3 aC;attribute float aE;uniform mat3 uR;uniform vec2 uC;uniform vec2 uS;" +
  "varying vec3 vN;varying vec3 vP;varying vec3 vC;varying float vE;" +
  "void main(){vec3 p=uR*aP;vP=p;vN=uR*aN;vC=aC;vE=aE;float k=1./(1.-p.z*.07);gl_Position=vec4(uC+p.xy*uS*k,-p.z*.3,1.);}";
const FS = "precision mediump float;uniform vec3 uSun;uniform vec3 uLP[5];uniform float uLI[5];uniform float uLava;" +
  "varying vec3 vN;varying vec3 vP;varying vec3 vC;varying float vE;" +
  "void main(){vec3 n=normalize(vN);vec3 c;" +
  "if(vE>.5){c=vC*uLava;}else{vec3 l=vec3(.08,.124,.2)+vec3(1.35,1.27,1.13)*max(dot(n,uSun),0.);" +
  "for(int i=0;i<5;i++){vec3 d=uLP[i]-vP;float ds=length(d);float at=pow(clamp(1.-ds/1.3,0.,1.),1.5);l+=vec3(1.,.416,.118)*uLI[i]*at*max(dot(n,d/max(ds,.001)),0.);}" +
  "c=vC*l;}gl_FragColor=vec4(min(c,vec3(1.)),1.);}";
let prog, U = {};
try {
  const mk = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  prog = gl.createProgram(); gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = (name, data, size) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); };
  buf("aP", P, 3); buf("aN", NR, 3); buf("aC", CO, 3); buf("aE", EM, 1);
  ["uR", "uC", "uS", "uSun", "uLava", "uLP", "uLI"].forEach(k => { U[k] = gl.getUniformLocation(prog, k); });
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.clearColor(0, 0, 0, 0);
} catch (e) { hero.classList.add("no-planet"); return; }
glc.addEventListener("webglcontextlost", e => { e.preventDefault(); dead = true; hero.classList.add("no-planet"); });
let dead = false;
const SUN = norm([-1, .8, 1.1]);

/* ---------------------------------------------------------------- rotations */
const rx = a => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
const ry = a => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
const rz = a => { const c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const app = (M, v) => [dot(M[0], v), dot(M[1], v), dot(M[2], v)];
const TILT = mul(rx(.3), rz(-.38));

/* ---------------------------------------------------------------- sprites (halo, flammes, fumée) */
const sprite = (size, draw) => { const c = document.createElement("canvas"); c.width = c.height = size; draw(c.getContext("2d"), size); return c; };
const GLOW = sprite(128, (g, n) => { const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(.25, "rgba(255,255,255,.55)"); r.addColorStop(.6, "rgba(255,255,255,.12)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, n, n); });
const SMOKE = sprite(128, (g, n) => { for (let i = 0; i < 18; i++) { const x = n / 2 + (hsh(i * 3.1) - .5) * n * .42, y = n / 2 + (hsh(i * 5.7) - .5) * n * .42, rr = n * (.14 + hsh(i * 7.3) * .12);
  const r = g.createRadialGradient(x, y, 0, x, y, rr); r.addColorStop(0, "rgba(70,66,72,.35)"); r.addColorStop(1, "rgba(70,66,72,0)"); g.fillStyle = r; g.fillRect(0, 0, n, n); } });
const tints = new Map();
function tinted(rgb) {   // glow teinté, mis en cache (couleurs arrondies)
  const k = rgb.map(v => Math.round(v * 16)).join(); let c = tints.get(k); if (c) return c;
  c = sprite(64, (g, n) => { g.drawImage(GLOW, 0, 0, n, n); g.globalCompositeOperation = "source-in"; g.fillStyle = `rgb(${rgb.map(v => Math.round(clamp(v, 0, 1) * 255)).join(",")})`; g.fillRect(0, 0, n, n); });
  tints.set(k, c); return c;
}
const FIRE = [[1, [255, 246, 200]], [.7, [255, 196, 80]], [.4, [255, 112, 30]], [.15, [150, 38, 14]], [0, [40, 20, 16]]];
const fireCol = f => { for (let i = 0; i < FIRE.length - 1; i++) { const p = FIRE[i], q = FIRE[i + 1]; if (f >= q[0]) { const k = (f - q[0]) / (p[0] - q[0]); return [0, 1, 2].map(j => lerp(q[1][j], p[1][j], k) / 255); } } return [.16, .08, .06]; };
const drawSprite = (ctx, img, x, y, d, a) => { if (a <= .003 || d < .5) return; ctx.globalAlpha = Math.min(1, a); ctx.drawImage(img, x - d / 2, y - d / 2, d, d); };

/* ---------------------------------------------------------------- mise en page */
const PIX = .5;                      // demi-résolution : rendu pixelisé
let W = 1, H = 1, cx = 0, cy = 0, R = 100, D = 1;
function layout() {
  const hr = hero.getBoundingClientRect(); W = Math.max(1, hr.width); H = Math.max(1, hr.height);
  const wide = slot && getComputedStyle(slot).display !== "none" && slot.getBoundingClientRect().width > 40;
  if (wide) { const s = slot.getBoundingClientRect(); cx = s.left - hr.left + s.width / 2; cy = s.top - hr.top + s.height / 2; R = Math.min(s.width, s.height) * .38; }
  else { cx = W * .64; cy = Math.min(H * .33, 320); R = Math.max(70, Math.min(W * .42, H * .25, 230)); }
  D = Math.min(devicePixelRatio || 1, 2) * PIX;
  for (const c of [backC, glc, frontC]) { c.width = Math.max(1, Math.round(W * D)); c.height = Math.max(1, Math.round(H * D)); }
  bx.setTransform(D, 0, 0, D, 0, 0); fx.setTransform(D, 0, 0, D, 0, 0);
  if (RM || !running) render(0);
}

/* ---------------------------------------------------------------- particules */
const parts = []; let mx = 0, px = 0;
addEventListener("pointermove", e => { mx = e.clientX / innerWidth * 2 - 1; }, { passive: true });
function emit(kind, x, y, vx, vy, life, size) { if (parts.length < 520) parts.push({ kind, x, y, vx, vy, life, age: 0, size, s: Math.random() * 9 }); }
function stepParts(dt, Rs) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.age += dt; if (p.age >= p.life) { parts.splice(i, 1); continue; }
    const f = p.age / p.life;
    if (p.kind === "fire") { p.vx += Math.sin(p.age * 9 + p.s) * Rs * .8 * dt; p.vx *= 1 - .4 * dt; p.vy *= 1 - .4 * dt; }
    else if (p.kind === "smoke") { p.vx += Math.sin(p.age * 3 + p.s) * Rs * .3 * dt; p.vy -= Rs * .04 * dt; }
    else { p.vy += Rs * .5 * dt; p.vx *= 1 - .3 * dt; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (f > 1) continue;
  }
}
function drawParts() {
  fx.globalCompositeOperation = "source-over";
  for (const p of parts) if (p.kind === "smoke") { const f = p.age / p.life; drawSprite(fx, SMOKE, p.x, p.y, p.size * (1 + 1.4 * f), .35 * Math.sin(Math.PI * f)); }
  fx.globalCompositeOperation = "lighter";
  for (const p of parts) {
    const f = p.age / p.life;
    if (p.kind === "fire") drawSprite(fx, tinted(fireCol(1 - f)), p.x, p.y, p.size * (1 - .55 * f), Math.min(1, (1 - f) * 1.6));
    else if (p.kind === "spark") { fx.globalAlpha = 1 - f; fx.fillStyle = "#ffd08a"; fx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
  }
  fx.globalAlpha = 1; fx.globalCompositeOperation = "source-over";
}

/* ---------------------------------------------------------------- rendu */
let k = 0, t = 0, running = false, visible = true, last = 0, startAt = performance.now() + 350;
const ease = u => u * u * (3 - 2 * u);
const LP = new Float32Array(15), LI = new Float32Array(5);
function render(dt) {
  if (dead) return;
  if (!RM) { if (performance.now() > startAt) k += (1 - k) * Math.min(1, dt * 2.4); t += dt; } else k = 1;
  px += (mx - px) * Math.min(1, dt * 3);
  const Rs = R * ease(clamp(k, 0, 1)), M = mul(TILT, ry(t * .35 + px * .6));
  // planète
  gl.viewport(0, 0, glc.width, glc.height); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  bx.clearRect(0, 0, W, H); fx.clearRect(0, 0, W, H);
  if (Rs < 1) return;
  const lava = .82 + .2 * Math.sin(t * 7) + .08 * Math.sin(t * 13);
  const nodes = CRATERS.map((c, i) => {
    const node = app(M, c.n.map(v => v * (1 - c.d * .9))), dir = norm(node), fl = 1 + .35 * Math.sin(t * 9 + i * 2.1) + .2 * Math.sin(t * 17 + i);
    LP.set([node[0] + dir[0] * .25, node[1] + dir[1] * .25, node[2] + dir[2] * .25], i * 3); LI[i] = 1.4 * fl * k; return { node, dir, fl };
  });
  gl.useProgram(prog);
  gl.uniformMatrix3fv(U.uR, false, [M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]]);
  gl.uniform2f(U.uC, cx / W * 2 - 1, 1 - cy / H * 2); gl.uniform2f(U.uS, 2 * Rs / W, 2 * Rs / H);
  gl.uniform3fv(U.uSun, SUN); gl.uniform1f(U.uLava, lava); gl.uniform3fv(U.uLP, LP); gl.uniform1fv(U.uLI, LI);
  gl.drawArrays(gl.TRIANGLES, 0, COUNT);
  // halo derrière la planète
  bx.globalCompositeOperation = "lighter"; drawSprite(bx, tinted([.35, .62, 1]), cx, cy, 2.9 * Rs, .5 * k); bx.globalAlpha = 1;
  // devant : voile, éclat du soleil, lueurs des cratères, flammes
  fx.globalCompositeOperation = "lighter";
  drawSprite(fx, tinted([.5, .75, 1]), cx, cy, 2.15 * Rs, .1 * k);
  drawSprite(fx, tinted([1, .92, .72]), cx - 1.6 * Rs, cy - 1.2 * Rs, 1.5 * Rs, .55 * k);
  drawSprite(fx, tinted([1, .7, .4]), cx - .75 * Rs, cy - .56 * Rs, .5 * Rs, .18 * k);
  drawSprite(fx, tinted([.6, .8, 1]), cx + .55 * Rs, cy + .4 * Rs, .35 * Rs, .14 * k);
  const proj = v => { const s = 1 / (1 - v[2] * .07); return [cx + v[0] * Rs * s, cy - v[1] * Rs * s]; };
  nodes.forEach(n => {
    if (n.dir[2] < -.15) return;
    const [x, y] = proj(n.node), face = clamp((n.dir[2] - .05) / .55, 0, 1);   // lueur effacée près du bord : la silhouette reste ronde
    drawSprite(fx, tinted([1, .42, .1]), x, y, .75 * Rs, .5 * n.fl * face * face * k);
    if (RM || n.dir[2] < -.3 || k < .5) return;
    const sx = x + n.dir[0] * Rs * .03, sy = y - n.dir[1] * Rs * .03, rnd = Math.random, ox = n.dir[0], oy = -n.dir[1];
    if (rnd() < dt * 30) emit("fire", sx + (rnd() - .5) * Rs * .14, sy + (rnd() - .5) * Rs * .14, ox * Rs * (.5 + rnd() * .6) + (rnd() - .5) * Rs * .2, oy * Rs * (.5 + rnd() * .6) + (rnd() - .5) * Rs * .2, .7 + rnd() * .6, Rs * (.12 + rnd() * .1));
    if (rnd() < dt * 7) emit("smoke", sx, sy, ox * Rs * .35, oy * Rs * .35, 2.2, Rs * .16);
    if (rnd() < dt * 10) emit("spark", sx, sy, ox * Rs * (.8 + rnd()) + (rnd() - .5) * Rs * .6, oy * Rs * (.8 + rnd()) + (rnd() - .5) * Rs * .6, .8 + rnd() * .6, Math.max(1.5, Rs * .018));
  });
  fx.globalAlpha = 1;
  stepParts(dt, Rs); drawParts();
}

layout();
new ResizeObserver(() => { clearTimeout(layout.t); layout.t = setTimeout(layout, 60); }).observe(hero);
if (slot) new ResizeObserver(() => { clearTimeout(layout.t); layout.t = setTimeout(layout, 60); }).observe(slot);
new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { rootMargin: "60px" }).observe(hero);
if (RM) { render(0); return; }
running = true;
(function loop(now) {
  requestAnimationFrame(loop);
  if (!visible || document.hidden) { last = 0; return; }
  const dt = last ? Math.min((now - last) / 1000, .05) : 1 / 60; last = now;
  render(dt);
})(performance.now());
})();
