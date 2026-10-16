// Équilibre des fréquences et stéréo d'un morceau, pour l'outil « Comparer à une référence » (reference-mix.html).
//
//   postMessage({ channels: [Float32Array…], sampleRate })
//     →  { points: [{ hz, mid, side }], bands: [{ id, mid, side }], correlation, lowCorrelation }   ou  { error }
//
// mid / side : puissance moyenne en dB (spectre moyen du milieu et des côtés), par 1/6 d'octave de 20 Hz à 20 kHz
// et par zone (sub, basses…). correlation : de −1 (opposition de phase) à 1 (mono) ; lowCorrelation : sous 120 Hz.
const SIZE = 8192;
const BANDS = [["sub", 20, 60], ["bass", 60, 250], ["lowmid", 250, 500], ["mid", 500, 2000], ["presence", 2000, 5000], ["high", 5000, 10000], ["air", 10000, 20000]];

// FFT radix 2 en place (réel + imaginaire).
const rev = new Uint32Array(SIZE), cos = new Float64Array(SIZE / 2), sin = new Float64Array(SIZE / 2);
for (let i = 0, bits = Math.log2(SIZE); i < SIZE; i++) {
  let r = 0;
  for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
  rev[i] = r;
}
for (let i = 0; i < SIZE / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / SIZE); sin[i] = Math.sin(-2 * Math.PI * i / SIZE); }
function fft(re, im) {
  for (let i = 0; i < SIZE; i++) {
    const j = rev[i];
    if (j > i) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= SIZE; size *= 2) {
    const half = size / 2, step = SIZE / size;
    for (let start = 0; start < SIZE; start += size) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step], s = sin[k * step], a = start + k, b = a + half;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

const db = (p) => 10 * Math.log10(p + 1e-20);

function analyse({ channels, sampleRate }) {
  const left = channels[0], right = channels[1] || channels[0];
  const n = left.length;
  if (n < SIZE) return { error: "Ce fichier est trop court (quelques secondes au moins)." };

  const window = new Float64Array(SIZE);
  for (let i = 0; i < SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SIZE - 1));
  const midPower = new Float64Array(SIZE / 2), sidePower = new Float64Array(SIZE / 2);
  const re = new Float64Array(SIZE), im = new Float64Array(SIZE), re2 = new Float64Array(SIZE), im2 = new Float64Array(SIZE);
  let frames = 0;
  // Trames à moitié superposées ; les passages silencieux comptent peu, ils ne faussent pas la moyenne.
  for (let start = 0; start + SIZE <= n; start += SIZE / 2) {
    for (let i = 0; i < SIZE; i++) {
      const l = left[start + i], r = right[start + i];
      re[i] = 0.5 * (l + r) * window[i]; im[i] = 0;
      re2[i] = 0.5 * (l - r) * window[i]; im2[i] = 0;
    }
    fft(re, im); fft(re2, im2);
    for (let k = 1; k < SIZE / 2; k++) {
      midPower[k] += re[k] * re[k] + im[k] * im[k];
      sidePower[k] += re2[k] * re2[k] + im2[k] * im2[k];
    }
    frames++;
  }

  const binHz = sampleRate / SIZE;
  const sum = (power, lo, hi) => {
    let total = 0;
    for (let k = Math.max(1, Math.ceil(lo / binHz)); k <= Math.min(SIZE / 2 - 1, Math.floor(hi / binHz)); k++) total += power[k];
    return total / frames;
  };
  // Points tous les 1/6 d'octave ; chacun couvre 1/3 d'octave autour de lui (courbe lissée, lisible).
  const points = [];
  for (let hz = 20; hz <= 20000; hz *= Math.pow(2, 1 / 6)) {
    const lo = hz / Math.pow(2, 1 / 6), hi = Math.min(sampleRate / 2, hz * Math.pow(2, 1 / 6));
    if (lo >= sampleRate / 2) break;
    points.push({ hz, mid: db(sum(midPower, lo, hi)), side: db(sum(sidePower, lo, hi)) });
  }
  const bands = BANDS.map(([id, lo, hi]) => ({ id, mid: db(sum(midPower, lo, Math.min(hi, sampleRate / 2))), side: db(sum(sidePower, lo, Math.min(hi, sampleRate / 2))) }));

  // Corrélation entre les deux canaux, sur tout le morceau et sous 120 Hz (filtre simple à un pôle).
  let lr = 0, ll = 0, rr = 0, lowLr = 0, lowLl = 0, lowRr = 0, fl = 0, fr = 0;
  const a = 1 - Math.exp(-2 * Math.PI * 120 / sampleRate);
  for (let i = 0; i < n; i++) {
    const l = left[i], r = right[i];
    lr += l * r; ll += l * l; rr += r * r;
    fl += a * (l - fl); fr += a * (r - fr);
    lowLr += fl * fr; lowLl += fl * fl; lowRr += fr * fr;
  }
  // un canal muet face à un canal qui joue : rien en commun (0) ; deux canaux muets : mono (1)
  const corr = (xy, xx, yy) => (xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : xx === yy ? 1 : 0);
  return { points, bands, correlation: corr(lr, ll, rr), lowCorrelation: corr(lowLr, lowLl, lowRr) };
}

if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.onmessage = (event) => {
    try { self.postMessage(analyse(event.data)); } catch { self.postMessage({ error: "L'analyse a échoué sur ce fichier." }); }
  };
}
if (typeof module !== "undefined") module.exports = { analyse, BANDS };
