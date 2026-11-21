// Calage forcé des paroles écrites sur la voix (ONIRIQUE CUT et CLOUD) : une IA de reconnaissance des lettres (wav2vec2,
// assets/ctc-worker.js) donne, toutes les 20 ms, la probabilité de chaque lettre ; ce module cherche le chemin le plus
// probable qui prononce le texte écrit dans l'ordre (Viterbi CTC). Chaque mot écrit reçoit ainsi le moment où sa première
// lettre est chantée, sans que l'IA ait besoin de « comprendre » les paroles.
//
// Réglages mesurés sur les titres du CLOUD calés à la main mot par mot (8 titres, 1 958 mots) et ligne par ligne (42 titres) :
// erreur médiane 60 ms, 73 % des mots à moins de 100 ms, 95 % à moins de 250 ms (contre 130 ms et 37 % / 77 % en calant
// sur les mots entendus par Whisper).

/** Le vocabulaire du modèle (jonatasgrosman/wav2vec2-large-xlsr-53-french) : 0 = « rien », 4 = frontière de mot. */
export const VOCAB = { "'": 5, a: 7, b: 8, c: 9, d: 10, e: 11, f: 12, g: 13, h: 14, i: 15, j: 16, k: 17, l: 18, m: 19, n: 20, o: 21, p: 22,
  q: 23, r: 24, s: 25, t: 26, u: 27, v: 28, w: 29, x: 30, y: 31, z: 32, "à": 33, "á": 34, "â": 35, "ä": 36, "ç": 37, "è": 38, "é": 39, "ê": 40,
  "ë": 41, "í": 42, "î": 43, "ï": 44, "ñ": 45, "ó": 46, "ô": 47, "ö": 48, "ù": 49, "ú": 50, "û": 51, "ü": 52, "ć": 53, "č": 54, "ō": 55, "œ": 56,
  "š": 57, "ș": 58 };
export const LETTERS = 59, FRAME = 0.02; // 59 sorties, une image toutes les 20 ms
const BLANK = 0, SEP = 4, APOS = VOCAB["'"];

// Pénalités (en log-probabilité) : chant non écrit entre deux mots, entre deux lignes, avant la première et après la
// dernière ; silence à l'intérieur d'un mot (par image) ; ligne écrite non chantée et ad-lib entre parenthèses (par lettre).
// off : le moment où l'IA « voit » la première lettre arrive 30 ms après le début du mot.
export const SETTINGS = { word: 10, line: 4, edge: 1, inside: 0.2, skipLine: 6, skipParen: 3, off: -0.03 };

/** Les lettres prononçables d'un mot écrit, en numéros du vocabulaire ([] pour « & », « 2 », « - »…). */
export function lettersOf(word) {
  const out = [];
  for (const ch of word.replace(/\*\*/g, "").replace(/[’ʼ`´]/g, "'").toLowerCase().normalize("NFC")) {
    if (VOCAB[ch] !== undefined) out.push(VOCAB[ch]);
    else if (ch === "æ") out.push(VOCAB.a, VOCAB.e);
    else for (const b of ch.normalize("NFD").replace(/[̀-ͯ]/g, "")) if (VOCAB[b] !== undefined && b !== "'") out.push(VOCAB[b]);
  }
  while (out[0] === APOS) out.shift();
  while (out.at(-1) === APOS) out.pop();
  return out;
}

/** Viterbi CTC. lp : log-probabilités (T × LETTERS), words : lettres de chaque mot, lineEnds : le mot finit-il sa ligne,
 *  optional : groupes de mots [premier, dernier, pénalité] qu'on peut ne pas trouver dans le son.
 *  → pour chaque mot { start, end } en images, ou null (mot sans lettre, ou sauté). */
export function viterbi(lp, words, lineEnds, optional, s = SETTINGS) {
  const T = Math.floor(lp.length / LETTERS);
  // États : séparateur, puis pour chaque mot « l1 rien l2 rien … ln », puis séparateur. Un séparateur absorbe le silence,
  // la frontière de mot, ou du chant qui n'est pas dans le texte (avec pénalité).
  const type = [], tok = [], jump = [], wordOf = [], sepPen = [], first = [], last = [];
  const push = (ty, id, j, w, pen = 0) => { type.push(ty); tok.push(id); jump.push(j); wordOf.push(w); sepPen.push(pen); };
  push(2, SEP, 0, -1, s.edge);
  let prev = -1;
  words.forEach((ids, w) => {
    if (!ids.length) { first[w] = last[w] = -1; return; }
    first[w] = type.length;
    ids.forEach((id, k) => {
      if (k) push(0, BLANK, 0, w);
      const before = k ? ids[k - 1] : prev;
      push(1, id, before >= 0 && before !== id ? 1 : 0, w); // deux lettres identiques de suite demandent un « rien » entre elles
    });
    last[w] = type.length - 1;
    prev = ids.at(-1);
    push(2, SEP, 0, -1, lineEnds[w] ? s.line : s.word);
  });
  const S = type.length;
  sepPen[S - 1] = s.edge;
  if (S < 2 || T < 1) return words.map(() => null);
  // Sauts : d'un séparateur à celui d'après le groupe (au plus deux sauts arrivent au même séparateur).
  const fromA = new Int32Array(S).fill(-1), fromB = new Int32Array(S).fill(-1), penA = new Float32Array(S), penB = new Float32Array(S);
  for (const [w0, w1, pen] of optional) {
    let a = w0, b = w1;
    while (a <= w1 && first[a] < 0) a++;
    while (b >= w0 && first[b] < 0) b--;
    if (a > b) continue;
    const from = first[a] - 1, to = last[b] + 1;
    if (fromA[to] < 0) { fromA[to] = from; penA[to] = pen; } else if (fromB[to] < 0) { fromB[to] = from; penB[to] = pen; }
  }
  const best = new Float32Array(T); // la lettre la plus probable de chaque image : ce que coûte du chant non écrit
  for (let t = 0; t < T; t++) { let m = -Infinity; for (let v = 0; v < LETTERS; v++) if (v !== BLANK && v !== SEP && lp[t * LETTERS + v] > m) m = lp[t * LETTERS + v]; best[t] = m; }
  const emit = (t, q) => {
    const o = t * LETTERS;
    if (type[q] === 1) return lp[o + tok[q]];
    if (type[q] === 0) return lp[o + BLANK] - s.inside;
    return Math.max(lp[o + BLANK], lp[o + SEP], best[t] - sepPen[q]);
  };
  const NEG = -1e30, back = new Uint8Array(T * S);
  let before = new Float32Array(S).fill(NEG), now = new Float32Array(S);
  before[0] = emit(0, 0); before[1] = emit(0, 1);
  for (let t = 1; t < T; t++) {
    const row = t * S;
    for (let q = 0; q < S; q++) {
      let v = before[q], k = 0;
      if (q >= 1 && before[q - 1] > v) { v = before[q - 1]; k = 1; }
      if (q >= 2 && jump[q] && before[q - 2] > v) { v = before[q - 2]; k = 2; }
      if (fromA[q] >= 0 && before[fromA[q]] - penA[q] > v) { v = before[fromA[q]] - penA[q]; k = 3; }
      if (fromB[q] >= 0 && before[fromB[q]] - penB[q] > v) { v = before[fromB[q]] - penB[q]; k = 4; }
      now[q] = v <= NEG ? NEG : v + emit(t, q);
      back[row + q] = k;
    }
    [before, now] = [now, before];
  }
  const spans = words.map(() => null);
  for (let t = T - 1, q = before[S - 1] >= before[S - 2] ? S - 1 : S - 2; t >= 0; t--) {
    const w = wordOf[q];
    if (w >= 0) { if (!spans[w]) spans[w] = { start: t, end: t }; else spans[w].start = t; }
    const k = back[t * S + q];
    q = k === 3 ? fromA[q] : k === 4 ? fromB[q] : q - k;
  }
  return spans;
}

/** Combien d'octets demande le calage (le chemin gardé en mémoire) : pour renoncer avant de saturer l'appareil. */
export const cost = (frames, lines) => frames * (2 * lines.flat().reduce((n, w) => n + lettersOf(w).length + 1, 0) + 1);

/** lines : les mots écrits, ligne par ligne → pour chaque mot { at, end } en secondes, dans l'ordre. Les mots sans lettre
 *  ou non trouvés prennent place entre leurs voisins. */
export function alignLines(lp, lines, s = SETTINGS) {
  const words = lines.flat(), ids = words.map(lettersOf), lineEnds = lines.flatMap((l) => l.map((_, i) => i === l.length - 1)), optional = [];
  let k = 0;
  for (const l of lines) {
    const n = (a, b) => l.slice(a, b + 1).reduce((sum, w) => sum + lettersOf(w).length, 0);
    optional.push([k, k + l.length - 1, s.skipLine * n(0, l.length - 1)]);
    // Un ad-lib entre parenthèses, « (yeah) », « (elle est pas nia) » : souvent une voix de fond, parfois pas chanté.
    for (let i = 0; i < l.length; i++) if (l[i].startsWith("(")) {
      let j = i;
      while (j < l.length - 1 && !/\)[^\p{L}\p{N}]*$/u.test(l[j])) j++;
      optional.push([k + i, k + j, s.skipParen * n(i, j)]);
      i = j;
    }
    k += l.length;
  }
  const spans = viterbi(lp, ids, lineEnds, optional, s);
  const out = spans.map((sp) => (sp ? { at: Math.max(0, sp.start * FRAME + s.off), end: (sp.end + 1) * FRAME } : { at: null, end: null }));
  for (let i = 0; i < out.length; i++) {
    if (out[i].at !== null) continue;
    let b = i;
    while (b < out.length && out[b].at === null) b++;
    const A = i > 0 ? out[i - 1].end : null, B = b < out.length ? out[b].at : null;
    for (let j = i; j < b; j++) {
      out[j].at = A !== null && B !== null ? A + (B - A) * (j - i) / (b - i) : A !== null ? A + .3 * (j - i) : B !== null ? Math.max(0, B - .3 * (b - j)) : 0;
      out[j].end = out[j].at;
    }
    i = b - 1;
  }
  return out;
}
