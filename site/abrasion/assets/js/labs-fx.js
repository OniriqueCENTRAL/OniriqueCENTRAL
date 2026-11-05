/* ==========================================================================
   abrasion labs — scène plein écran de la page labs.html
   1. une image source (fleur abstraite, feuilles, ciel) est dessinée en 2D ;
   2. WebGL la fait couler dans une boucle de feedback (datamosh par blocs,
      déformation sous le pointeur, images clés toutes les 8 s) ;
   3. un calque 2D en mode « difference » ajoute le blob tracking : carrés,
      croix, numéros, fils courbes, ellipses, et une chaîne de carrés qui suit
      le pointeur (ou se promène toute seule).
   Sans WebGL, l'image source s'affiche telle quelle. La scène se met en pause
   hors de l'écran et reste figée si l'utilisateur réduit les animations.
   ========================================================================== */
(() => {
"use strict";
const stage = document.getElementById("ab-stage"); if (!stage || !("IntersectionObserver" in window) || !("ResizeObserver" in window)) return;
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const glc = stage.querySelector(".gl"), ovc = stage.querySelector(".ov");
const hudR = document.getElementById("ab-hud-r"), hudB = document.getElementById("ab-hud-b");
const ov = ovc.getContext("2d"), src = document.createElement("canvas"), sx = src.getContext("2d");
let onScreen = true;
new IntersectionObserver(es => { onScreen = es[0].isIntersecting; }).observe(stage);
let gl = null; try { gl = glc.getContext("webgl", { antialias: false, premultipliedAlpha: false, alpha: false }); } catch (e) { gl = null; }
let W = 1, H = 1, FW = 1, FH = 1, D = 1;

/* ---- source ---- */
const petals = Array.from({ length: 9 }, (_, i) => ({ a: i / 9 * Math.PI * 2 + rnd(.3), d: rnd(.07, .17), rx: rnd(.1, .17), ry: rnd(.06, .11), s: rnd(.15, .4), p: rnd(7) }));
const leaves = Array.from({ length: 6 }, (_, i) => ({ a: Math.PI * (.05 + i / 5 * .9) + rnd(-.1, .1), l: rnd(.25, .4), w: rnd(.05, .08), s: rnd(.1, .3), p: rnd(7) }));
const anchors = [];
function drawSource(t) {
  const w = FW, h = FH, u = h;
  const cx = w * .5 + Math.sin(t * .21) * w * .06, cy = h * .45 + Math.cos(t * .17) * h * .05;
  let g = sx.createRadialGradient(cx, cy, 0, cx, cy, w * .7); g.addColorStop(0, "#22170f"); g.addColorStop(1, "#070504");
  sx.fillStyle = g; sx.fillRect(0, 0, w, h);
  const sky = clamp((Math.sin(t * .09 + 2.2) - .35) * 2, 0, 1);
  if (sky > 0) {
    sx.globalAlpha = sky * .9; g = sx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#4f7f98"); g.addColorStop(.6, "#8fb3c4"); g.addColorStop(1, "#c9dbe2");
    sx.fillStyle = g; sx.fillRect(0, 0, w, h);
    for (let i = 0; i < 7; i++) {
      const ex = ((i * .23 + t * .012) % 1.3 - .15) * w, ey = h * (.12 + (i % 3) * .28 + Math.sin(i * 2.1) * .05), rx = w * (.12 + (i % 2) * .08);
      sx.save(); sx.translate(ex, ey); sx.scale(1, .32);
      const cg = sx.createRadialGradient(0, 0, 0, 0, 0, rx); cg.addColorStop(0, "rgba(244,248,250,.75)"); cg.addColorStop(1, "rgba(244,248,250,0)");
      sx.fillStyle = cg; sx.fillRect(-rx, -rx, rx * 2, rx * 2); sx.restore();
    }
    sx.globalAlpha = 1;
  }
  anchors.length = 0;
  for (const L of leaves) {
    const a = L.a + Math.sin(t * L.s + L.p) * .12, len = L.l * u, ex = cx + Math.cos(a) * len * 1.5, ey = cy + Math.sin(a) * len * .9 + u * .08;
    const nx = -Math.sin(a) * L.w * u, ny = Math.cos(a) * L.w * u, mx = (cx + ex) / 2, my = (cy + u * .08 + ey) / 2;
    g = sx.createLinearGradient(cx, cy, ex, ey); g.addColorStop(0, "#3c4630"); g.addColorStop(1, "#8b9a72");
    sx.fillStyle = g; sx.beginPath(); sx.moveTo(cx, cy + u * .08); sx.quadraticCurveTo(mx + nx, my + ny, ex, ey); sx.quadraticCurveTo(mx - nx, my - ny, cx, cy + u * .08); sx.fill();
    anchors.push({ x: ex / w, y: ey / h, r: .05 });
  }
  sx.font = `700 ${Math.round(u * .3)}px "Space Mono", monospace`; sx.textAlign = "center"; sx.textBaseline = "middle";
  sx.fillStyle = "rgba(255,255,255,.18)"; sx.fillText("LABS", cx, cy + u * .02);
  for (const P of petals) {
    const a = P.a + Math.sin(t * P.s + P.p) * .3, px = cx + Math.cos(a) * P.d * u * 1.3, py = cy + Math.sin(a) * P.d * u * .9 - u * .04;
    const rx = P.rx * u * (1 + .15 * Math.sin(t * .7 + P.p)), ry = P.ry * u;
    g = sx.createRadialGradient(px - rx * .3, py - ry * .4, 0, px, py, rx); g.addColorStop(0, "#ffffff"); g.addColorStop(.55, "#eef1ee"); g.addColorStop(1, "#b7bfba");
    sx.fillStyle = g; sx.beginPath(); sx.ellipse(px, py, rx, ry, a, 0, 7); sx.fill();
    anchors.push({ x: px / w, y: py / h, r: rx / h * .8 });
  }
  sx.fillStyle = "#e9d9a8"; sx.beginPath(); sx.arc(cx, cy - u * .03, u * .025, 0, 7); sx.fill();
}

/* ---- WebGL ---- */
let pF, pD, A, B, srcTex, ok = !!gl;
const VS = "attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}";
const NOISE = "float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}" +
  "float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}";
const FS_FB = "precision highp float;varying vec2 v;uniform sampler2D uPrev,uSrc;uniform float uT,uMosh,uKey,uAsp,uStep;uniform vec2 uMouse,uMVel;" + NOISE +
  "void main(){vec2 uv=v,q=uv*vec2(uAsp,1.);" +
  "vec2 fl=vec2(n(q*2.3+vec2(uT*.07,0.)),n(q*2.3+vec2(4.1,uT*.05)))-.5;" +
  "fl+=(vec2(n(q*7.+uT*.2),n(q*7.+9.-uT*.2))-.5)*.45;" +
  "vec2 dm=(uv-uMouse)*vec2(uAsp,1.);float m=exp(-dot(dm,dm)*26.);" +
  "vec2 disp=fl*(.0035+uMosh*.004)*uStep+uMVel*m*.5;" +
  "vec2 g1=floor(uv*vec2(48.,27.)),g2=floor(uv*vec2(12.,6.75));" +
  "float r1=h(g1+floor(uT*7.)*1.7),r2=h(g2*3.1+floor(uT*2.5)*.73);" +
  "float mo=clamp(step(1.-uMosh*.3,r1)+step(1.-uMosh*.22,r2)+step(.35,m*uMosh),0.,1.);" +
  "vec2 mv=(vec2(h(g2+.3),h(g2+5.7))-.5)*.014+(vec2(h(g1+.1),h(g1+2.9))-.5)*.006;" +
  "vec3 pr=texture2D(uPrev,uv-disp-mv*mo).rgb,s=texture2D(uSrc,uv).rgb;" +
  "float k=clamp(1.-pow(1.-mix(.06,0.,mo),uStep)+uKey,0.,1.);" +
  "gl_FragColor=vec4(mix(pr,s,k),1.);}";
const FS_D = "precision highp float;varying vec2 v;uniform sampler2D uFb;uniform float uT;uniform vec2 uRes;" + NOISE +
  "void main(){vec2 uv=v;float ca=.0016;" +
  "vec3 c=vec3(texture2D(uFb,uv+vec2(ca,0.)).r,texture2D(uFb,uv).g,texture2D(uFb,uv-vec2(ca,0.)).b);" +
  "c=smoothstep(.03,.9,c);c+=(h(uv*uRes+fract(uT*7.)*91.)-.5)*.07;c*=.94+.06*sin(uv.y*uRes.y*1.6);" +
  "vec2 d=uv-.5;c*=1.-dot(d,d)*1.1;gl_FragColor=vec4(c,1.);}";
function prog(fs) {
  const mk = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const cache = {}; p.u = k => k in cache ? cache[k] : (cache[k] = gl.getUniformLocation(p, k)); return p;
}
function tex(w, h) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return t;
}
function fbo(w, h) {
  const t = tex(w, h), f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return { f, t };
}
if (ok) try {
  pF = prog(FS_FB); pD = prog(FS_D); srcTex = tex();
  const q = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, q); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
} catch (e) { ok = false; }
glc.addEventListener("webglcontextlost", e => { e.preventDefault(); ok = false; });
const c2 = ok ? null : glc.getContext("2d");

let key = 1;
function size() {
  const r = stage.getBoundingClientRect(); D = Math.min(devicePixelRatio || 1, 1.5);
  W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
  FW = Math.min(900, Math.max(2, Math.round(W / 1.6))); FH = Math.max(2, Math.round(FW * H / W));
  src.width = FW; src.height = FH; ovc.width = Math.round(W * D); ovc.height = Math.round(H * D); ov.setTransform(D, 0, 0, D, 0, 0);
  if (ok) { glc.width = Math.round(W * D); glc.height = Math.round(H * D);
    if (A) { gl.deleteTexture(A.t); gl.deleteTexture(B.t); gl.deleteFramebuffer(A.f); gl.deleteFramebuffer(B.f); }
    A = fbo(FW, FH); B = fbo(FW, FH); key = 1; }
  else { glc.width = FW; glc.height = FH; }
}

/* ---- pointeur ---- */
const mouse = { px: .5, py: .5, vx: 0, vy: 0, in: false, X: 0, Y: 0 };
let boost = 0;
stage.addEventListener("pointermove", e => { const r = stage.getBoundingClientRect(); mouse.X = e.clientX - r.left; mouse.Y = e.clientY - r.top; mouse.in = true; });
stage.addEventListener("pointerleave", () => { mouse.in = false; });
stage.addEventListener("pointerdown", e => { if (!e.target.closest("a,button")) boost = 1; });

/* ---- tracking ---- */
let feats = [], nextId = 1500 + Math.floor(rnd(80)), acc = 0;
const chain = Array.from({ length: 9 }, () => ({ x: 0, y: 0 }));
function spawn(t) {
  if (!anchors.length) return;
  const a = anchors[Math.floor(rnd(anchors.length))], u = Math.random(), k = Math.random();
  const s = (u < .58 ? rnd(5, 14) : u < .9 ? rnd(16, 44) : rnd(50, 110)) * (W < 640 ? .7 : 1);
  feats.push({ a, ox: rnd(-1.2, 1.2) * a.r * H, oy: rnd(-1.2, 1.2) * a.r * H, b: t, l: rnd(.4, 2.6), s, id: nextId++,
    ty: s > 48 ? (k < .5 ? "x" : "fill") : k < .42 ? "x" : k < .7 ? "box" : k < .84 ? "fill" : "dot", j: rnd(7) });
  if (feats.length > 48) feats.shift();
}
function drawTracking(t, mosh, dt) {
  ov.clearRect(0, 0, W, H);
  ov.strokeStyle = "#fff"; ov.fillStyle = "#fff"; ov.lineWidth = 1; ov.font = '9px "Space Mono", monospace'; ov.textBaseline = "top";
  acc += (12 + mosh * 26 + boost * 50) * dt; while (acc >= 1) { acc--; spawn(t - rnd(.3)); }
  feats = feats.filter(f => t - f.b < f.l);
  const pos = new Map();
  for (const f of feats) {
    const age = (t - f.b) / f.l; if ((age < .05 || age > .93) && Math.random() < .5) continue;
    const x = f.a.x * W + f.ox + Math.sin(t * 3 + f.j) * 2, y = f.a.y * H + f.oy + Math.cos(t * 2.6 + f.j) * 2, s = f.s, hx = x - s / 2, hy = y - s / 2;
    pos.set(f.id, [x, y]); ov.globalAlpha = .95;
    if (f.ty === "fill") { ov.globalAlpha = .9; ov.fillRect(hx, hy, s, s * (.55 + .45 * Math.sin(f.j + t))); ov.globalAlpha = 1; ov.strokeRect(hx + .5, hy + .5, s, s); }
    else if (f.ty === "dot") ov.fillRect(x - 1.5, y - 1.5, 3, 3);
    else { ov.strokeRect(Math.round(hx) + .5, Math.round(hy) + .5, Math.round(s), Math.round(s));
      if (f.ty === "x") { ov.beginPath(); ov.moveTo(hx, hy); ov.lineTo(hx + s, hy + s); ov.moveTo(hx + s, hy); ov.lineTo(hx, hy + s); ov.lineWidth = .6; ov.stroke(); ov.lineWidth = 1; } }
    if (s < 60 || f.id % 3 === 0) { ov.strokeRect(Math.round(hx + s + 3) + .5, Math.round(hy) + .5, 4, 4); ov.fillText(f.id, hx + s + 10, hy - 1); }
  }
  ov.globalAlpha = .7; ov.lineWidth = .8; ov.beginPath();
  for (const f of feats) {
    const p = pos.get(f.id), q = pos.get(f.id - 1) || pos.get(f.id - 2); if (!p || !q) continue;
    const dx = q[0] - p[0], dy = q[1] - p[1]; if (Math.hypot(dx, dy) > W * .45) continue;
    const bend = ((f.id * 9301 + 49297) % 233280 / 233280 - .5) * 1.1;
    ov.moveTo(p[0], p[1]); ov.quadraticCurveTo((p[0] + q[0]) / 2 - dy * bend, (p[1] + q[1]) / 2 + dx * bend, q[0], q[1]);
  }
  ov.stroke();
  ov.globalAlpha = .45; ov.lineWidth = .7;
  let cx = 0, cy = 0; for (const a of anchors) { cx += a.x; cy += a.y; } cx = cx / (anchors.length || 1) * W; cy = cy / (anchors.length || 1) * H;
  for (let i = 0; i < 2; i++) { ov.beginPath(); ov.ellipse(cx + Math.sin(t * .3 + i) * W * .05, cy + (i ? -1 : 1) * H * .06, W * (.24 + .08 * i), H * (.05 + .04 * Math.sin(t * .4 + i)), Math.sin(t * .13 + i * 2) * .5, 0, 7); ov.stroke(); }
  const tx = mouse.in ? mouse.X : W * (.5 + .32 * Math.sin(t * .37)), ty = mouse.in ? mouse.Y : H * (.4 + .2 * Math.sin(t * .61 + 1));
  const kk = 1 - Math.pow(.65, dt * 60), kf = 1 - Math.pow(.7, dt * 60);
  chain[0].x += (tx - chain[0].x) * kk; chain[0].y += (ty - chain[0].y) * kk;
  for (let i = 1; i < chain.length; i++) { chain[i].x += (chain[i - 1].x - chain[i].x) * kf; chain[i].y += (chain[i - 1].y - chain[i].y) * kf; }
  ov.lineWidth = 1; ov.beginPath(); chain.forEach((c, i) => i ? ov.lineTo(c.x, c.y) : ov.moveTo(c.x, c.y)); ov.globalAlpha = .6; ov.stroke(); ov.globalAlpha = 1;
  chain.forEach((c, i) => {
    const s = Math.round(26 - i * 2.2), hx = Math.round(c.x - s / 2) + .5, hy = Math.round(c.y - s / 2) + .5; ov.strokeRect(hx, hy, s, s);
    if (i === 0) { ov.beginPath(); ov.moveTo(hx, hy); ov.lineTo(hx + s, hy + s); ov.moveTo(hx + s, hy); ov.lineTo(hx, hy + s); ov.stroke();
      ov.fillText("TRK 01  " + String(Math.round(c.x)).padStart(4, "0") + " " + String(Math.round(c.y)).padStart(4, "0"), hx + s + 6, hy); }
    else if (i % 3 === 0) ov.fillText(String(nextId - i * 7).padStart(4, "0"), hx + s + 4, hy);
  });
  return chain[0];
}

/* ---- rendu ---- */
const t0 = performance.now(); let last = 0, frames = 0, fps = 0, fpsT = 0, hudT = 0;
function render(now) {
  const t = (now - t0) / 1000, dt = last ? Math.min((now - last) / 1000, .1) : 1 / 60; last = now;
  const cyc = (t % 8) / 8, mosh = clamp(Math.pow(cyc, 1.3) * 1.15 + boost * .6, 0, 1);
  if (cyc < .02) key = Math.max(key, .32);
  boost *= Math.pow(.2, dt);
  const nx = mouse.in ? mouse.X / W : .5 + .32 * Math.sin(t * .37), ny = 1 - (mouse.in ? mouse.Y / H : .4 + .2 * Math.sin(t * .61 + 1));
  mouse.vx += ((nx - mouse.px) - mouse.vx) * .3; mouse.vy += ((ny - mouse.py) - mouse.vy) * .3; mouse.px = nx; mouse.py = ny;
  drawSource(t);
  if (ok) {
    gl.bindTexture(gl.TEXTURE_2D, srcTex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.bindFramebuffer(gl.FRAMEBUFFER, B.f); gl.viewport(0, 0, FW, FH); gl.useProgram(pF);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.t); gl.uniform1i(pF.u("uPrev"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, srcTex); gl.uniform1i(pF.u("uSrc"), 1);
    gl.uniform1f(pF.u("uT"), t); gl.uniform1f(pF.u("uMosh"), mosh); gl.uniform1f(pF.u("uKey"), key); gl.uniform1f(pF.u("uAsp"), W / H); gl.uniform1f(pF.u("uStep"), clamp(dt * 60, .5, 3));
    gl.uniform2f(pF.u("uMouse"), nx, ny); gl.uniform2f(pF.u("uMVel"), clamp(mouse.vx, -.05, .05), clamp(mouse.vy, -.05, .05));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const s = A; A = B; B = s;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, glc.width, glc.height); gl.useProgram(pD);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.t); gl.uniform1i(pD.u("uFb"), 0);
    gl.uniform1f(pD.u("uT"), t); gl.uniform2f(pD.u("uRes"), glc.width, glc.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    key *= Math.pow(.02, dt); if (key < .004) key = 0;
  } else if (c2) c2.drawImage(src, 0, 0);
  const head = drawTracking(t, mosh, RM ? .4 : dt);
  frames++; if (now - fpsT > 500) { fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
  if (now - hudT > 120) { hudT = now;
    if (hudR) hudR.textContent = "OBJ " + String(feats.length).padStart(3, "0") + "\nMOSH " + String(Math.round(mosh * 100)).padStart(2, "0") + "%\n" + (fps || "--") + " FPS";
    if (hudB) hudB.textContent = "X " + String(Math.round(head.x)).padStart(4, "0") + "  Y " + String(Math.round(head.y)).padStart(4, "0"); }
}
size(); chain.forEach(c => { c.x = W / 2; c.y = H / 2; });
new ResizeObserver(() => { clearTimeout(size.t); size.t = setTimeout(size, 120); }).observe(stage);
if (RM) { for (let i = 0; i < 140; i++) render(t0 + i * 16); return; }
(function loop(now) { requestAnimationFrame(loop); if (!onScreen || document.hidden) { last = 0; return; } render(now); })(t0);
})();
