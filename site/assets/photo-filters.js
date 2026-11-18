// ONIRIQUE PHOTO : la banque de filtres, rangée comme le menu Filtre des logiciels de retouche (Flou, Déformation, Bruit,
// Pixellisation, Rendu, Renforcement, Esthétiques, Autres). Chargé avant le script de la page : les fonctions servent au
// moment du clic (doc, active, ask, commit, selection, fg, bg… existent alors). Tout est calculé dans le navigateur.
//
// Un filtre agit sur le calque actif ; s'il y a une sélection, seulement dedans. Avec réglages : une fenêtre et un
// aperçu en direct sur l'image ; sans réglage : appliqué tout de suite. Chaque filtre est une étape de l'historique.
"use strict";

// ——— Outils de pixels ———
const pxImage = (c) => c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
function pxCanvas(img) { const c = canvasOf(img.width, img.height); c.getContext("2d").putImageData(img, 0, 0); return c; }
const pxClamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const pxLum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
/** Une image de travail neuve, de la taille de src (pixels transparents). */
const pxBlank = (src) => new ImageData(src.width, src.height);
/** Pseudo-aléatoire répétable (un aperçu et le résultat final donnent la même image). */
function pxRandom(seed = 1) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
/** Flou gaussien rapide (celui du navigateur), bords gardés. */
const pxBlur = (src, r) => (r > 0 ? filtered(src, "blur(" + r + "px)", true) : copyOf(src));
/** Moyenne exacte de plusieurs dessins de src (chaque fonction place le dessin) : flou directionnel, radial, fragmentation. */
function pxAverage(src, steps, place) {
  const c = canvasOf(src.width, src.height), x = c.getContext("2d");
  for (let k = 0; k < steps; ++k) {
    x.save();
    x.globalAlpha = 1 / (k + 1);   // moyenne qui s'accumule : la nouvelle image pèse 1 / (k + 1)
    place(x, k);
    x.drawImage(src, 0, 0);
    x.restore();
  }
  return c;
}
/** Déformation : pour chaque pixel de sortie, map(x, y, P) écrit dans P la position lue dans la source (false : transparent).
    Lecture bilinéaire. */
function pxWarp(src, map, wrapEdges) {
  const w = src.width, h = src.height, s = pxImage(src).data, out = pxBlank(src), d = out.data, P = [0, 0];
  for (let y = 0; y < h; ++y)
    for (let x = 0; x < w; ++x) {
      if (!map(x + 0.5, y + 0.5, P)) continue;
      let sx = P[0] - 0.5, sy = P[1] - 0.5;
      if (wrapEdges) { sx = ((sx % w) + w) % w; sy = ((sy % h) + h) % h; }
      if (sx < -0.5 || sy < -0.5 || sx > w - 0.5 || sy > h - 0.5) continue;
      sx = Math.min(Math.max(sx, 0), w - 1); sy = Math.min(Math.max(sy, 0), h - 1);
      const x0 = sx | 0, y0 = sy | 0, x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1), fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4, o = (y * w + x) * 4;
      for (let c = 0; c < 4; ++c)
        d[o + c] = (s[i00 + c] * (1 - fx) + s[i10 + c] * fx) * (1 - fy) + (s[i01 + c] * (1 - fx) + s[i11 + c] * fx) * fy;
    }
  return pxCanvas(out);
}
/** Chaque pixel transformé par fn(r, g, b, a, i, x, y) → écrit dans out (même ordre). */
function pxMap(src, fn) {
  const img = pxImage(src), d = img.data, w = src.width;
  for (let i = 0, n = d.length; i < n; i += 4) fn(d, i, (i >> 2) % w, ((i >> 2) / w) | 0);
  return pxCanvas(img);
}
/** Maximum ou minimum sur un carré de rayon r (séparable : lignes puis colonnes). */
function pxMaxMin(src, r, max) {
  const w = src.width, h = src.height, img = pxImage(src), a = img.data, tmp = new Uint8ClampedArray(a.length);
  const pick = max ? Math.max : Math.min;
  for (let pass = 0; pass < 2; ++pass) {
    const from = pass === 0 ? a : tmp, to = pass === 0 ? tmp : a, hz = pass === 0;
    for (let y = 0; y < h; ++y)
      for (let x = 0; x < w; ++x) {
        const o = (y * w + x) * 4;
        for (let c = 0; c < 3; ++c) {
          let v = from[o + c];
          for (let k = -r; k <= r; ++k) {
            const xx = hz ? x + k : x, yy = hz ? y : y + k;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            v = pick (v, from[(yy * w + xx) * 4 + c]);
          }
          to[o + c] = v;
        }
        to[o + 3] = from[o + 3];
      }
  }
  return pxCanvas(img);
}
/** Médiane par canal sur un carré de rayon r (histogramme glissant, ligne par ligne). */
function pxMedian(src, r) {
  const w = src.width, h = src.height, s = pxImage(src).data, out = new ImageData(w, h), d = out.data;
  const hist = [new Int32Array(256), new Int32Array(256), new Int32Array(256)];
  for (let y = 0; y < h; ++y) {
    for (const hh of hist) hh.fill(0);
    let count = 0;
    const add = (x, sign) => {
      if (x < 0 || x >= w) return;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); ++yy) {
        const i = (yy * w + x) * 4;
        hist[0][s[i]] += sign; hist[1][s[i + 1]] += sign; hist[2][s[i + 2]] += sign;
        count += sign;
      }
    };
    for (let x = -r; x <= r; ++x) add (x, 1);
    for (let x = 0; x < w; ++x) {
      const o = (y * w + x) * 4, half = count >> 1;
      for (let c = 0; c < 3; ++c) { let acc = 0, v = 0; const hh = hist[c]; while (v < 255 && (acc += hh[v]) <= half) ++v; d[o + c] = v; }
      d[o + 3] = s[o + 3];
      add (x - r, -1); add (x + r + 1, 1);
    }
  }
  return pxCanvas(out);
}
/** Mélange du calque et d'une version filtrée, avec seuil : n'agit que là où l'écart dépasse threshold (0–255). */
function pxUnsharp(src, amount, radius, threshold) {
  const blur = pxImage(pxBlur(src, radius)).data;
  return pxMap(src, (d, i) => {
    const diff = pxLum(d, i) - pxLum(blur, i);
    if (Math.abs(diff) < threshold) return;
    for (let c = 0; c < 3; ++c) d[i + c] = pxClamp(d[i + c] + (d[i + c] - blur[i + c]) * amount);
  });
}
/** Bruit de valeurs lissé, en octaves (nuages). */
function pxClouds(w, h, seed, scale) {
  const rnd = pxRandom(seed), size = 256, table = new Float32Array(size * size);
  for (let i = 0; i < table.length; ++i) table[i] = rnd();
  const at = (x, y) => table[(y & (size - 1)) * size + (x & (size - 1))];
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = smooth (x - xi), fy = smooth (y - yi);
    const a = at (xi, yi), b = at (xi + 1, yi), c = at (xi, yi + 1), dd = at (xi + 1, yi + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + dd * fx) * fy;
  };
  const out = new Float32Array(w * h), base = Math.max(w, h) / scale;
  for (let y = 0; y < h; ++y)
    for (let x = 0; x < w; ++x) {
      let v = 0, amp = 0.5, f = 1 / base;
      for (let o = 0; o < 6; ++o) { v += amp * noise (x * f + o * 17.3, y * f + o * 9.1); amp *= 0.5; f *= 2; }
      out[y * w + x] = v / 0.984;
    }
  return out;
}

// ——— Les filtres ———
// Chaque entrée : nom (avec « … » s'il a des réglages), réglages pour la fenêtre, et run(source, valeurs) → canvas.
const pxR = (k, label, min, max, value, unit = "") => ({ k, label, type: "range", min, max, value, unit });
const pxS = (k, label, options, value) => ({ k, label, type: "select", options, value });
const pxC = (k, label, value) => ({ k, label, type: "checkbox", value });
const pxCentre = (src) => [src.width / 2, src.height / 2, Math.min(src.width, src.height) / 2];

const PX_FILTERS = {
  // Flou (atténuation)
  gauss: ["Flou gaussien…", [pxR("r", "Rayon", 0, 100, 4, " px")], (src, v) => pxBlur(src, v.r)],
  motion: ["Flou directionnel…", [pxR("a", "Angle", -90, 90, 0, "°"), pxR("d", "Distance", 1, 300, 20, " px")], (src, v) => {
    const steps = Math.min(64, Math.max(4, Math.round(v.d / 2))), ax = Math.cos(v.a * Math.PI / 180), ay = -Math.sin(v.a * Math.PI / 180);
    return pxAverage(src, steps, (x, k) => { const t = (k / (steps - 1) - 0.5) * v.d; x.translate(ax * t, ay * t); });
  }],
  radial: ["Flou radial…", [pxR("n", "Quantité", 1, 100, 10), pxS("m", "Méthode", [["spin", "Rotation"], ["zoom", "Zoom"]], "spin")], (src, v) => {
    const [cx, cy] = pxCentre(src), steps = Math.min(64, 8 + v.n);
    return pxAverage(src, steps, (x, k) => {
      const t = k / (steps - 1) - 0.5;
      x.translate(cx, cy);
      if (v.m === "spin") x.rotate(t * v.n * Math.PI / 180 * 1.2); else { const s = 1 + t * v.n / 120; x.scale(s, s); }
      x.translate(-cx, -cy);
    });
  }],
  surface: ["Flou de surface…", [pxR("r", "Rayon", 1, 60, 5, " px"), pxR("t", "Seuil", 2, 255, 15, " niveaux")], (src, v) => {
    const blur = pxImage(pxBlur(src, v.r)).data;
    return pxMap(src, (d, i) => {
      // ne lisse que les petits écarts : les contours (gros écarts) restent nets
      for (let c = 0; c < 3; ++c) { const e = Math.abs(d[i + c] - blur[i + c]); const k = Math.max(0, 1 - e / v.t); d[i + c] = d[i + c] + (blur[i + c] - d[i + c]) * k; }
    });
  }],
  average: ["Moyenne", null, (src) => {
    const img = pxImage(src), d = img.data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { r += d[i]; g += d[i + 1]; b += d[i + 2]; ++n; }
    if (n) for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; }
    return pxCanvas(img);
  }],

  // Déformation
  twirl: ["Tourbillon…", [pxR("a", "Angle", -999, 999, 50, "°")], (src, v) => {
    const [cx, cy, R0] = pxCentre(src), A = v.a * Math.PI / 180;
    return pxWarp(src, (x, y, P) => {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      if (r >= R0) { P[0] = x; P[1] = y; return true; }
      const t = Math.atan2(dy, dx) - A * (1 - r / R0);
      P[0] = cx + r * Math.cos(t); P[1] = cy + r * Math.sin(t); return true;
    });
  }],
  spherize: ["Sphérisation…", [pxR("n", "Quantité", -100, 100, 100, " %"), pxS("m", "Mode", [["n", "Normal"], ["h", "Horizontal seulement"], ["v", "Vertical seulement"]], "n")], (src, v) => {
    const [cx, cy, R0] = pxCentre(src), k = v.n / 100 * 0.8;
    return pxWarp(src, (x, y, P) => {
      const dx = (x - cx) / R0, dy = (y - cy) / R0;
      const r = v.m === "h" ? Math.abs(dx) : v.m === "v" ? Math.abs(dy) : Math.hypot(dx, dy);
      if (r >= 1 || r === 0) { P[0] = x; P[1] = y; return true; }
      const s = Math.pow(r, 1 + k) / r;   // > 0 : bombé (le centre grossit), < 0 : creusé
      P[0] = v.m === "v" ? x : cx + dx * s * R0; P[1] = v.m === "h" ? y : cy + dy * s * R0; return true;
    });
  }],
  pinch: ["Contraction…", [pxR("n", "Quantité", -100, 100, 50, " %")], (src, v) => {
    const [cx, cy, R0] = pxCentre(src), k = v.n / 100;
    return pxWarp(src, (x, y, P) => {
      const dx = (x - cx) / R0, dy = (y - cy) / R0, r = Math.hypot(dx, dy);
      if (r >= 1 || r === 0) { P[0] = x; P[1] = y; return true; }
      const rs = r + 0.35 * k * Math.sin(Math.PI * r), s = rs / r;
      P[0] = cx + dx * s * R0; P[1] = cy + dy * s * R0; return true;
    });
  }],
  polar: ["Coordonnées polaires…", [pxS("m", "Conversion", [["toPolar", "Rectangulaires vers polaires"], ["toRect", "Polaires vers rectangulaires"]], "toPolar")], (src, v) => {
    const w = src.width, h = src.height, [cx, cy, R0] = pxCentre(src);
    return pxWarp(src, (x, y, P) => {
      if (v.m === "toPolar") {
        const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
        if (r > R0) return false;
        const t = Math.atan2(dx, -dy);   // 0 en haut, sens horaire
        P[0] = ((t / (2 * Math.PI)) + 1) % 1 * w; P[1] = r / R0 * h; return true;
      }
      const t = x / w * 2 * Math.PI, r = y / h * R0;
      P[0] = cx + r * Math.sin(t); P[1] = cy - r * Math.cos(t); return true;
    });
  }],
  ripple: ["Ondulation…", [pxR("n", "Quantité", -999, 999, 100, " %"), pxS("s", "Taille", [["10", "Petite"], ["22", "Moyenne"], ["44", "Grande"]], "22")], (src, v) => {
    const l = +v.s, amp = v.n / 100 * l * 0.18;
    return pxWarp(src, (x, y, P) => { P[0] = x + amp * Math.sin(2 * Math.PI * y / l); P[1] = y + amp * Math.sin(2 * Math.PI * x / l); return true; });
  }],
  wave: ["Onde…", [pxR("l", "Longueur d’onde", 2, 999, 120, " px"), pxR("a", "Amplitude", 1, 300, 12, " px"), pxS("t", "Type", [["sin", "Sinusoïdale"], ["tri", "Triangulaire"], ["sq", "Carrée"]], "sin")], (src, v) => {
    const f = (u) => { const p = u - Math.floor(u); return v.t === "sin" ? Math.sin(2 * Math.PI * p) : v.t === "tri" ? 1 - 4 * Math.abs(p - 0.5) : p < 0.5 ? 1 : -1; };
    return pxWarp(src, (x, y, P) => { P[0] = x + v.a * f(y / v.l); P[1] = y + v.a * f(x / v.l + 0.25); return true; });
  }],
  zigzag: ["Zigzag…", [pxR("n", "Quantité", -100, 100, 30, " %"), pxR("c", "Crêtes", 1, 20, 6)], (src, v) => {
    const [cx, cy, R0] = pxCentre(src), k = v.n / 100 * R0 * 0.06;
    return pxWarp(src, (x, y, P) => {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      if (r >= R0 || r === 0) { P[0] = x; P[1] = y; return true; }
      const rs = r + k * Math.sin(r / R0 * v.c * 2 * Math.PI) * (1 - r / R0), s = rs / r;
      P[0] = cx + dx * s; P[1] = cy + dy * s; return true;
    });
  }],

  // Bruit
  noise: ["Ajout de bruit…", [pxR("n", "Quantité", 1, 400, 12, " %"), pxS("t", "Répartition", [["u", "Uniforme"], ["g", "Gaussienne"]], "g"), pxC("m", "Monochromatique", false)], (src, v) => {
    const rnd = pxRandom(7), amp = v.n / 100 * 128;
    const one = () => (v.t === "u" ? rnd() * 2 - 1 : (rnd() + rnd() + rnd() + rnd() - 2) * 0.866);
    return pxMap(src, (d, i) => {
      if (!d[i + 3]) return;
      if (v.m) { const n = one() * amp; for (let c = 0; c < 3; ++c) d[i + c] = pxClamp(d[i + c] + n); }
      else for (let c = 0; c < 3; ++c) d[i + c] = pxClamp(d[i + c] + one() * amp);
    });
  }],
  median: ["Médiane…", [pxR("r", "Rayon", 1, 10, 2, " px")], (src, v) => pxMedian(src, v.r)],
  despeckle: ["Anti-poussière", null, (src) => {
    // les grains isolés disparaissent, les contours restent : médiane là où le pixel s'écarte peu de ses voisins
    const med = pxImage(pxMedian(src, 1)).data;
    return pxMap(src, (d, i) => { for (let c = 0; c < 3; ++c) if (Math.abs(d[i + c] - med[i + c]) < 40) d[i + c] = med[i + c]; });
  }],
  dust: ["Poussière et rayures…", [pxR("r", "Rayon", 1, 10, 2, " px"), pxR("t", "Seuil", 0, 255, 10, " niveaux")], (src, v) => {
    const med = pxImage(pxMedian(src, v.r)).data;
    return pxMap(src, (d, i) => { for (let c = 0; c < 3; ++c) if (Math.abs(d[i + c] - med[i + c]) > v.t) d[i + c] = med[i + c]; });
  }],

  // Pixellisation
  mosaic: ["Mosaïque…", [pxR("s", "Taille des cellules", 2, 200, 12, " px")], (src, v) => {
    const w = src.width, h = src.height, img = pxImage(src), d = img.data, s = v.s;
    for (let by = 0; by < h; by += s)
      for (let bx = 0; bx < w; bx += s) {
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let y = by; y < Math.min(by + s, h); ++y) for (let x = bx; x < Math.min(bx + s, w); ++x) { const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; ++n; }
        for (let y = by; y < Math.min(by + s, h); ++y) for (let x = bx; x < Math.min(bx + s, w); ++x) { const i = (y * w + x) * 4; d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; d[i + 3] = a / n; }
      }
    return pxCanvas(img);
  }],
  crystallize: ["Cristallisation…", [pxR("s", "Taille des cellules", 3, 300, 20, " px")], (src, v) => pxCells(src, v.s, false)],
  pointillize: ["Pointillisme…", [pxR("s", "Taille des cellules", 3, 300, 10, " px")], (src, v) => pxCells(src, v.s, true)],
  halftone: ["Demi-teintes couleur…", [pxR("r", "Rayon maximum", 4, 127, 8, " px")], (src, v) => {
    const s = pxImage(src).data, w = src.width, h = src.height, out = pxBlank(src), d = out.data, cell = v.r * 2;
    const angles = [108, 162, 90].map((a) => a * Math.PI / 180);
    for (let c = 0; c < 3; ++c) {
      const ca = Math.cos(angles[c]), sa = Math.sin(angles[c]);
      for (let y = 0; y < h; ++y)
        for (let x = 0; x < w; ++x) {
          // coordonnées dans la trame tournée, centre de la cellule, retour dans l'image pour lire la valeur
          const u = x * ca + y * sa, t = -x * sa + y * ca;
          const uc = (Math.floor(u / cell) + 0.5) * cell, tc = (Math.floor(t / cell) + 0.5) * cell;
          const sx = Math.min(w - 1, Math.max(0, Math.round(uc * ca - tc * sa))), sy = Math.min(h - 1, Math.max(0, Math.round(uc * sa + tc * ca)));
          const val = s[(sy * w + sx) * 4 + c] / 255, rad = Math.sqrt(val) * cell * 0.71;
          d[(y * w + x) * 4 + c] = Math.hypot(u - uc, t - tc) < rad ? 255 : 0;
        }
    }
    for (let i = 3; i < d.length; i += 4) d[i] = s[i];
    return pxCanvas(out);
  }],
  mezzotint: ["Mezzotinte…", [pxS("t", "Type", [["fine", "Points fins"], ["medium", "Points moyens"], ["coarse", "Points grossiers"]], "fine")], (src, v) => {
    const size = v.t === "fine" ? 1 : v.t === "medium" ? 2 : 3, w = src.width, rnd = pxRandom(11), thr = new Float32Array(Math.ceil(src.width / size) * Math.ceil(src.height / size) * 3);
    for (let i = 0; i < thr.length; ++i) thr[i] = rnd() * 255;
    const cw = Math.ceil(src.width / size);
    return pxMap(src, (d, i, x, y) => { const k = (((y / size) | 0) * cw + ((x / size) | 0)) * 3; for (let c = 0; c < 3; ++c) d[i + c] = d[i + c] > thr[k + c] ? 255 : 0; });
  }],
  fragment: ["Fragmentation", null, (src) => pxAverage(src, 4, (x, k) => x.translate(k % 2 ? 4 : -4, k < 2 ? -4 : 4))],

  // Rendu
  clouds: ["Nuages", null, (src) => {
    const w = src.width, h = src.height, n = pxClouds(w, h, (Date.now() & 0xffff) || 1, 3), [r1, g1, b1] = rgb(fg), [r2, g2, b2] = rgb(bg);
    const img = pxBlank(src), d = img.data;
    for (let i = 0; i < n.length; ++i) { const t = n[i], o = i * 4; d[o] = r2 + (r1 - r2) * t; d[o + 1] = g2 + (g1 - g2) * t; d[o + 2] = b2 + (b1 - b2) * t; d[o + 3] = 255; }
    return pxCanvas(img);
  }],
  diffClouds: ["Nuages par différence", null, (src) => {
    const w = src.width, h = src.height, n = pxClouds(w, h, (Date.now() & 0xffff) || 1, 3), [r1, g1, b1] = rgb(fg), [r2, g2, b2] = rgb(bg);
    return pxMap(src, (d, i) => {
      const t = n[i >> 2], cr = r2 + (r1 - r2) * t, cg = g2 + (g1 - g2) * t, cb = b2 + (b1 - b2) * t;
      d[i] = Math.abs(d[i] - cr); d[i + 1] = Math.abs(d[i + 1] - cg); d[i + 2] = Math.abs(d[i + 2] - cb);
    });
  }],
  flare: ["Halo…", [pxR("x", "Centre horizontal", 0, 100, 30, " %"), pxR("y", "Centre vertical", 0, 100, 30, " %"), pxR("b", "Luminosité", 10, 300, 100, " %"),
    pxS("t", "Objectif", [["zoom", "Zoom 50-300 mm"], ["35", "Focale fixe 35 mm"], ["105", "Focale fixe 105 mm"]], "zoom")], (src, v) => {
    const c = copyOf(src), x = c.getContext("2d"), w = c.width, h = c.height, px = v.x / 100 * w, py = v.y / 100 * h, k = v.b / 100, R0 = Math.hypot(w, h);
    x.globalCompositeOperation = "lighter";
    const glow = (gx, gy, r, color, a) => { const g = x.createRadialGradient(gx, gy, 0, gx, gy, r); g.addColorStop(0, color.replace("A", a * k)); g.addColorStop(1, color.replace("A", 0)); x.fillStyle = g; x.fillRect(gx - r, gy - r, 2 * r, 2 * r); };
    glow(px, py, R0 * 0.35, "rgba(255,240,215,A)", 0.9);
    glow(px, py, R0 * 0.06, "rgba(255,255,255,A)", 1);
    // les reflets de l'objectif, sur la droite qui passe par le centre de l'image
    const ghosts = v.t === "zoom" ? [[0.4, 0.04, "rgba(120,190,255,A)"], [0.7, 0.025, "rgba(255,160,90,A)"], [1.2, 0.06, "rgba(140,255,170,A)"], [1.6, 0.03, "rgba(255,120,200,A)"]]
      : v.t === "35" ? [[0.5, 0.05, "rgba(255,200,120,A)"], [1.3, 0.035, "rgba(130,180,255,A)"]] : [[0.6, 0.08, "rgba(255,190,140,A)"], [1.4, 0.05, "rgba(170,140,255,A)"]];
    for (const [t, r, col] of ghosts) glow(px + (w / 2 - px) * t * 2, py + (h / 2 - py) * t * 2, R0 * r, col, 0.35);
    return c;
  }],

  // Renforcement
  sharpen: ["Netteté", null, (src) => pxUnsharp(src, 0.6, 1, 0)],
  sharpenMore: ["Plus net", null, (src) => pxUnsharp(src, 1.4, 1, 0)],
  sharpenEdges: ["Netteté des contours", null, (src) => pxUnsharp(src, 1, 1, 12)],
  unsharp: ["Accentuation…", [pxR("a", "Gain", 1, 500, 80, " %"), pxR("r", "Rayon", 1, 100, 2, " px"), pxR("t", "Seuil", 0, 255, 0, " niveaux")], (src, v) => pxUnsharp(src, v.a / 100, v.r, v.t)],

  // Esthétiques
  diffuse: ["Diffusion…", [pxS("m", "Mode", [["n", "Normal"], ["d", "Assombrir seulement"], ["l", "Éclaircir seulement"]], "n")], (src, v) => {
    const w = src.width, h = src.height, s = pxImage(src).data, rnd = pxRandom(5);
    return pxMap(src, (d, i, x, y) => {
      const xx = Math.min(w - 1, Math.max(0, x + Math.round(rnd() * 4 - 2))), yy = Math.min(h - 1, Math.max(0, y + Math.round(rnd() * 4 - 2))), j = (yy * w + xx) * 4;
      const lj = pxLum(s, j), li = pxLum(s, i);
      if (v.m === "d" && lj > li) return;
      if (v.m === "l" && lj < li) return;
      d[i] = s[j]; d[i + 1] = s[j + 1]; d[i + 2] = s[j + 2];
    });
  }],
  emboss: ["Estampage…", [pxR("a", "Angle", -180, 180, 135, "°"), pxR("h", "Hauteur", 1, 10, 3, " px"), pxR("n", "Quantité", 1, 500, 100, " %")], (src, v) => {
    const w = src.width, h = src.height, s = pxImage(src).data, dx = Math.round(Math.cos(v.a * Math.PI / 180) * v.h), dy = -Math.round(Math.sin(v.a * Math.PI / 180) * v.h);
    const at = (x, y) => pxLum(s, (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4);
    return pxMap(src, (d, i, x, y) => { const g = pxClamp(128 + (at (x + dx, y + dy) - at (x - dx, y - dy)) * v.n / 100); d[i] = d[i + 1] = d[i + 2] = g; });
  }],
  findEdges: ["Tracé des contours", null, (src) => {
    const w = src.width, h = src.height, s = pxImage(src).data;
    const at = (x, y, c) => s[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + c];
    return pxMap(src, (d, i, x, y) => {
      for (let c = 0; c < 3; ++c) {
        const gx = at (x + 1, y - 1, c) + 2 * at (x + 1, y, c) + at (x + 1, y + 1, c) - at (x - 1, y - 1, c) - 2 * at (x - 1, y, c) - at (x - 1, y + 1, c);
        const gy = at (x - 1, y + 1, c) + 2 * at (x, y + 1, c) + at (x + 1, y + 1, c) - at (x - 1, y - 1, c) - 2 * at (x, y - 1, c) - at (x + 1, y - 1, c);
        d[i + c] = pxClamp(255 - Math.hypot(gx, gy) * 0.5);
      }
    });
  }],
  solarize: ["Solarisation", null, (src) => pxMap(src, (d, i) => { for (let c = 0; c < 3; ++c) d[i + c] = d[i + c] > 127 ? 255 - d[i + c] : d[i + c]; })],
  wind: ["Vent…", [pxS("m", "Méthode", [["wind", "Vent"], ["blast", "Bourrasque"], ["stagger", "Décalé"]], "wind"), pxS("d", "Direction", [["l", "Depuis la droite"], ["r", "Depuis la gauche"]], "r")], (src, v) => {
    const w = src.width, h = src.height, img = pxImage(src), d = img.data, rnd = pxRandom(3), keep = v.m === "blast" ? 0.97 : 0.9;
    for (let y = 0; y < h; ++y) {
      let tr = [0, 0, 0], left = 0;
      const jitter = v.m === "stagger" ? Math.floor(rnd() * 30) : 0;
      for (let k = 0; k < w; ++k) {
        const x = v.d === "r" ? k : w - 1 - k, i = (y * w + x) * 4;
        if (left <= 0) { left = 8 + Math.floor(rnd() * (v.m === "blast" ? 80 : 30)) + jitter; tr = [d[i], d[i + 1], d[i + 2]]; }
        for (let c = 0; c < 3; ++c) { tr[c] *= keep; d[i + c] = Math.max(d[i + c], tr[c]); }
        // une traînée repart de chaque pixel plus clair qu'elle
        if (pxLum(d, i) > 0.299 * tr[0] + 0.587 * tr[1] + 0.114 * tr[2]) tr = [d[i], d[i + 1], d[i + 2]];
        --left;
      }
    }
    return pxCanvas(img);
  }],
  oil: ["Peinture à l’huile…", [pxR("r", "Stylisation", 1, 10, 4, " px")], (src, v) => pxKuwahara(src, v.r)],
  tiles: ["Carrelage…", [pxR("n", "Nombre de carreaux", 1, 99, 10), pxR("o", "Décalage maximum", 1, 99, 10, " %")], (src, v) => {
    const c = canvasOf(src.width, src.height), x = c.getContext("2d"), rnd = pxRandom(9), t = Math.max(1, Math.round(Math.min(src.width, src.height) / v.n));
    x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);
    for (let ty = 0; ty < src.height; ty += t)
      for (let tx = 0; tx < src.width; tx += t) {
        const ox = (rnd() * 2 - 1) * t * v.o / 100, oy = (rnd() * 2 - 1) * t * v.o / 100;
        x.drawImage(src, tx, ty, t, t, tx + ox, ty + oy, t, t);
      }
    return c;
  }],
  traceContour: ["Contour des valeurs…", [pxR("l", "Niveau", 0, 255, 128)], (src, v) => {
    const w = src.width, s = pxImage(src).data;
    return pxMap(src, (d, i, x, y) => {
      for (let c = 0; c < 3; ++c) {
        const up = s[i + c] >= v.l, j = x + 1 < w ? i + 4 : i, k = i + w * 4 < s.length ? i + w * 4 : i;
        d[i + c] = up !== (s[j + c] >= v.l) || up !== (s[k + c] >= v.l) ? 0 : 255;
      }
    });
  }],

  // Autres
  highPass: ["Passe-haut…", [pxR("r", "Rayon", 1, 250, 10, " px")], (src, v) => {
    const blur = pxImage(pxBlur(src, v.r)).data;
    return pxMap(src, (d, i) => { for (let c = 0; c < 3; ++c) d[i + c] = pxClamp(d[i + c] - blur[i + c] + 128); });
  }],
  maximum: ["Maximum…", [pxR("r", "Rayon", 1, 30, 2, " px")], (src, v) => pxMaxMin(src, v.r, true)],
  minimum: ["Minimum…", [pxR("r", "Rayon", 1, 30, 2, " px")], (src, v) => pxMaxMin(src, v.r, false)],
  offset: ["Décalage…", [pxR("x", "Horizontal", -2000, 2000, 100, " px"), pxR("y", "Vertical", -2000, 2000, 0, " px"), pxS("m", "Zones non définies", [["wrap", "Enrouler"], ["clear", "Transparentes"]], "wrap")], (src, v) => {
    if (v.m === "clear") { const c = canvasOf(src.width, src.height); c.getContext("2d").drawImage(src, v.x, v.y); return c; }
    return pxWarp(src, (x, y, P) => { P[0] = x - v.x; P[1] = y - v.y; return true; }, true);
  }],
};

/** Cristallisation et pointillisme : des cellules autour de germes posés au hasard sur une grille (Voronoï) ; chaque cellule
    prend la couleur moyenne de ses pixels ; pointillisme : un disque par cellule sur la couleur d'arrière-plan. */
function pxCells(src, size, dots) {
  const w = src.width, h = src.height, s = pxImage(src).data, rnd = pxRandom(13), gw = Math.ceil(w / size) + 1, gh = Math.ceil(h / size) + 1;
  const sx = new Float32Array(gw * gh), sy = new Float32Array(gw * gh);
  for (let j = 0; j < gh; ++j) for (let i = 0; i < gw; ++i) { sx[j * gw + i] = (i + rnd()) * size; sy[j * gw + i] = (j + rnd()) * size; }
  const label = new Int32Array(w * h), sum = new Float64Array(gw * gh * 5);
  for (let y = 0; y < h; ++y)
    for (let x = 0; x < w; ++x) {
      const ci = Math.floor(x / size), cj = Math.floor(y / size);
      let best = 0, bd = Infinity;
      for (let dj = -1; dj <= 1; ++dj) for (let di = -1; di <= 1; ++di) {
        const ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
        const k = jj * gw + ii, dd = (x - sx[k]) ** 2 + (y - sy[k]) ** 2;
        if (dd < bd) { bd = dd; best = k; }
      }
      label[y * w + x] = best;
      const o = (y * w + x) * 4, b5 = best * 5;
      sum[b5] += s[o]; sum[b5 + 1] += s[o + 1]; sum[b5 + 2] += s[o + 2]; sum[b5 + 3] += s[o + 3]; sum[b5 + 4] += 1;
    }
  const out = pxBlank(src), d = out.data, [br, bgc, bb] = rgb(bg), rad2 = (size * 0.45) ** 2;
  for (let p = 0; p < w * h; ++p) {
    const k = label[p], n = sum[k * 5 + 4] || 1, o = p * 4;
    if (dots && (((p % w) - sx[k]) ** 2 + ((p / w | 0) - sy[k]) ** 2) > rad2) { d[o] = br; d[o + 1] = bgc; d[o + 2] = bb; d[o + 3] = s[o + 3]; continue; }
    d[o] = sum[k * 5] / n; d[o + 1] = sum[k * 5 + 1] / n; d[o + 2] = sum[k * 5 + 2] / n; d[o + 3] = sum[k * 5 + 3] / n;
  }
  return pxCanvas(out);
}

/** Peinture à l'huile : filtre de Kuwahara (pour chaque pixel, la moyenne du quart de voisinage le plus uniforme), calculé
    avec des tables de sommes cumulées : le coût ne dépend pas du rayon. */
function pxKuwahara(src, r) {
  const w = src.width, h = src.height, s = pxImage(src).data, W = w + 1;
  const sums = [0, 1, 2].map(() => new Float64Array(W * (h + 1))), sq = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; ++y)
    for (let x = 0; x < w; ++x) {
      const o = (y * w + x) * 4, k = (y + 1) * W + x + 1, l = pxLum(s, o);
      for (let c = 0; c < 3; ++c) sums[c][k] = s[o + c] + sums[c][k - 1] + sums[c][k - W] - sums[c][k - W - 1];
      sq[k] = l * l + sq[k - 1] + sq[k - W] - sq[k - W - 1];
    }
  const lumSum = (x0, y0, x1, y1) => 0.299 * box (sums[0], x0, y0, x1, y1) + 0.587 * box (sums[1], x0, y0, x1, y1) + 0.114 * box (sums[2], x0, y0, x1, y1);
  function box (t, x0, y0, x1, y1) { return t[(y1 + 1) * W + x1 + 1] - t[y0 * W + x1 + 1] - t[(y1 + 1) * W + x0] + t[y0 * W + x0]; }
  const out = pxBlank(src), d = out.data;
  for (let y = 0; y < h; ++y)
    for (let x = 0; x < w; ++x) {
      let best = Infinity, bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
      for (const [qx, qy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x0 = Math.max(0, Math.min(x, x + qx * r)), x1 = Math.min(w - 1, Math.max(x, x + qx * r));
        const y0 = Math.max(0, Math.min(y, y + qy * r)), y1 = Math.min(h - 1, Math.max(y, y + qy * r));
        const n = (x1 - x0 + 1) * (y1 - y0 + 1), m = lumSum (x0, y0, x1, y1) / n, v = box (sq, x0, y0, x1, y1) / n - m * m;
        if (v < best) { best = v; bx0 = x0; by0 = y0; bx1 = x1; by1 = y1; }
      }
      const n = (bx1 - bx0 + 1) * (by1 - by0 + 1), o = (y * w + x) * 4;
      for (let c = 0; c < 3; ++c) d[o + c] = box (sums[c], bx0, by0, bx1, by1) / n;
      d[o + 3] = s[o + 3];
    }
  return pxCanvas(out);
}

/** Applique un filtre de la banque au calque actif (dans la sélection s'il y en a une), avec sa fenêtre et l'aperçu. */
async function pixelFilter(id) {
  const [name, fields, run] = PX_FILTERS[id], label = name.replace("…", ""), l = active();
  if (!l) return;
  const src = l.canvas;
  const make = (v) => {
    const out = run(src, v || {});
    if (!selection) return out;
    // dans la sélection seulement : le reste du calque garde ses pixels
    const c = copyOf(src), x = c.getContext("2d"), r = { x: selection.x - l.x, y: selection.y - l.y, w: selection.w, h: selection.h };
    x.clearRect(r.x, r.y, r.w, r.h);
    x.save(); x.beginPath(); x.rect(r.x, r.y, r.w, r.h); x.clip(); x.drawImage(out, 0, 0); x.restore();
    return c;
  };
  if (!fields) { say(label + "…"); await new Promise(requestAnimationFrame); rasterize(l); l.canvas = make({}); commit(label); return; }
  let pending = null, frame = 0;
  const preview = (v) => { pending = v; if (!frame) frame = requestAnimationFrame(() => { frame = 0; l.preview = make(pending); render(); }); };
  const asked = ask(label + " · « " + l.name + " »", fields, (v) => preview(v));
  $("dlg").classList.add("live");   // fond léger, fenêtre à droite : l'aperçu reste visible
  preview(Object.fromEntries(fields.map((f) => [f.k, f.value])));
  const v = await asked;
  cancelAnimationFrame(frame); delete l.preview; $("dlg").classList.remove("live");
  if (v) { rasterize(l); l.canvas = make(v); commit(label); } else render();
}

/** Le menu Filtre : les trois d'avant (noir et blanc, sépia, négatif), puis la banque par familles. */
function filterMenu() {
  const f = (id, key) => [PX_FILTERS[id][0], D(() => pixelFilter(id)), key];
  return [
    ["Noir et blanc", D(() => filterLayer("grayscale(100%)", "Noir et blanc"))], ["Sépia", D(() => filterLayer("sepia(100%)", "Sépia"))],
    ["Négatif", D(() => filterLayer("invert(100%)", "Négatif")), "Ctrl+I"],
    "#Flou", f("gauss"), f("motion"), f("radial"), f("surface"), f("average"),
    "#Déformation", f("twirl"), f("spherize"), f("pinch"), f("polar"), f("ripple"), f("wave"), f("zigzag"),
    "#Bruit", f("noise"), f("median"), f("despeckle"), f("dust"),
    "#Pixellisation", f("mosaic"), f("crystallize"), f("pointillize"), f("halftone"), f("mezzotint"), f("fragment"),
    "#Rendu", f("clouds"), f("diffClouds"), f("flare"),
    "#Renforcement", f("sharpen"), f("sharpenMore"), f("sharpenEdges"), f("unsharp"),
    "#Esthétiques", f("diffuse"), f("emboss"), f("findEdges"), f("solarize"), f("wind"), f("oil"), f("tiles"), f("traceContour"),
    "#Autres", f("highPass"), f("maximum"), f("minimum"), f("offset"),
  ];
}
