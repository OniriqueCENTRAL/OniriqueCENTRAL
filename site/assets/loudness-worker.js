// Mesure du volume d'un morceau pour la page « Volume avant sortie » : tourne dans un Web Worker, sur le son décodé à
// 48 kHz. Rien ne quitte le navigateur.
//
//   postMessage({ channels: [Float32Array…], sampleRate: 48000 })
//     →  { integrated, truePeak, samplePeak, shortMax, range }   (LUFS, dBTP, dBFS, LUFS, LU)  ou  { error }
//
// Volume intégré : recommandation UIT-R BS.1770 (filtre K, blocs de 400 ms, seuils à -70 LUFS puis à -10 LU).
// Pic réel : le signal est reconstruit quatre fois plus finement autour des plus fortes valeurs, là où un pic peut
// dépasser entre deux échantillons.

// Filtre K à 48 kHz : un plateau dans l'aigu, puis un coupe-bas.
const SHELF = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] };
const HIGHPASS = { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] };

function biquad(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

const lufs = (power) => -0.691 + 10 * Math.log10(power);
const db = (amplitude) => (amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity);

/** Énergie par bloc glissant (durée et pas en échantillons), toutes voies additionnées. */
function blocks(weighted, size, hop) {
  const frames = weighted[0].length, out = [];
  const prefix = weighted.map((w) => { const p = new Float64Array(frames + 1); for (let i = 0; i < frames; i++) p[i + 1] = p[i] + w[i] * w[i]; return p; });
  for (let start = 0; start + size <= frames; start += hop) {
    let power = 0;
    for (const p of prefix) power += (p[start + size] - p[start]) / size;
    out.push(power);
  }
  return out;
}

/** Moyenne des blocs au-dessus du seuil absolu (-70 LUFS) puis du seuil relatif (en LU sous leur moyenne). */
function gated(powers, relative) {
  const loud = powers.filter((p) => p > 0 && lufs(p) > -70);
  if (!loud.length) return { kept: [], mean: 0 };
  const mean = loud.reduce((a, b) => a + b, 0) / loud.length, threshold = lufs(mean) + relative;
  const kept = loud.filter((p) => lufs(p) > threshold);
  return { kept, mean: kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : 0 };
}

// Reconstruction entre deux échantillons : sinus cardinal fenêtré, 12 points de part et d'autre, trois positions.
const TAPS = 12;
const KERNELS = [0.25, 0.5, 0.75].map((frac) => {
  const k = new Float64Array(2 * TAPS);
  for (let j = 0; j < 2 * TAPS; j++) {
    const t = j - TAPS + 1 - frac; // distance, en échantillons, entre le point reconstruit et l'échantillon j
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    k[j] = sinc * (0.5 + 0.5 * Math.cos(Math.PI * t / TAPS));
  }
  return k;
});

function peaks(x) {
  let sample = 0;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > sample) sample = v; }
  let real = sample;
  const floor = sample * 0.5; // un pic entre deux échantillons ne peut dépasser le maximum que près d'une valeur forte
  for (let i = TAPS; i < x.length - TAPS; i++) {
    if (Math.abs(x[i]) < floor && Math.abs(x[i + 1]) < floor) continue;
    for (const k of KERNELS) {
      let v = 0;
      for (let j = 0; j < 2 * TAPS; j++) v += x[i - TAPS + 1 + j] * k[j];
      if (Math.abs(v) > real) real = Math.abs(v);
    }
  }
  return { sample, real };
}

function measure({ channels, sampleRate }) {
  if (sampleRate !== 48000) return { error: "Le son doit être à 48 kHz." };
  if (channels[0].length < sampleRate * 0.4) return { error: "Ce fichier est trop court pour être mesuré (0,4 seconde au moins)." };
  const weighted = channels.map((x) => biquad(biquad(x, SHELF), HIGHPASS));

  const integrated = gated(blocks(weighted, sampleRate * 0.4, sampleRate * 0.1), -10);
  if (!integrated.kept.length) return { error: "Ce fichier est silencieux." };

  // Volume à court terme (blocs de 3 s) : son maximum, et l'écart entre passages calmes et forts (du 10e au 95e centile).
  const short = blocks(weighted, sampleRate * 3, sampleRate * 1);
  const kept = gated(short, -20).kept.map(lufs).sort((a, b) => a - b);
  const at = (q) => kept[Math.min(kept.length - 1, Math.floor(q * kept.length))];
  let sample = 0, real = 0;
  for (const x of channels) { const p = peaks(x); sample = Math.max(sample, p.sample); real = Math.max(real, p.real); }
  return {
    integrated: lufs(integrated.mean), truePeak: db(real), samplePeak: db(sample),
    shortMax: short.length ? lufs(Math.max(...short)) : null,
    range: kept.length > 1 ? at(0.95) - at(0.10) : null,
  };
}

if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.onmessage = (event) => {
    try { self.postMessage(measure(event.data)); } catch { self.postMessage({ error: "La mesure a échoué sur ce fichier." }); }
  };
}
if (typeof module !== "undefined") module.exports = { measure }; // essais hors navigateur
