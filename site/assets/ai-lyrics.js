// Les paroles écrites et calées mot par mot par une IA, pour ONIRIQUE CUT et ONIRIQUE CLOUD : la voix est d'abord isolée
// (Demucs, assets/demucs-worker.js), puis Whisper l'écoute (assets/whisper-worker.js). Tout tourne dans le navigateur.
//
//   const lrc = await transcribe(audioBuffer, (message) => …)          // le morceau entier : la voix est isolée ici
//   const lrc = await transcribe(vocalsBuffer, status, { isolated: true })
//   → paroles LRC mot par mot : « [01:04.20] <01:04.20>mot <01:04.55>mot … », une ligne par phrase ; "" si rien n'est chanté

const pct = (x) => Math.round(x * 100) + " %";
const stamp = (x) => { const cs = Math.round(x * 100); return String(Math.floor(cs / 6000)).padStart(2, "0") + ":" + ((cs % 6000) / 100).toFixed(2).padStart(5, "0"); };

/** Des mots datés en LRC mot par mot : une ligne par phrase (un silence, une ponctuation finale, une majuscule de début
 *  de phrase, ou 10 mots au plus). */
export function wordsToLrc(words) {
  const lines = [];
  let line = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const sentence = line.length >= 2 && /^\p{Lu}/u.test(w.text) && !/^(I|Ok|OK)$/.test(w.text);
    if (line.length && (w.start - prev.end > .6 || line.length >= 10 || sentence || /[.!?…]$/.test(prev.text))) { lines.push(line); line = []; }
    line.push(w);
  });
  if (line.length) lines.push(line);
  return lines.map((l) => "[" + stamp(l[0].start) + "] " + l.map((w) => "<" + stamp(w.start) + ">" + w.text).join(" ")).join("\n");
}

const norm = (w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
/** Proches à l'écrit : identiques, ou au plus un tiers de lettres différentes (« hive » / « vie »). */
function close(a, b) {
  if (a === b) return 2;
  if (!a || !b || Math.abs(a.length - b.length) > Math.max(a.length, b.length) / 2) return -1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] <= Math.max(a.length, b.length) / 3 ? 1 : -1;
}

/** Cale des paroles déjà écrites sur les mots entendus par l'IA : le texte écrit est gardé tel quel, l'IA ne donne que le
 *  moment de chaque mot. Alignement mot à mot (Needleman-Wunsch) ; un mot écrit que l'IA n'a pas reconnu prend un temps
 *  réparti entre ses voisins reconnus. Rend du LRC mot par mot, une ligne par ligne écrite. */
export function alignLyrics(text, heard) {
  const lines = text.split("\n").map((l) => l.replace(/^\s*\[[^\]]*\]\s*/, "").replace(/<[^>]*>\s*/g, "").trim()).filter(Boolean);
  const written = lines.flatMap((l, line) => l.split(/\s+/).map((t) => ({ text: t, line, key: norm(t.replace(/\*\*/g, "")), at: null })));
  const n = written.length, m = heard.length, keys = heard.map((w) => norm(w.text));
  if (!n || !m) return "";
  // Le meilleur alignement : +2 mot identique, +1 mot proche, −1 mot différent ou sauté.
  const score = Array.from({ length: n + 1 }, (_, i) => Float32Array.from({ length: m + 1 }, (_, j) => -(i + j)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    score[i][j] = Math.max(score[i - 1][j - 1] + close(written[i - 1].key, keys[j - 1]), score[i - 1][j] - 1, score[i][j - 1] - 1);
  }
  for (let i = n, j = m; i > 0 && j > 0;) {
    const s = close(written[i - 1].key, keys[j - 1]);
    if (score[i][j] === score[i - 1][j - 1] + s) { if (s > 0) written[i - 1].at = heard[j - 1].start; i--; j--; }
    else if (score[i][j] === score[i - 1][j] - 1) i--;
    else j--;
  }
  // Les mots non reconnus : entre le mot reconnu d'avant et celui d'après, à intervalles égaux.
  for (let i = 0; i < n; i++) {
    if (written[i].at !== null) continue;
    let a = i - 1, b = i + 1;
    while (a >= 0 && written[a].at === null) a--;
    while (b < n && written[b].at === null) b++;
    const from = a >= 0 ? written[a].at : null, to = b < n ? written[b].at : null;
    if (from !== null && to !== null) for (let k = a + 1; k < b; k++) written[k].at = from + (to - from) * (k - a) / (b - a);
    else if (from !== null) for (let k = a + 1; k < b; k++) written[k].at = from + .35 * (k - a);
    else if (to !== null) for (let k = a + 1; k < b; k++) written[k].at = Math.max(0, to - .35 * (b - k));
    else return "";
  }
  return lines.map((_, li) => { const ws = written.filter((w) => w.line === li); return "[" + stamp(ws[0].at) + "] " + ws.map((w) => "<" + stamp(w.at) + ">" + w.text).join(" "); }).join("\n");
}

/** Un AudioBuffer rééchantillonné (channels voies, rate Hz), en Float32Array par voie. */
async function resample(buffer, rate, channels) {
  const off = new OfflineAudioContext(channels, Math.ceil(buffer.duration * rate), rate), src = off.createBufferSource();
  src.buffer = buffer; src.connect(off.destination); src.start();
  const r = await off.startRendering();
  return Array.from({ length: channels }, (_, c) => r.getChannelData(c).slice());
}

/** Fait tourner un worker (module) une fois : progress reçoit ses messages de progression. */
function runWorker(url, message, transfer, progress) {
  const worker = new Worker(url, { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => (data.type === "done" ? resolve(data) : data.type === "error" ? reject(new Error(data.message)) : progress(data));
    worker.onerror = (event) => reject(new Error(event.message || "l'IA n'a pas pu démarrer"));
    worker.postMessage(message, transfer);
  }).finally(() => worker.terminate());
}

/** La voix seule du morceau (Demucs) ; null si l'IA de séparation ne peut pas tourner ici. */
export async function isolateVoice(buffer, status = () => {}) {
  try {
    const [L, R] = await resample(buffer, 44100, 2);
    const out = await runWorker(new URL("demucs-worker.js", import.meta.url), { L, R }, [L.buffer, R.buffer], (d) => status(d.phase === "download"
      ? "Téléchargement de l'IA de séparation (172 Mo, une seule fois)… " + pct(d.value) : "Séparation de la voix… " + pct(d.value)));
    const [l, r] = out.parts.vocals, voice = new AudioBuffer({ length: l.length, numberOfChannels: 2, sampleRate: 44100 });
    voice.copyToChannel(l, 0); voice.copyToChannel(r, 1);
    return voice;
  } catch { return null; }
}

/** buffer : le morceau tel quel. voice : sa voix isolée, si on l'a déjà (sinon elle est isolée ici).
 *  written : des paroles déjà écrites (avec ou sans temps) à caler ; sinon l'IA les écrit elle-même.
 *  La voix isolée ne sert qu'à repérer où l'on chante : Whisper écoute le morceau tel quel, qu'il comprend mieux (mesuré sur
 *  deux titres de euhZ : 44,7 et 37,7 % de mots faux, contre 50,7 et 44,4 % sur la voix isolée, abîmée par la séparation). */
export async function transcribe(buffer, status = () => {}, { voice = null, language = "french", written = "" } = {}) {
  const guideVoice = voice || (await isolateVoice(buffer, status)) || buffer;
  const [audio] = await resample(buffer, 16000, 1), [guide] = await resample(guideVoice, 16000, 1);
  const out = await runWorker(new URL("whisper-worker.js", import.meta.url), { audio, guide, language }, [audio.buffer, guide.buffer], (d) => status(d.phase === "download"
    ? "Téléchargement de l'IA des paroles (environ 760 Mo, une seule fois sur cet appareil)… " + pct(d.value) : "L'IA écoute les paroles…" + (d.value ? " " + pct(d.value) : "")));
  if (written.trim() && out.words.length) {
    const lrc = alignLyrics(written, out.words);
    return { lrc, words: lrc ? (lrc.match(/</g) || []).length : 0, device: out.device, aligned: true };
  }
  return { lrc: wordsToLrc(out.words), words: out.words.length, device: out.device, aligned: false };
}
