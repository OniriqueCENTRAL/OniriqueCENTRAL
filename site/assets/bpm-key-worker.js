// Analyse d'un morceau pour la page « BPM et tonalité » : tourne dans un Web Worker, sur le son déjà décodé par la page
// (mono, 22 050 Hz). Rien ne quitte le navigateur.
//
//   postMessage({ samples: Float32Array, sampleRate })  →  { tempo, key, chroma, tuning }  ou  { error }
//
// Tempo : enveloppe des attaques (flux spectral sur quatre bandes), puis autocorrélation ; le battement retenu est
// celui dont le demi-temps se répète aussi, et 2, 4 et 8 temps plus loin, puis il est affiné sur 8, 16, 32 et 64 temps.
// Tonalité : énergie des douze notes sur tout le morceau (pics du spectre dès 30 Hz, accordage estimé), comparée aux
// profils de Temperley des 24 tonalités.
// Mesuré sur 95 prods nommées par leurs beatmakers (BPM) dont 60 avec leur tonalité : BPM juste 77 % → 87 %,
// tonalité juste 25 % → 60 % (les profils de Krumhansl lisaient la quinte ou le majeur à cause des harmoniques des 808).

/** FFT en place pour une taille puissance de deux. */
function makeFFT(n) {
  const rev = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0, bits = Math.log2(n); i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  return (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const c = cos[k * step], s = -sin[k * step], a = start + k, b = a + half;
          const xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  };
}

const hann = (n) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));

/** Sommet affiné d'une courbe autour de l'indice i : décalage entre -0.5 et 0.5. */
function parabola(a, b, c) {
  const d = a - 2 * b + c;
  return d ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / d)) : 0;
}

//==============================================================================
//  Tempo
//==============================================================================
const MIN_BPM = 60, MAX_BPM = 200;
const BANDS = [0, 200, 800, 3200]; // Hz : grave (kick, basse), bas médium, médium, aigu (charleys)
const TERMS = [[0.5, 1], [1, 2], [2, 1], [4, 1], [8, 1]]; // [écart en temps, poids] comptés pour choisir le battement

function tempo(x, sampleRate) {
  const N = 1024, HOP = 128, fps = sampleRate / HOP;
  const frames = Math.floor((x.length - N) / HOP) + 1;
  if (frames < fps * 4) return null; // moins de quatre secondes : rien à mesurer

  // Flux spectral par bande : ce qui apparaît d'une trame à la suivante, sur des amplitudes compressées. Chaque
  // bande pèse autant que les autres, pour qu'un kick ne soit pas noyé sous les charleys (ni l'inverse).
  const fft = makeFFT(N), win = hann(N), re = new Float64Array(N), im = new Float64Array(N);
  const edges = [...BANDS, sampleRate / 2].map((hz) => Math.min(N / 2, Math.round(hz * N / sampleRate)));
  const previous = new Float64Array(N / 2), bands = BANDS.map(() => new Float64Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let i = 0, o = f * HOP; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < bands.length; b++) {
      let sum = 0;
      for (let k = Math.max(1, edges[b]); k < edges[b + 1]; k++) {
        const m = Math.log1p(Math.hypot(re[k], im[k]));
        if (m > previous[k]) sum += m - previous[k];
        previous[k] = m;
      }
      bands[b][f] = sum;
    }
  }
  const env = new Float64Array(frames);
  for (const band of bands) {
    let mean = 0;
    for (let i = 0; i < frames; i++) mean += band[i] / frames;
    if (mean > 0) for (let i = 0; i < frames; i++) env[i] += band[i] / mean;
  }

  // Seules les attaques restent : la moyenne locale est retirée, puis la moyenne d'ensemble.
  const around = Math.round(fps * 0.2), prefix = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) prefix[i + 1] = prefix[i] + env[i];
  let mean = 0;
  for (let i = 0; i < frames; i++) {
    const a = Math.max(0, i - around), b = Math.min(frames, i + around + 1);
    env[i] = Math.max(0, env[i] - (prefix[b] - prefix[a]) / (b - a));
    mean += env[i] / frames;
  }
  for (let i = 0; i < frames; i++) env[i] -= mean;

  // Autocorrélation par FFT, jusqu'à 64 temps : c'est la longueur qui donne la précision.
  let size = 1;
  while (size < 2 * frames) size *= 2;
  const wide = makeFFT(size), ar = new Float64Array(size), ai = new Float64Array(size);
  ar.set(env);
  wide(ar, ai);
  for (let i = 0; i < size; i++) { ar[i] = ar[i] * ar[i] + ai[i] * ai[i]; ai[i] = 0; }
  wide(ar, ai);
  if (!(ar[0] > 0)) return null; // silence, ou son sans aucune attaque
  const maxLag = Math.min(Math.floor(frames / 2), Math.ceil(fps * 60 / MIN_BPM * 64) + 8);
  const acf = new Float64Array(maxLag + 1), zero = ar[0] / frames;
  for (let lag = 0; lag <= maxLag; lag++) acf[lag] = ar[lag] / (frames - lag) / zero;
  const at = (lag) => {
    const i = Math.floor(lag);
    return i + 1 > maxLag ? 0 : acf[i] + (acf[i + 1] - acf[i]) * (lag - i);
  };

  // Le battement : la période dont le demi-temps se répète aussi, et 2, 4 et 8 temps plus loin (mesures à 4 temps).
  // Compter 3 temps plus loin, comme avant, faisait prendre un tempo pour ses deux tiers ou ses quatre tiers (164 lu
  // 109, 96 lu 128) ; le demi-temps les écarte, car un tempo pris aux deux tiers tombe à contretemps. Entre un tempo et
  // son double, la préférence pour les tempos autour de 125 choisit. Le temps lui-même compte double, et un écart qui
  // dépasse le morceau (fichier court) ne compte pas.
  let best = 0, bestScore = -Infinity;
  for (let lag = fps * 60 / MAX_BPM; lag <= fps * 60 / MIN_BPM; lag += 0.25) {
    let sum = 0, weight = 0;
    for (const [beats, w] of TERMS) if (beats * lag + 1 <= maxLag) { sum += w * at(beats * lag); weight += w; }
    const octaves = Math.log2(60 * fps / lag / 125);
    const score = sum / weight * Math.exp(-0.5 * (octaves / 0.7) ** 2);
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  if (!(bestScore > 0.01)) return null;

  // Précision : le sommet est recherché sur 1, 2, 4… jusqu'à 64 temps ; chaque étape divise l'incertitude par deux.
  // La recherche s'arrête dès que la répétition s'efface (tempo qui bouge, morceau trop court).
  let lag = best, level = 0;
  for (const beats of [1, 2, 4, 8, 16, 32, 64]) {
    const centre = lag * beats, reach = beats === 1 ? 1.5 : 2.5;
    const from = Math.max(1, Math.floor(centre - reach)), to = Math.ceil(centre + reach);
    if (to + 1 > maxLag) break;
    let peak = from;
    for (let i = from + 1; i <= to; i++) if (acf[i] > acf[peak]) peak = i;
    const found = acf[peak] >= 0.1 && acf[peak] >= acf[peak - 1] && acf[peak] >= acf[peak + 1] && acf[peak] >= level * 0.5;
    if (!found) { if (beats < 4) continue; break; }
    lag = (peak + parabola(acf[peak - 1], acf[peak], acf[peak + 1])) / beats;
    if (beats <= 4) level = Math.max(level, acf[peak]);
  }
  const bpm = Math.max(MIN_BPM / 2, Math.min(MAX_BPM * 2, 60 * fps / lag));
  return { bpm, strength: Math.max(0, Math.min(1, at(lag))) };
}

//==============================================================================
//  Tonalité
//==============================================================================
// Profils de Temperley (Music and Probability, 2007) : la tierce et la quinte y pèsent moins par rapport à la tonique
// que dans ceux de Krumhansl, et les notes hors gamme presque rien.
const MAJOR = [0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.104, 0.366, 0.057, 0.400];
const MINOR = [0.712, 0.084, 0.474, 0.618, 0.049, 0.460, 0.105, 0.747, 0.404, 0.067, 0.133, 0.330];

function correlation(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i] / n; mb += b[i] / n; }
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function tonality(x, sampleRate) {
  const N = 16384, HOP = 8192;
  const frames = Math.floor((x.length - N) / HOP) + 1;
  if (frames < 2) return null;
  const fft = makeFFT(N), win = hann(N), re = new Float64Array(N), im = new Float64Array(N), mag = new Float64Array(N / 2);
  // Dès 30 Hz : la fondamentale des 808 compte.
  const low = Math.ceil(30 * N / sampleRate), high = Math.min(N / 2 - 2, Math.floor(2000 * N / sampleRate));

  // Les pics du spectre de chaque trame : leur hauteur en demi-tons (69 = la 440) et leur poids.
  const pitches = [], weights = [];
  for (let f = 0; f < frames; f++) {
    let energy = 0;
    for (let i = 0, o = f * HOP; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; energy += x[o + i] ** 2; }
    if (energy / N < 1e-7) continue; // silence
    fft(re, im);
    let top = 0;
    for (let k = low - 1; k <= high + 1; k++) { mag[k] = Math.hypot(re[k], im[k]); if (mag[k] > top) top = mag[k]; }
    for (let k = low; k <= high; k++) {
      if (mag[k] <= mag[k - 1] || mag[k] < mag[k + 1] || mag[k] < top * 0.02) continue;
      const bin = k + parabola(Math.log(mag[k - 1] + 1e-12), Math.log(mag[k]), Math.log(mag[k + 1] + 1e-12));
      pitches.push(69 + 12 * Math.log2(bin * sampleRate / N / 440));
      weights.push(Math.sqrt(mag[k] / top));
    }
  }
  if (pitches.length < 50) return null;

  // Accordage : l'écart moyen des pics par rapport au demi-ton juste (moyenne circulaire).
  let sx = 0, sy = 0;
  for (let i = 0; i < pitches.length; i++) {
    const angle = 2 * Math.PI * (pitches[i] - Math.round(pitches[i]));
    sx += weights[i] * Math.cos(angle); sy += weights[i] * Math.sin(angle);
  }
  const offset = Math.atan2(sy, sx) / (2 * Math.PI); // en demi-tons, entre -0.5 et 0.5

  // Un pic compte d'autant plus qu'il tombe juste sur une note.
  const chroma = new Float64Array(12);
  for (let i = 0; i < pitches.length; i++) {
    const p = pitches[i] - offset, note = Math.round(p);
    chroma[((note % 12) + 12) % 12] += weights[i] * Math.cos(Math.PI * (p - note)) ** 2;
  }

  const keys = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = Array.from({ length: 12 }, (_, i) => chroma[(i + tonic) % 12]);
    keys.push({ tonic, mode: 'major', score: correlation(rotated, MAJOR) }, { tonic, mode: 'minor', score: correlation(rotated, MINOR) });
  }
  keys.sort((a, b) => b.score - a.score);
  const max = Math.max(...chroma);
  return { key: keys[0], second: keys[1], chroma: Array.from(chroma, (v) => (max ? v / max : 0)), tuning: 440 * 2 ** (offset / 12) };
}

// only: "tempo" : seulement le tempo (ONIRIQUE CUT n’a pas besoin de la tonalité, le plus long à calculer).
function analyse({ samples, sampleRate, only }) {
  const t = tempo(samples, sampleRate), k = only === "tempo" ? null : tonality(samples, sampleRate);
  if (!t && !k) return { error: 'Ce fichier est trop court ou silencieux pour être analysé.' };
  return { tempo: t, key: k && k.key, second: k && k.second, chroma: k && k.chroma, tuning: k && k.tuning };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (event) => {
    try { self.postMessage(analyse(event.data)); } catch { self.postMessage({ error: "L'analyse a échoué sur ce fichier." }); }
  };
}
if (typeof module !== 'undefined') module.exports = { analyse }; // essais hors navigateur
