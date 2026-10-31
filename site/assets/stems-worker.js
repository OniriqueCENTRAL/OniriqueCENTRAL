// Séparation rapide des pistes d'un passage, pour ONIRIQUE CUT : tourne dans un Web Worker, rien ne quitte le navigateur.
//
//   postMessage({ L, R, rate })  →  { prod, melo, drums, bass, vocals } : chaque piste en [gauche, droite] (Float32Array)
//
// Méthode (approchée, sans intelligence artificielle) : spectrogramme des deux voies, puis
//   - percussif / harmonique par filtres médians (Fitzgerald 2010) : un son percussif est large en fréquence et bref,
//     un son harmonique est étroit en fréquence et tenu ;
//   - centre / côtés : une voix est presque toujours au centre ; une basse aussi, mais sous 160 Hz.
// drums = la part percussive ; basse = le centre sous 160 Hz ; voix = la part harmonique du centre (160 Hz – 9 kHz) ;
// mélodie = la part harmonique des côtés, plus la basse ; prod = drums + mélodie (le morceau sans sa voix).
const N = 2048, HOP = 512, BINS = N / 2 + 1, MEDIAN = 17;

function makeFFT(n) {
  const rev = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0, bits = Math.log2(n); i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  return (re, im, inverse) => {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const c = cos[k * step], s = inverse ? sin[k * step] : -sin[k * step], a = start + k, b = a + half;
          const xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
  };
}
const fft = makeFFT(N);
const hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));

function stft(x, frames) {
  const re = new Float32Array(frames * BINS), im = new Float32Array(frames * BINS), fr = new Float64Array(N), fi = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    const o = f * HOP - N / 2;
    for (let i = 0; i < N; i++) { const k = o + i; fr[i] = k >= 0 && k < x.length ? x[k] * hann[i] : 0; fi[i] = 0; }
    fft(fr, fi, false);
    re.set(fr.subarray(0, BINS), f * BINS); im.set(fi.subarray(0, BINS), f * BINS);
  }
  return { re, im };
}
function istft(re, im, frames, length) {
  const out = new Float32Array(length), norm = new Float32Array(length), fr = new Float64Array(N), fi = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < BINS; k++) { fr[k] = re[f * BINS + k]; fi[k] = im[f * BINS + k]; }
    for (let k = 1; k < N / 2; k++) { fr[N - k] = fr[k]; fi[N - k] = -fi[k]; }
    fft(fr, fi, true);
    const o = f * HOP - N / 2;
    for (let i = 0; i < N; i++) { const t = o + i; if (t >= 0 && t < length) { out[t] += fr[i] / N * hann[i]; norm[t] += hann[i] * hann[i]; } }
  }
  for (let i = 0; i < length; i++) if (norm[i] > 1e-6) out[i] /= norm[i];
  return out;
}
/** Médiane glissante (fenêtre MEDIAN) d'une suite de valeurs lues par get(i), i de 0 à n - 1. */
function medians(n, get, put) {
  const half = MEDIAN >> 1, buf = new Float32Array(MEDIAN);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i - half; j <= i + half; j++) buf[m++] = j >= 0 && j < n ? get(j) : 0;
    put(i, buf.sort()[half]);
  }
}

self.onmessage = (event) => {
  const { L, R, rate } = event.data, length = L.length, frames = Math.ceil(length / HOP) + 1;
  const l = stft(L, frames), r = stft(R, frames), size = frames * BINS;
  const P = new Float32Array(size);
  for (let i = 0; i < size; i++) P[i] = Math.sqrt(l.re[i] ** 2 + l.im[i] ** 2 + r.re[i] ** 2 + r.im[i] ** 2);
  const Hm = new Float32Array(size), Pm = new Float32Array(size);
  for (let k = 0; k < BINS; k++) medians(frames, (f) => P[f * BINS + k], (f, v) => { Hm[f * BINS + k] = v; });
  for (let f = 0; f < frames; f++) medians(BINS, (k) => P[f * BINS + k], (k, v) => { Pm[f * BINS + k] = v; });
  const kLow = Math.round(160 * N / rate), kHigh = Math.round(9000 * N / rate);
  const parts = { drums: [], bass: [], vocals: [], melo: [] };
  for (const name of Object.keys(parts)) parts[name] = [new Float32Array(size), new Float32Array(size), new Float32Array(size), new Float32Array(size)]; // reL imL reR imR
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < BINS; k++) {
      const i = f * BINS + k, h = Hm[i] ** 2, p = Pm[i] ** 2, mh = h / (h + p + 1e-12), mp = 1 - mh;
      const mr = (l.re[i] + r.re[i]) / 2, mi = (l.im[i] + r.im[i]) / 2, sr = (l.re[i] - r.re[i]) / 2, si = (l.im[i] - r.im[i]) / 2;
      const low = k < kLow, voice = k >= kLow && k < kHigh;
      const set = (name, aR, aI, bR, bI) => { const t = parts[name]; t[0][i] = aR; t[1][i] = aI; t[2][i] = bR; t[3][i] = bI; };
      set("drums", l.re[i] * mp, l.im[i] * mp, r.re[i] * mp, r.im[i] * mp);
      set("bass", low ? mr : 0, low ? mi : 0, low ? mr : 0, low ? mi : 0);
      set("vocals", voice ? mr * mh : 0, voice ? mi * mh : 0, voice ? mr * mh : 0, voice ? mi * mh : 0);
      // Mélodie : l'harmonique des côtés, plus la basse au centre.
      const cr = low ? mr : 0, ci = low ? mi : 0;
      set("melo", cr + sr * mh, ci + si * mh, cr - sr * mh, ci - si * mh);
    }
  }
  const out = {};
  for (const [name, t] of Object.entries(parts)) out[name] = [istft(t[0], t[1], frames, length), istft(t[2], t[3], frames, length)];
  out.prod = [0, 1].map((c) => out.drums[c].map((v, i) => v + out.melo[c][i]));
  self.postMessage(out, Object.values(out).flatMap((pair) => pair.map((a) => a.buffer)));
};
