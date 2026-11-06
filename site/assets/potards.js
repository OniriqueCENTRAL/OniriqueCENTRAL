// Les potards ONIRIQUE en 360°, comme dans l'onglet KNOB de l'administration (server/src/potards.html, d'où viennent
// les dessins) : le potard, en relief (des tranches empilées sous le dessin), tourne sur lui-même ; à chaque tour il
// change de modèle, et sa valeur monte et descend. Il ne tourne que quand il est à l'écran ; mouvement réduit : immobile.
//
//   <div data-potard></div>   →   un potard 3D, à la taille de l'élément (carré)
// shortcut: les dessins sont copiés de server/src/potards.html ; à réunir dans un seul fichier si on en change un.
(() => {
  const PI = Math.PI, BONE = "#FFECEE", DIM = "rgba(255,236,238,.22)";
  let EMBER = "#E23444";
  const ang = (t) => -1.25 * PI + 1.5 * PI * t;
  const at = (c, r, a) => [c + r * Math.cos(a), c + r * Math.sin(a)];
  const glow = (g, color, blur) => { g.shadowColor = color; g.shadowBlur = blur; };
  const noGlow = (g) => { g.shadowBlur = 0; };
  function star(g, x, y, r, rot = 0, fill = BONE, blur = 10) {
    g.save(); g.translate(x, y); g.rotate(rot); g.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = i * PI / 2 - PI / 2, b = a + PI / 4;
      if (i === 0) g.moveTo(r * Math.cos(a), r * Math.sin(a));
      g.quadraticCurveTo(r * .16 * Math.cos(b), r * .16 * Math.sin(b), r * Math.cos(a + PI / 2), r * Math.sin(a + PI / 2));
    }
    g.closePath(); glow(g, fill, blur); g.fillStyle = fill; g.fill(); g.restore();
  }
  function body(g, c, r) {
    const grad = g.createRadialGradient(c - r * .35, c - r * .4, r * .1, c, c, r);
    grad.addColorStop(0, "#36161a"); grad.addColorStop(.6, "#160a0c"); grad.addColorStop(1, "#080405");
    g.beginPath(); g.arc(c, c, r, 0, 2 * PI); g.fillStyle = grad;
    g.shadowColor = "rgba(0,0,0,.8)"; g.shadowBlur = r * .25; g.shadowOffsetY = r * .08; g.fill();
    g.shadowOffsetY = 0; noGlow(g);
    g.strokeStyle = "rgba(255,220,225,.08)"; g.lineWidth = 1; g.stroke();
  }
  function arc(g, c, r, t0, t1, color, width, blur = 0, dash = []) {
    if (t1 <= t0) return;
    g.beginPath(); g.arc(c, c, r, ang(t0), ang(t1)); g.setLineDash(dash);
    g.strokeStyle = color; g.lineWidth = width; g.lineCap = dash.length ? "butt" : "round";
    if (blur) glow(g, color, blur); g.stroke(); noGlow(g); g.setLineDash([]);
  }
  function line(g, [x1, y1], [x2, y2], color, width, blur = 0) {
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.strokeStyle = color; g.lineWidth = width; g.lineCap = "round";
    if (blur) glow(g, color, blur); g.stroke(); noGlow(g);
  }
  function liquidRing(g, c, r, seed, width, spikes = 0) {
    g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = i / 120 * 2 * PI;
      let k = 1 + .07 * Math.sin(3 * a + seed) + .045 * Math.sin(5 * a + seed * 2.3) + .03 * Math.sin(9 * a + seed * .7);
      if (spikes) { const d = (a * spikes / (2 * PI)) % 1; k += .16 * Math.max(0, 1 - Math.abs(d - .5) * 14); }
      const [x, y] = at(c, r * k, a); i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath(); g.strokeStyle = BONE; g.lineWidth = width; g.lineJoin = "round"; glow(g, "rgba(255,236,238,.9)", width * 3); g.stroke(); noGlow(g);
  }
  function thorn(g, from, to, w, color) {
    const [x1, y1] = from, [x2, y2] = to, a = Math.atan2(y2 - y1, x2 - x1), n = a + PI / 2;
    g.beginPath(); g.moveTo(x1 + w * Math.cos(n), y1 + w * Math.sin(n)); g.lineTo(x2, y2); g.lineTo(x1 - w * Math.cos(n), y1 - w * Math.sin(n)); g.closePath();
    g.fillStyle = color; g.fill();
  }

  // Quatre modèles, ceux qui se lisent le mieux en petit ; size : la taille du corps, pour les tranches du relief.
  const KNOBS = [
    { size: .74, draw(g, c, R, t) {
      arc(g, c, R, 0, 1, "rgba(255,236,238,.12)", 3); arc(g, c, R, 0, t, EMBER, 3, 12); body(g, c, R * .74);
      star(g, ...at(c, R, ang(t)), R * .09); star(g, c, c, R * .44, ang(t) + PI / 2, BONE, 16);
    } },
    { size: .7, draw(g, c, R, t) {
      const N = 26;
      arc(g, c, R * .92, 0, 1, "rgba(255,236,238,.18)", 1.6); arc(g, c, R * .92, 0, t, EMBER, 2, 10);
      for (let i = 0; i < N; i++) { const u = (i + .5) / N, a = ang(u); thorn(g, at(c, R * .92, a), at(c, R * (i % 2 ? 1.02 : 1.08), a + .06), 1.6, u <= t ? EMBER : DIM); }
      body(g, c, R * .7); liquidRing(g, c, R * .5, 4.1, R * .065, 9); line(g, at(c, R * .1, ang(t)), at(c, R * .38, ang(t)), EMBER, 2, 6);
    } },
    { size: .72, draw(g, c, R, t) {
      arc(g, c, R, 0, 1, "rgba(255,236,238,.1)", 1.5); arc(g, c, R, 0, t, EMBER, 3, 12);
      for (let i = 0; i < 7; i++) { const u = i / 6; star(g, ...at(c, R * 1.16, ang(u)), R * .05, 0, u <= t ? EMBER : "rgba(255,236,238,.35)", u <= t ? 6 : 0); }
      body(g, c, R * .72);
      for (let i = 0; i < 8; i++) line(g, [c, c], at(c, R * (i % 2 ? .45 : .62), ang(t) + PI / 8 + i * PI / 4), "rgba(255,236,238,.3)", 1);
      const a = ang(t), end = at(c, R * 1.08, a), grad = g.createLinearGradient(c, c, ...end);
      grad.addColorStop(0, BONE); grad.addColorStop(1, EMBER); line(g, [c, c], end, grad, 2, 10); star(g, c, c, R * .12);
    } },
    { size: .8, draw(g, c, R, t) {
      arc(g, c, R, 0, 1, "rgba(255,236,238,.1)", 1.5); arc(g, c, R, 0, t, EMBER, 3, 12); body(g, c, R * .8);
      for (const k of [.72, .6, .44]) { g.beginPath(); g.arc(c, c, R * k, 0, 2 * PI); g.strokeStyle = "rgba(255,236,238,.11)"; g.lineWidth = 1.2; g.stroke(); }
      g.beginPath(); g.arc(c, c, R * .1, 0, 2 * PI); g.strokeStyle = BONE; g.lineWidth = 2; glow(g, BONE, 8); g.stroke(); noGlow(g);
      const a = ang(t);
      for (let k = 0; k < 4; k++) star(g, ...at(c, R * .52, a + k * PI / 2), R * (k ? .06 : .09), 0, k ? "rgba(255,236,238,.45)" : EMBER, k ? 0 : 10);
    } },
  ];

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SLICES = 12;
  const style = document.createElement("style");
  style.textContent = `
[data-potard] { perspective: 900px; display: grid; place-items: center; }
.pt3d { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; }
.pt3d > * { position: absolute; inset: 0; margin: auto; }
.pt3d canvas { width: 100%; height: 100%; }
.pt3d i { border-radius: 50%; background: radial-gradient(circle at 35% 30%, #2b1114, #0c0607 70%); box-shadow: inset 0 0 0 1px rgba(255,210,214,.07); }`;
  document.head.append(style);

  for (const host of document.querySelectorAll("[data-potard]")) {
    const stage = document.createElement("div"), canvas = document.createElement("canvas");
    stage.className = "pt3d";
    const slices = [];
    for (let i = SLICES; i > 0; i--) {
      const s = document.createElement("i");
      s.style.transform = `translateZ(${-i * 1.4}px)`; s.style.filter = `brightness(${.55 + .45 * (1 - i / SLICES)})`;
      stage.append(s); slices.push(s);
    }
    canvas.style.transform = "translateZ(1px)";
    stage.append(canvas); host.append(stage);
    let model = 0, last = -1;
    const paint = (t) => {
      const css = host.clientWidth || 150, dpr = Math.min(devicePixelRatio || 1, 2), g = canvas.getContext("2d");
      if (canvas.width !== Math.round(css * dpr)) canvas.width = canvas.height = Math.round(css * dpr);
      const acc = getComputedStyle(document.documentElement).getPropertyValue("--acc").trim(); // la couleur du compte
      EMBER = acc ? `rgb(${acc})` : "#E23444";
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, css, css);
      KNOBS[model].draw(g, css / 2, css * .36, t);
      if (last !== model) { last = model; for (const s of slices) s.style.width = s.style.height = KNOBS[model].size * 72 + "%"; }
    };
    if (reduce) { paint(.62); stage.style.transform = "rotateX(-18deg) rotateY(-24deg)"; continue; }
    let on = false, start = 0, turn = 0;
    new IntersectionObserver(([e]) => { on = e.isIntersecting; if (on) requestAnimationFrame(loop); }).observe(host);
    function loop(now) {
      if (!on) return;
      if (!start) start = now;
      const s = (now - start) / 1000, deg = s * 40; // un tour en 9 s
      const n = Math.floor(deg / 360);
      if (n !== turn) { turn = n; model = (model + 1) % KNOBS.length; } // à chaque tour, le modèle suivant
      stage.style.transform = `rotateX(-18deg) rotateY(${deg % 360}deg)`;
      paint(.5 + .38 * Math.sin(s * 1.3));
      requestAnimationFrame(loop);
    }
  }
})();
