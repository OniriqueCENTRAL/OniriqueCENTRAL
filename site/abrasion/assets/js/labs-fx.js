/* ==========================================================================
   abrasion labs — scène plein écran de labs.html (WebGL, sans librairie)

   1. SOURCE   des photos libres de droits (assets/img/labs, voir CREDITS.md)
               défilent avec un lent zoom ; par-dessus, des éléments 3D :
               la fleur low poly d'abrasion (faces + arêtes), des cubes en fil
               de fer et un anneau de points.
   2. DATAMOSH chaque image réutilise la précédente déplacée par un champ de
               mouvement par macroblocs (16 px), puis n'ajoute que la
               différence avec la nouvelle source (comme une image P de
               vidéo). Au changement de photo, ce résidu est presque coupé :
               l'ancienne image coule dans la nouvelle, bloc par bloc.
   3. RENDU    étalonnage abrasion : noir profond, blancs qui brillent, couleurs
               à 35 %, ombres bleutées ; des groupes de cellules passent en
               ASCII ; grain, lignes, vignette.
   4. SUIVI    la luminance est relue en 64 × n cellules : de vraies taches
               lumineuses sont détectées, numérotées et suivies d'une image à
               l'autre (carrés, croix, fils, ellipses) ; une chaîne de carrés
               suit le pointeur.
   Clic ou toucher : rafale de datamosh et photo suivante.
   Sans WebGL : la première photo s'affiche en fond, fixe.
   Mouvement réduit : une seule image moshée, figée.
   ========================================================================== */
(() => {
"use strict";
const stage = document.getElementById("ab-stage");
if (!stage || !("IntersectionObserver" in window) || !("ResizeObserver" in window)) return;
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const glc = stage.querySelector(".gl"), ovc = stage.querySelector(".ov"), ov = ovc.getContext("2d");
const hudR = document.getElementById("ab-hud-r"), hudB = document.getElementById("ab-hud-b");
const PHOTOS = [
  { src: "/abrasion/assets/img/labs/01-pavot.webp", name: "PAVOT" },
  { src: "/abrasion/assets/img/labs/02-cerisier.webp", name: "CERISIER" },
  { src: "/abrasion/assets/img/labs/03-ciel.webp", name: "CIEL" },
  { src: "/abrasion/assets/img/labs/04-fleur.webp", name: "FLEUR" },
  { src: "/abrasion/assets/img/labs/05-fougere.webp", name: "FOUGERE" },
  { src: "/abrasion/assets/img/labs/06-orage.webp", name: "ORAGE" },
];
const fail = () => { stage.classList.add("no-gl"); };
let gl = null;
try { gl = glc.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false, depth: false, stencil: false }); } catch (e) { gl = null; }
if (!gl) { fail(); return; }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t, smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);

/* ------------------------------------------------------------------ shaders */
const VQ = "attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}";
const NOISE = "float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}" +
  "float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}";
// photo avec zoom lent, recadrée pour couvrir l'écran
const FS_PHOTO = "precision highp float;varying vec2 v;uniform sampler2D uI;uniform vec2 uS;uniform vec3 uK;uniform float uHas;" +
  "void main(){vec2 p=(v-.5)*uS/uK.x+.5+uK.yz;vec3 c=texture2D(uI,clamp(p,.001,.999)).rgb;gl_FragColor=vec4(mix(vec3(.02),c,uHas),1.);}";
// éléments 3D (couleur déjà calculée par sommet)
const VS_3D = "attribute vec3 aP;attribute vec4 aC;uniform mat4 uPV;uniform float uPS;varying vec4 vC;void main(){vC=aC;gl_Position=uPV*vec4(aP,1.);gl_PointSize=uPS;}";
const FS_3D = "precision mediump float;varying vec4 vC;void main(){gl_FragColor=vC;}";
// datamosh : image précédente déplacée par macroblocs + résidu de la nouvelle source
const FS_MOSH = "precision highp float;varying vec2 v;uniform sampler2D uPrev,uSrc,uSrcPrev;uniform vec2 uRes;uniform float uT,uStep,uMosh,uResid,uKey,uAsp,uZoom,uAmp;" +
  "uniform vec2 uPan;uniform vec3 uSwirl;uniform vec4 uMouse;" + NOISE +
  "void main(){vec2 uv=v;vec2 bs=vec2(16.)/uRes;vec2 bi=floor(uv/bs);vec2 bc=(bi+.5)*bs;vec2 q=bc*vec2(uAsp,1.);" +
  "vec2 mv=(bc-.5)*uZoom-uPan;" +
  "mv+=(vec2(n(q*2.6+uT*.11),n(q*2.6+7.3-uT*.09))-.5)*(.0016+.006*uMosh)*uAmp;" +
  "vec2 d=(bc-uSwirl.xy)*vec2(uAsp,1.);float fr=exp(-dot(d,d)*5.);mv+=vec2(-d.y,d.x)/vec2(uAsp,1.)*fr*uSwirl.z;" +
  "vec2 dm=(bc-uMouse.xy)*vec2(uAsp,1.);float mm=exp(-dot(dm,dm)*34.);mv+=uMouse.zw*mm*1.6;" +
  "mv*=uStep;" +
  "float r=h(bi+floor(uT*6.)*13.1),r2=h(floor(uv/(bs*4.))+floor(uT*2.)*3.7);" +
  "float drop=max(step(1.-uMosh*.55,r),step(1.-uMosh*.3,r2));" +
  "vec2 sv=uv-mv*(1.+drop*1.5);" +
  "vec3 pr=texture2D(uPrev,sv).rgb,sp=texture2D(uSrcPrev,sv).rgb,s=texture2D(uSrc,uv).rgb;" +
  "vec3 c=pr+(s-sp)*mix(uResid,uResid*.15,drop);" +
  "float leak=(1.-pow(1.-mix(.04,.004,drop*uMosh),uStep));" +
  "c=mix(c,s,clamp(leak+uKey,0.,1.));gl_FragColor=vec4(clamp(c,0.,1.),1.);}";
// rendu final : étalonnage abrasion, halo des blancs, cellules ASCII, grain
const FS_DISP = "precision highp float;varying vec2 v;uniform sampler2D uM,uG;uniform vec2 uRes;uniform float uT,uMosh,uAscii,uDpr;" + NOISE +
  "float lum(vec3 c){return dot(c,vec3(.299,.587,.114));}" +
  "void main(){vec2 uv=v,fc=gl_FragCoord.xy;float ca=.0008+uMosh*.0035;" +
  "vec3 c=vec3(texture2D(uM,uv+vec2(ca,0.)).r,texture2D(uM,uv).g,texture2D(uM,uv-vec2(ca,0.)).b);" +
  "vec3 b=vec3(0.);for(int i=0;i<8;i++){float a=float(i)*.785;vec2 o=vec2(cos(a),sin(a)*uRes.x/uRes.y)*.011;b+=max(texture2D(uM,uv+o).rgb-.6,0.);}c+=b*.2;" +
  "vec2 cell=vec2(7.,12.)*uDpr;vec2 cid=floor(fc/cell);vec2 grp=floor(cid/vec2(8.,3.));float ra=h(grp+floor(uT*1.4)*7.31);" +
  "if(ra<uAscii){vec2 cc=(cid+.5)*cell/uRes;float L0=lum(texture2D(uM,cc).rgb);float gi=floor(clamp(L0*1.15,0.,.999)*10.);vec2 gp=fract(fc/cell);" +
  "float g=texture2D(uG,vec2((gi+gp.x)/10.,gp.y)).r;c=vec3(g)*(.35+.85*L0);}" +
  "float L=lum(c);c=mix(vec3(L),c,.35);c*=mix(vec3(.8,.87,1.14),vec3(1.),smoothstep(.0,.55,L));" +
  "c=smoothstep(.035,.93,c);c+=(h(fc+fract(uT*7.)*91.)-.5)*.055;c*=.955+.045*sin(fc.y*1.5708/uDpr);" +
  "vec2 dd=uv-.5;c*=1.-dot(dd,dd)*1.1;gl_FragColor=vec4(c,1.);}";
const FS_LUM = "precision mediump float;varying vec2 v;uniform sampler2D uM;void main(){float L=dot(texture2D(uM,v).rgb,vec3(.299,.587,.114));gl_FragColor=vec4(L,L,L,1.);}";

function program(vs, fs) {
  const mk = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, vs === VQ ? "p" : "aP"); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const cache = {}; p.u = k => k in cache ? cache[k] : (cache[k] = gl.getUniformLocation(p, k)); return p;
}
let pPhoto, p3d, pMosh, pDisp, pLum, quad, buf3d, TYPE = gl.UNSIGNED_BYTE;
try {
  pPhoto = program(VQ, FS_PHOTO); p3d = program(VS_3D, FS_3D); pMosh = program(VQ, FS_MOSH); pDisp = program(VQ, FS_DISP); pLum = program(VQ, FS_LUM);
  quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  buf3d = gl.createBuffer();
  // demi-flottants si possible : le feedback ne laisse alors aucune trace figée
  const hf = gl.getExtension("OES_texture_half_float"), hfl = gl.getExtension("OES_texture_half_float_linear");
  if (hf && hfl) { const t = gl.createTexture(), f = gl.createFramebuffer(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, hf.HALF_FLOAT_OES, null); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) TYPE = hf.HALF_FLOAT_OES;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(f); gl.deleteTexture(t); }
} catch (e) { fail(); return; }
let dead = false;
glc.addEventListener("webglcontextlost", e => { e.preventDefault(); dead = true; fail(); });

function tex(w, h, type, filter) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type || gl.UNSIGNED_BYTE, null);
  return t;
}
function target(w, h, type) {
  const t = tex(w, h, type), f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return { t, f, w, h };
}
const drop = o => { if (o) { gl.deleteTexture(o.t); gl.deleteFramebuffer(o.f); } };

/* ------------------------------------------------------------------ atlas ASCII */
const RAMP = " .:-=+*#%@", glyph = document.createElement("canvas"), gx = glyph.getContext("2d"), gTex = tex(0, 0, 0, gl.NEAREST);
function drawGlyphs() {
  glyph.width = 10 * 14; glyph.height = 24; gx.fillStyle = "#000"; gx.fillRect(0, 0, glyph.width, glyph.height);
  gx.fillStyle = "#fff"; gx.font = '700 20px "Space Mono", ui-monospace, monospace'; gx.textAlign = "center"; gx.textBaseline = "middle";
  for (let i = 0; i < 10; i++) gx.fillText(RAMP[i], i * 14 + 7, 13);
  gl.bindTexture(gl.TEXTURE_2D, gTex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, glyph);
}
drawGlyphs(); if (document.fonts) document.fonts.ready.then(() => { if (!dead) drawGlyphs(); });

/* ------------------------------------------------------------------ photos */
const imgs = PHOTOS.map(() => null);
function load(i) {
  if (imgs[i]) return Promise.resolve(imgs[i]);
  return new Promise(res => { const im = new Image(); im.decoding = "async"; im.src = PHOTOS[i].src;
    im.onload = () => { if (dead) return res(null); const t = tex(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); imgs[i] = { t, w: im.naturalWidth, h: im.naturalHeight }; res(imgs[i]); };
    im.onerror = () => res(null); });
}

/* ------------------------------------------------------------------ 3D : fleur low poly, cubes, anneau de points */
const TAU = Math.PI * 2;
const rX = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; };
const rY = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };
const RINGS = [{ n: 7, len: 1, w: .34, off: 0, phi: 1.2 }, { n: 7, len: .84, w: .32, off: .5, phi: .9 }, { n: 6, len: .62, w: .28, off: .25, phi: .6 }];
function flowerTris(open) {
  const T = [];
  RINGS.forEach((r, ri) => { const phi = r.phi * open + .1, L = r.len, w = r.w;
    for (let i = 0; i < r.n; i++) { const az = (i + r.off) / r.n * TAU + ri * .35, tf = v => rY(rX([v[0], v[1], v[2] + .06 + .02 * ri], phi), az);
      const B = tf([0, 0, 0]), Lf = tf([-w, .42 * L, .02]), Rt = tf([w, .42 * L, .02]), M = tf([0, .55 * L, -.06 * L]), Tp = tf([0, L, .12 * L]);
      T.push([B, Lf, M], [B, M, Rt], [Lf, Tp, M], [M, Tp, Rt]); } });
  const r = .17, oc = [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]].map(v => [v[0], v[1] + .1, v[2]]);
  [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]].forEach(f => T.push([oc[f[0]], oc[f[1]], oc[f[2]]]));
  return T;
}
const CUBE_E = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
const cubes = Array.from({ length: 7 }, () => newCube(true));
function newCube(anywhere) { return { x: anywhere ? rnd(-3.4, 3.4) : 3.8, y: rnd(-1.5, 1.5), z: rnd(-1.6, 1.4), s: rnd(.1, .42), a: rnd(TAU), b: rnd(TAU), va: rnd(-.6, .6), vb: rnd(-.6, .6), vx: -rnd(.05, .18) }; }
const ring = Array.from({ length: 180 }, (_, i) => ({ a: i / 180 * TAU, r: 1.35 + Math.sin(i * 1.7) * .08, y: Math.sin(i * 3.1) * .05 }));
function persp(fov, asp, near, far) { const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]; }
const CAMZ = 5, FOV = 40 * Math.PI / 180;
function build3d(t, asp, fxu, fyu, mosh) {
  const halfH = Math.tan(FOV / 2) * CAMZ, halfW = halfH * asp, cx = (fxu - .5) * 2 * halfW, cy = (fyu - .5) * 2 * halfH, S = Math.min(halfH * .5, halfW * .5);
  const open = .55 + .3 * Math.sin(t * .5), ry = t * .32, tilt = .95 + .15 * Math.sin(t * .23), light = [.35, .6, .72];
  const faces = [], lines = [], pts = [];
  const xf = p => { const q = rX(rY(p, ry), tilt); return [cx + q[0] * S, cy + q[1] * S, q[2] * S]; };
  for (const tr of flowerTris(open)) {
    const a = xf(tr[0]), b = xf(tr[1]), c = xf(tr[2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0], nl = Math.hypot(nx, ny, nz) || 1;
    const lam = Math.abs((nx * light[0] + ny * light[1] + nz * light[2]) / nl), k = .05 + .5 * lam;   // faces sombres et vitrées, arêtes blanches
    for (const p of [a, b, c]) faces.push(p[0], p[1], p[2], k * .86, k * .9, k * 1.05, .62);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) lines.push(p[0], p[1], p[2], 1, 1, 1, .9, q[0], q[1], q[2], 1, 1, 1, .9);
  }
  // tige
  const st = xf([0, -.05, 0]), sb = xf([0, -1.9, 0]); lines.push(st[0], st[1], st[2], 1, 1, 1, .8, sb[0], sb[1], sb[2], 1, 1, 1, .8);
  // cubes en fil de fer
  for (const cb of cubes) {
    const V = []; for (let i = 0; i < 8; i++) { let p = [(i & 1 ? 1 : -1) * cb.s, (i & 2 ? 1 : -1) * cb.s, (i & 4 ? 1 : -1) * cb.s]; p = rY(rX(p, cb.a), cb.b); V.push([p[0] + cb.x, p[1] + cb.y, p[2] + cb.z]); }
    const al = .55 + .45 * smooth((3.8 - Math.abs(cb.x)) / .8);
    for (const [i, j] of CUBE_E) lines.push(V[i][0], V[i][1], V[i][2], 1, 1, 1, al, V[j][0], V[j][1], V[j][2], 1, 1, 1, al);
  }
  // anneau de points autour de la fleur
  for (const p of ring) { const a = p.a + t * .18; let q = [Math.cos(a) * p.r, p.y + Math.sin(a * 3 + t) * .04, Math.sin(a) * p.r]; q = rX(q, .95);
    pts.push(cx + q[0] * S, cy + q[1] * S, q[2] * S, 1, 1, 1, .5 + .5 * Math.sin(p.a * 5 + t * 2)); }
  return { faces: new Float32Array(faces), lines: new Float32Array(lines), pts: new Float32Array(pts) };
}
function stepCubes(dt) { for (let i = 0; i < cubes.length; i++) { const c = cubes[i]; c.x += c.vx * dt; c.a += c.va * dt; c.b += c.vb * dt; if (c.x < -3.9) cubes[i] = newCube(false); } }

/* ------------------------------------------------------------------ tailles */
let W = 1, H = 1, FW = 2, FH = 2, D = 1, S0, S1, M0, M1, LUM, GW = 64, GH = 36, lumBuf, key = 1;
function size() {
  const r = stage.getBoundingClientRect(); W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
  D = Math.min(devicePixelRatio || 1, 1.25); const small = W < 700;
  FW = Math.max(2, Math.round(Math.min(W, small ? 460 : 860))); FH = Math.max(2, Math.round(FW * H / W));
  glc.width = Math.round(W * D); glc.height = Math.round(H * D); ovc.width = Math.round(W * D); ovc.height = Math.round(H * D); ov.setTransform(D, 0, 0, D, 0, 0);
  [S0, S1, M0, M1, LUM].forEach(drop);
  S0 = target(FW, FH, gl.UNSIGNED_BYTE); S1 = target(FW, FH, gl.UNSIGNED_BYTE); M0 = target(FW, FH, TYPE); M1 = target(FW, FH, TYPE);
  GW = 64; GH = clamp(Math.round(64 * H / W), 24, 120); LUM = target(GW, GH, gl.UNSIGNED_BYTE); lumBuf = new Uint8Array(GW * GH * 4); key = 1;
}

/* ------------------------------------------------------------------ séquence des photos */
let cur = 0, holdT = 0, kb = newKB(), trans = 0, burst = 0, nextBurst = rnd(2.5, 4.5);
const HOLD = 7.5;
function newKB() { const zin = Math.random() < .6; return { z0: zin ? 1.04 : 1.2, z1: zin ? 1.2 : 1.04, px: rnd(-.05, .05), py: rnd(-.04, .04) }; }
function advance() {
  const nx = (cur + 1) % PHOTOS.length;
  load(nx).then(im => { if (!im) return; cur = nx; holdT = 0; kb = newKB(); trans = 1; load((nx + 1) % PHOTOS.length); });
}

/* ------------------------------------------------------------------ pointeur */
const mouse = { x: .5, y: .5, px: .5, py: .5, vx: 0, vy: 0, in: false, X: 0, Y: 0 };
stage.addEventListener("pointermove", e => { const r = stage.getBoundingClientRect(); mouse.X = e.clientX - r.left; mouse.Y = e.clientY - r.top; mouse.in = true; });
stage.addEventListener("pointerleave", () => { mouse.in = false; });
stage.addEventListener("pointerdown", e => { if (e.target.closest("a,button")) return; burst = 1; if (trans < .2) advance(); });

/* ------------------------------------------------------------------ suivi de taches lumineuses */
let blobs = [], feats = [], nextId = 1500 + Math.floor(rnd(90)), trackT = 0;
const chain = Array.from({ length: 9 }, () => ({ x: 0, y: 0 }));
function detect() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, LUM.f); gl.readPixels(0, 0, GW, GH, gl.RGBA, gl.UNSIGNED_BYTE, lumBuf);
  const L = new Float32Array(GW * GH);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) L[(GH - 1 - y) * GW + x] = lumBuf[(y * GW + x) * 4] / 255;  // ligne 0 = haut
  const sorted = Array.from(L).sort((a, b) => a - b), th = Math.max(.5, sorted[Math.floor(sorted.length * .86)]);
  const seen = new Uint8Array(GW * GH), found = [], stack = [];
  for (let i = 0; i < L.length; i++) {
    if (seen[i] || L[i] < th) continue;
    let x0 = GW, y0 = GH, x1 = 0, y1 = 0, n = 0, sx = 0, sy = 0; stack.push(i); seen[i] = 1;
    while (stack.length) { const j = stack.pop(), x = j % GW, y = (j / GW) | 0; n++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const k of [j - 1, j + 1, j - GW, j + GW]) { if (k < 0 || k >= L.length || seen[k] || L[k] < th) continue; if ((k === j - 1 && x === 0) || (k === j + 1 && x === GW - 1)) continue; seen[k] = 1; stack.push(k); } }
    if (n >= 2) found.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, cx: (sx / n + .5) / GW, cy: (sy / n + .5) / GH, n });
  }
  found.sort((a, b) => b.n - a.n);
  const sx = W / GW, sy = H / GH, next = [];
  for (const f of found.slice(0, 22)) {
    const r = { x: f.x0 * sx, y: f.y0 * sy, w: (f.x1 - f.x0) * sx, h: (f.y1 - f.y0) * sy, cx: f.cx * W, cy: f.cy * H };
    let best = null, bd = W * .09;
    for (const b of blobs) { if (b.used) continue; const d = Math.hypot(b.cx - r.cx, b.cy - r.cy); if (d < bd) { bd = d; best = b; } }
    if (best) { best.used = true; next.push({ id: best.id, age: best.age + 1, x: lerp(best.x, r.x, .55), y: lerp(best.y, r.y, .55), w: lerp(best.w, r.w, .55), h: lerp(best.h, r.h, .55), cx: r.cx, cy: r.cy, n: f.n }); }
    else next.push(Object.assign({ id: nextId++, age: 0, n: f.n }, r));
  }
  blobs = next;
  // points d'intérêt : forts contrastes locaux
  const cand = [];
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) { const i = y * GW + x, g = Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + GW] - L[i - GW]); if (g > .28) cand.push([g, x, y]); }
  cand.sort((a, b) => b[0] - a[0]);
  feats = cand.slice(0, 26).filter((_, i) => i % 2 === 0 || Math.random() < .5).map(([g, x, y]) => ({ x: (x + .5) * sx, y: (y + .5) * sy, s: 4 + g * 10, id: (x * 31 + y * 17 + nextId) % 9000 + 1000 }));
}
function drawOverlay(t, dt, mosh) {
  ov.clearRect(0, 0, W, H); ov.strokeStyle = "#fff"; ov.fillStyle = "#fff"; ov.lineWidth = 1; ov.font = '9px "Space Mono", monospace'; ov.textBaseline = "top";
  const px = v => Math.round(v) + .5;
  // fils entre les taches suivies, par ordre de numéro
  const sb = blobs.slice().sort((a, b) => a.id - b.id);
  ov.globalAlpha = .6; ov.lineWidth = .8; ov.beginPath();
  for (let i = 1; i < sb.length; i++) { const p = sb[i - 1], q = sb[i], dx = q.cx - p.cx, dy = q.cy - p.cy, bend = ((q.id * 9301 + 49297) % 233280 / 233280 - .5) * .9;
    ov.moveTo(p.cx, p.cy); ov.quadraticCurveTo((p.cx + q.cx) / 2 - dy * bend, (p.cy + q.cy) / 2 + dx * bend, q.cx, q.cy); }
  for (const f of feats) { let best = null, bd = 1e9; for (const b of blobs) { const d = Math.hypot(b.cx - f.x, b.cy - f.y); if (d < bd) { bd = d; best = b; } }
    if (best && bd < W * .22) { ov.moveTo(f.x, f.y); ov.lineTo(best.cx, best.cy); } }
  ov.stroke();
  // ellipses autour du groupe
  if (blobs.length > 2) { let mx = 0, my = 0; blobs.forEach(b => { mx += b.cx; my += b.cy; }); mx /= blobs.length; my /= blobs.length;
    let vx = 0, vy = 0; blobs.forEach(b => { vx += (b.cx - mx) ** 2; vy += (b.cy - my) ** 2; }); vx = Math.sqrt(vx / blobs.length); vy = Math.sqrt(vy / blobs.length);
    ov.globalAlpha = .42; ov.lineWidth = .7;
    for (let i = 0; i < 2; i++) { ov.beginPath(); ov.ellipse(mx, my, Math.max(40, vx * (1.5 + i * .5)), Math.max(14, vy * (.55 + i * .35)), Math.sin(t * .15 + i * 2) * .45, 0, TAU); ov.stroke(); } }
  // taches suivies
  ov.lineWidth = 1;
  const huge = W * H * .05;
  for (const b of blobs) {
    if (b.age < 2 && Math.random() < .5) continue;                       // clignote à l'apparition
    const area = b.w * b.h, hash = (b.id * 2654435761 >>> 0) % 100;
    ov.globalAlpha = .95;
    if (area > huge) {                                                    // très grande tache : seulement des coins, comme un viseur
      const c = Math.min(22, b.w * .2, b.h * .2); ov.beginPath();
      for (const [x, y, sx, sy] of [[b.x, b.y, 1, 1], [b.x + b.w, b.y, -1, 1], [b.x, b.y + b.h, 1, -1], [b.x + b.w, b.y + b.h, -1, -1]]) { ov.moveTo(px(x + sx * c), px(y)); ov.lineTo(px(x), px(y)); ov.lineTo(px(x), px(y + sy * c)); }
      ov.stroke();
    } else {
      if (area > 900 && area < huge * .4 && hash < 16) { ov.globalAlpha = .8; ov.fillRect(b.x, b.y, b.w, b.h * .55); ov.globalAlpha = 1; }
      ov.strokeRect(px(b.x), px(b.y), Math.round(b.w), Math.round(b.h));
      if (area > 2400 || hash < 30) { ov.globalAlpha = .7; ov.lineWidth = .6; ov.beginPath(); ov.moveTo(b.x, b.y); ov.lineTo(b.x + b.w, b.y + b.h); ov.moveTo(b.x + b.w, b.y); ov.lineTo(b.x, b.y + b.h); ov.stroke(); ov.lineWidth = 1; }
    }
    ov.globalAlpha = 1; ov.strokeRect(px(b.x + b.w + 3), px(b.y), 4, 4); ov.fillText(String(b.id), b.x + b.w + 10, b.y - 1);
  }
  for (const f of feats) { ov.globalAlpha = .9; const s = Math.round(f.s); ov.strokeRect(px(f.x - s / 2), px(f.y - s / 2), s, s); if (f.id % 3 === 0) ov.fillText(String(f.id), f.x + s / 2 + 3, f.y - s / 2 - 1); }
  // chaîne de carrés qui suit le pointeur (ou se promène)
  const tx = mouse.in ? mouse.X : W * (.5 + .3 * Math.sin(t * .31)), ty = mouse.in ? mouse.Y : H * (.42 + .18 * Math.sin(t * .53 + 1));
  const kk = 1 - Math.pow(.65, dt * 60), kf = 1 - Math.pow(.7, dt * 60);
  chain[0].x += (tx - chain[0].x) * kk; chain[0].y += (ty - chain[0].y) * kk;
  for (let i = 1; i < chain.length; i++) { chain[i].x += (chain[i - 1].x - chain[i].x) * kf; chain[i].y += (chain[i - 1].y - chain[i].y) * kf; }
  ov.globalAlpha = .55; ov.beginPath(); chain.forEach((c, i) => i ? ov.lineTo(c.x, c.y) : ov.moveTo(c.x, c.y)); ov.stroke(); ov.globalAlpha = 1;
  chain.forEach((c, i) => { const s = Math.round(24 - i * 2), hx = px(c.x - s / 2), hy = px(c.y - s / 2); ov.strokeRect(hx, hy, s, s);
    if (i === 0) { ov.beginPath(); ov.moveTo(hx, hy); ov.lineTo(hx + s, hy + s); ov.moveTo(hx + s, hy); ov.lineTo(hx, hy + s); ov.stroke();
      ov.fillText("TRK 01  " + String(Math.round(c.x)).padStart(4, "0") + " " + String(Math.round(c.y)).padStart(4, "0"), hx + s + 6, hy); } });
  ov.globalAlpha = 1;
  return chain[0];
}

/* ------------------------------------------------------------------ rendu */
const t0 = performance.now(); let last = 0, frames = 0, fps = 0, fpsT = 0, hudT = 0, simT = 0;
function drawQuad(p) { gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.disableVertexAttribArray(1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
function draw3d(data, pv) {
  gl.useProgram(p3d); gl.uniformMatrix4fv(p3d.u("uPV"), false, pv);
  const aC = gl.getAttribLocation(p3d, "aC"); gl.bindBuffer(gl.ARRAY_BUFFER, buf3d);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const go = (arr, mode, ps) => { if (!arr.length) return; gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0); gl.enableVertexAttribArray(aC); gl.vertexAttribPointer(aC, 4, gl.FLOAT, false, 28, 12);
    gl.uniform1f(p3d.u("uPS"), ps); gl.drawArrays(mode, 0, arr.length / 7); };
  go(data.faces, gl.TRIANGLES, 1); go(data.lines, gl.LINES, 1); go(data.pts, gl.POINTS, 2 * Math.max(1, FW / 700));
  gl.disableVertexAttribArray(aC); gl.disable(gl.BLEND);
}
function render(now, forcedDt) {
  if (dead) return;
  const dt = forcedDt !== undefined ? forcedDt : (last ? Math.min((now - last) / 1000, .1) : 1 / 60); last = now;
  simT += dt; const t = simT;
  // séquence : tenue, rafales, changement de photo
  holdT += dt; if (!RM && holdT > HOLD && trans < .05) advance();
  nextBurst -= dt; if (nextBurst < 0) { burst = Math.max(burst, rnd(.5, .9)); nextBurst = rnd(3, 5.5); }
  const mosh = clamp(Math.max(trans, burst * .8), 0, 1);
  const resid = lerp(1, .035, smooth(trans * 1.15));
  trans = Math.max(0, trans - dt / 2.2); burst = Math.max(0, burst - dt * 1.4);
  // zoom lent (Ken Burns) et mouvement qu'il produit à l'écran
  const u = clamp(holdT / HOLD, 0, 1), z = lerp(kb.z0, kb.z1, u), ox = kb.px * u, oy = kb.py * u;
  const dz = (kb.z1 - kb.z0) / HOLD, img = imgs[cur], ia = img ? img.w / img.h : 16 / 9, ca = FW / FH;
  const sc = ca < ia ? [ca / ia, 1] : [1, ia / ca];
  // pointeur
  const mxu = mouse.in ? mouse.X / W : .5 + .3 * Math.sin(t * .31), myu = 1 - (mouse.in ? mouse.Y / H : .42 + .18 * Math.sin(t * .53 + 1));
  mouse.vx += ((mxu - mouse.px) - mouse.vx) * .3; mouse.vy += ((myu - mouse.py) - mouse.vy) * .3; mouse.px = mxu; mouse.py = myu;
  const small = W < 700, fxu = small ? .6 : .7, fyu = small ? .58 : .55;
  stepCubes(dt);
  // 1. source : photo + 3D, dans S0 (S1 garde la source précédente)
  gl.bindFramebuffer(gl.FRAMEBUFFER, S0.f); gl.viewport(0, 0, FW, FH);
  gl.useProgram(pPhoto); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, img ? img.t : gTex); gl.uniform1i(pPhoto.u("uI"), 0);
  gl.uniform2f(pPhoto.u("uS"), sc[0], sc[1]); gl.uniform3f(pPhoto.u("uK"), z, ox, oy); gl.uniform1f(pPhoto.u("uHas"), img ? 1 : 0); drawQuad();
  draw3d(build3d(t, ca, fxu, fyu, mosh), multiply(persp(FOV, ca, .1, 40), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -CAMZ, 1]));
  // 2. datamosh : M0 → M1
  gl.bindFramebuffer(gl.FRAMEBUFFER, M1.f); gl.useProgram(pMosh);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, M0.t); gl.uniform1i(pMosh.u("uPrev"), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, S0.t); gl.uniform1i(pMosh.u("uSrc"), 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, S1.t); gl.uniform1i(pMosh.u("uSrcPrev"), 2);
  gl.uniform2f(pMosh.u("uRes"), FW, FH); gl.uniform1f(pMosh.u("uT"), t); gl.uniform1f(pMosh.u("uStep"), clamp(dt * 60, .25, 3));
  gl.uniform1f(pMosh.u("uMosh"), mosh); gl.uniform1f(pMosh.u("uResid"), resid); gl.uniform1f(pMosh.u("uKey"), key); gl.uniform1f(pMosh.u("uAsp"), ca);
  gl.uniform1f(pMosh.u("uZoom"), dz / z / 60 * (1 + trans * 5)); gl.uniform2f(pMosh.u("uPan"), kb.px / HOLD * z / sc[0] / 60, kb.py / HOLD * z / sc[1] / 60);
  gl.uniform1f(pMosh.u("uAmp"), 1 + trans * 2.5 + burst * 2);
  gl.uniform3f(pMosh.u("uSwirl"), fxu, fyu, .0035 + mosh * .012); gl.uniform4f(pMosh.u("uMouse"), mxu, myu, clamp(mouse.vx, -.05, .05), clamp(mouse.vy, -.05, .05));
  drawQuad();
  let s = S0; S0 = S1; S1 = s; s = M0; M0 = M1; M1 = s;
  key *= Math.pow(.02, dt); if (key < .003) key = 0;
  // 3. luminance pour le suivi, quelques fois par seconde
  trackT -= dt; let doTrack = false;
  if (trackT <= 0) { trackT = .09; doTrack = true; gl.bindFramebuffer(gl.FRAMEBUFFER, LUM.f); gl.viewport(0, 0, GW, GH); gl.useProgram(pLum);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, M0.t); gl.uniform1i(pLum.u("uM"), 0); drawQuad(); }
  // 4. écran
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, glc.width, glc.height); gl.useProgram(pDisp);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, M0.t); gl.uniform1i(pDisp.u("uM"), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, gTex); gl.uniform1i(pDisp.u("uG"), 1);
  gl.uniform2f(pDisp.u("uRes"), glc.width, glc.height); gl.uniform1f(pDisp.u("uT"), t); gl.uniform1f(pDisp.u("uMosh"), mosh);
  gl.uniform1f(pDisp.u("uAscii"), .025 + mosh * .075); gl.uniform1f(pDisp.u("uDpr"), D); drawQuad();
  if (doTrack) detect();
  const head = drawOverlay(t, dt, mosh);
  frames++; if (now - fpsT > 500) { fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
  if (now - hudT > 150) { hudT = now;
    if (hudR) hudR.textContent = "OBJ " + String(blobs.length + feats.length).padStart(3, "0") + "  MOSH " + String(Math.round(mosh * 100)).padStart(2, "0") + "%\nSRC " + String(cur + 1).padStart(2, "0") + "/" + String(PHOTOS.length).padStart(2, "0") + " · " + PHOTOS[cur].name + "\n" + (fps || "--") + " FPS";
    if (hudB) hudB.textContent = "X " + String(Math.round(head.x)).padStart(4, "0") + "  Y " + String(Math.round(head.y)).padStart(4, "0"); }
}
function multiply(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }

/* ------------------------------------------------------------------ démarrage */
size(); chain.forEach(c => { c.x = W / 2; c.y = H / 2; });
let onScreen = true;
new IntersectionObserver(es => { onScreen = es[0].isIntersecting; }, { rootMargin: "40px" }).observe(stage);
new ResizeObserver(() => { clearTimeout(size.t); size.t = setTimeout(() => { if (!dead) size(); }, 150); }).observe(stage);
load(0).then(() => {
  if (dead) return; load(1);
  if (RM) { burst = .6; for (let i = 0; i < 90; i++) render(t0 + i * 16, 1 / 60); return; }
  (function loop(now) { requestAnimationFrame(loop); if (!onScreen || document.hidden) { last = 0; return; } render(now); })(performance.now());
});
})();
