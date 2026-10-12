// Analyse d'un morceau pour la page « BPM et tonalité » : tourne dans un Web Worker, sur le son déjà décodé par la page
// (mono, 22 050 Hz). Rien ne quitte le navigateur.
//
//   postMessage({ samples: Float32Array, sampleRate })  →  { tempo, key, chroma, tuning }  ou  { error }
//
// Tempo : enveloppe des attaques (flux spectral), puis autocorrélation ; le battement retenu est celui qui se répète
// aussi sur 2, 4 et 8 temps, ce qui donne sa valeur au dixième de BPM près.
// Tonalité : énergie des douze notes sur tout le morceau (pics du spectre, accordage estimé), comparée aux profils de
// Krumhansl et Kessler des 24 tonalités.

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

function tempo(x, sampleRate) {
  const N = 1024, HOP = 256, fps = sampleRate / HOP;
  const frames = Math.floor((x.length - N) / HOP) + 1;
  if (frames < fps * 4) return null; // moins de quatre secondes : rien à mesurer

  // Flux spectral : ce qui apparaît d'une trame à la suivante, sur des amplitudes compressées.
  const fft = makeFFT(N), win = hann(N), re = new Float64Array(N), im = new Float64Array(N);
  const previous = new Float64Array(N / 2), flux = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    for (let i = 0, o = f * HOP; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let sum = 0;
    for (let k = 1; k < N / 2; k++) {
      const m = Math.log1p(Math.hypot(re[k], im[k]));
      if (m > previous[k]) sum += m - previous[k];
      previous[k] = m;
    }
    flux[f] = sum;
  }

  // Seules les attaques restent : la moyenne locale est retirée, puis la moyenne d'ensemble.
  const around = Math.round(fps * 0.4), prefix = new Float64Array(frames + 1), env = new Float64Array(frames);
  for (let i = 0; i < frames; i++) prefix[i + 1] = prefix[i] + flux[i];
  let mean = 0;
  for (let i = 0; i < frames; i++) {
    const a = Math.max(0, i - around), b = Math.min(frames, i + around + 1);
    env[i] = Math.max(0, flux[i] - (prefix[b] - prefix[a]) / (b - a));
    mean += env[i] / frames;
  }
  for (let i = 0; i < frames; i++) env[i] -= mean;

  const maxLag = Math.min(frames - 2, Math.ceil(fps * 60 / MIN_BPM * 8) + 8);
  const acf = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0, end = frames - lag; i < end; i++) sum += env[i] * env[i + lag];
    acf[lag] = sum / (frames - lag);
  }
  if (!(acf[0] > 0)) return null; // silence, ou son sans aucune attaque
  for (let lag = maxLag; lag >= 0; lag--) acf[lag] /= acf[0];
  const at = (lag) => {
    const i = Math.floor(lag);
    return i + 1 > maxLag ? 0 : acf[i] + (acf[i + 1] - acf[i]) * (lag - i);
  };

  // Le battement : la période qui se retrouve aussi deux et quatre temps plus loin, avec une préférence douce pour
  // les tempos proches de 120 (c'est elle qui départage 70 et 140).
  let best = 0, bestScore = -Infinity;
  for (let lag = fps * 60 / MAX_BPM; lag <= fps * 60 / MIN_BPM; lag += 0.25) {
    const octaves = Math.log2(60 * fps / lag / 120);
    const score = (at(lag) + 0.5 * at(2 * lag) + 0.25 * at(4 * lag)) * Math.exp(-0.5 * (octaves / 0.9) ** 2);
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  if (!(bestScore > 0.02)) return null;

  // Précision : le sommet est recherché sur 1, 2, 4 puis 8 temps ; chaque étape divise l'incertitude par deux.
  let lag = best;
  for (const beats of [1, 2, 4, 8]) {
    const centre = lag * beats, reach = beats * 0.5 + 1;
    let peak = 0;
    for (let i = Math.max(1, Math.floor(centre - reach)); i <= Math.min(maxLag - 1, Math.ceil(centre + reach)); i++) {
      if (!peak || acf[i] > acf[peak]) peak = i;
    }
    if (!peak || acf[peak] < 0.03) break;
    lag = (peak + parabola(acf[peak - 1], acf[peak], acf[peak + 1])) / beats;
  }
  const bpm = Math.max(MIN_BPM / 2, Math.min(MAX_BPM * 2, 60 * fps / lag));
  return { bpm, strength: Math.max(0, Math.min(1, at(lag))) };
}

//==============================================================================
//  Tonalité
//==============================================================================
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

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
  const low = Math.ceil(60 * N / sampleRate), high = Math.min(N / 2 - 2, Math.floor(2000 * N / sampleRate));

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

function analyse({ samples, sampleRate }) {
  const t = tempo(samples, sampleRate), k = tonality(samples, sampleRate);
  if (!t && !k) return { error: 'Ce fichier est trop court ou silencieux pour être analysé.' };
  return { tempo: t, key: k && k.key, second: k && k.second, chroma: k && k.chroma, tuning: k && k.tuning };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (event) => {
    try { self.postMessage(analyse(event.data)); } catch { self.postMessage({ error: "L'analyse a échoué sur ce fichier." }); }
  };
}
if (typeof module !== 'undefined') module.exports = { analyse }; // essais hors navigateur
