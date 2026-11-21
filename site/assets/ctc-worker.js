// Calage des paroles écrites pour ONIRIQUE CUT et CLOUD : wav2vec2 français (jonatasgrosman/wav2vec2-large-xlsr-53-french,
// licence Apache 2.0, export ONNX XDcobra) donne la probabilité de chaque lettre toutes les 20 ms, puis assets/ctc-align.js
// y cale le texte écrit. Tourne dans ce Web Worker (module), sur la carte graphique (WebGPU, demi-précision). Rien ne quitte
// le navigateur : seul le modèle (632 Mo) se télécharge, une fois, puis reste dans les fichiers du navigateur.
//
//   postMessage({ audio, lines })  (voix isolée, mono, 16 000 Hz ; lines : les mots écrits, ligne par ligne)
//     →  { type: "progress", phase: "download" | "load" | "listen" | "align", value: 0…1 }
//     →  { type: "done", device: "gpu", words: [{ at, end }] }   ou   { type: "error", message }
import * as ort from "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort.webgpu.min.mjs";
import { alignLines, cost, LETTERS } from "./ctc-align.js?v=1";

// Le modèle à une version figée (commit Hugging Face) : il ne peut pas changer sous nos pieds.
const MODEL = "https://huggingface.co/XDcobra/wav2vec2-large-xlsr-53-french-ONNX/resolve/3c0b587393628693a0188aef25d29d6212dc8130/onnx/model_fp16.onnx";
const MODEL_BYTES = 631559938, FILE = "wav2vec2-fr-3c0b587-fp16.onnx";
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/";
ort.env.wasm.numThreads = 1;
const RATE = 16000, WIN = 20 * RATE, HOP = 16 * RATE, MARGIN = 100; // fenêtres de 20 s, 2 s de recouvrement de chaque côté

/** Le modèle : depuis les fichiers du navigateur (OPFS : le cache web refuse les gros fichiers), sinon téléchargé et gardé. */
async function modelBytes(post) {
  let dir = null;
  try { dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("ctc", { create: true }); } catch { /* pas d'OPFS : en mémoire */ }
  if (dir) try {
    const file = await (await dir.getFileHandle(FILE)).getFile();
    if (file.size === MODEL_BYTES) { post({ type: "progress", phase: "load", value: 1 }); return await file.arrayBuffer(); }
  } catch { /* pas encore téléchargé */ }
  const response = await fetch(MODEL);
  if (!response.ok || !response.body) throw new Error("Le modèle de calage n'a pas pu être téléchargé.");
  // Rempli au fil du téléchargement : une seule copie du modèle en mémoire.
  const reader = response.body.getReader(), bytes = new Uint8Array(MODEL_BYTES);
  let writer = null, got = 0;
  if (dir) try { writer = await (await dir.getFileHandle(FILE, { create: true })).createWritable(); } catch { writer = null; }
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > MODEL_BYTES) throw new Error("Le modèle de calage téléchargé n'est pas le bon.");
    bytes.set(value, got);
    got += value.length;
    if (writer) await writer.write(value).catch(() => { writer = null; }); // pas de place : il se retéléchargera la prochaine fois
    post({ type: "progress", phase: "download", value: got / MODEL_BYTES });
  }
  if (got !== MODEL_BYTES) { if (writer) await writer.abort().catch(() => {}); throw new Error("Le téléchargement du modèle de calage a été coupé."); }
  if (writer) await writer.close().catch(() => {});
  return bytes.buffer;
}

let session = null;
async function model(post) {
  if (session) return session;
  // Demi-précision sur la carte graphique seulement : sur le processeur, il faudrait plusieurs minutes par titre.
  const adapter = self.navigator.gpu ? await self.navigator.gpu.requestAdapter().catch(() => null) : null;
  if (!adapter || !adapter.features.has("shader-f16")) throw new Error("no-gpu");
  session = await ort.InferenceSession.create(await modelBytes(post), { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
  return session;
}

/** Log-probabilités des lettres (T × LETTERS), par fenêtres de 20 s normalisées comme à l'entraînement. */
async function letters(s, audio, post) {
  const rows = [];
  for (let start = 0; start < audio.length; start += HOP) {
    const end = Math.min(audio.length, start + WIN), last = end >= audio.length, piece = audio.slice(start, end);
    if (piece.length < 400) break;
    let mean = 0; for (const v of piece) mean += v; mean /= piece.length;
    let sq = 0; for (const v of piece) sq += (v - mean) ** 2;
    const sd = Math.sqrt(sq / piece.length + 1e-7);
    for (let i = 0; i < piece.length; i++) piece[i] = (piece[i] - mean) / sd;
    const out = await s.run({ input_values: new ort.Tensor("float32", piece, [1, piece.length]) });
    const [, T] = out.logits.dims, L = await out.logits.getData();
    out.logits.dispose?.();
    for (let t = start ? MARGIN : 0, stop = last ? T : Math.min(T, HOP / 320 + MARGIN); t < stop; t++) {
      let mx = -Infinity; for (let v = 0; v < LETTERS; v++) mx = Math.max(mx, L[t * LETTERS + v]);
      let sum = 0; for (let v = 0; v < LETTERS; v++) sum += Math.exp(L[t * LETTERS + v] - mx);
      const row = new Float32Array(LETTERS), lse = mx + Math.log(sum);
      for (let v = 0; v < LETTERS; v++) row[v] = L[t * LETTERS + v] - lse;
      rows.push(row);
    }
    post({ type: "progress", phase: "listen", value: Math.min(1, end / audio.length) });
    if (last) break;
  }
  const lp = new Float32Array(rows.length * LETTERS);
  rows.forEach((r, i) => lp.set(r, i * LETTERS));
  return lp;
}

/** La fin d'un mot : la dernière lettre vue, prolongée tant que la voix sonne encore (une note tenue) avant le mot suivant. */
function holdEnds(words, audio) {
  const F = RATE / 50, n = Math.floor(audio.length / F), rms = new Float32Array(n);
  for (let f = 0; f < n; f++) { let q = 0; for (let i = f * F; i < (f + 1) * F; i++) q += audio[i] * audio[i]; rms[f] = Math.sqrt(q / F); }
  const loud = [...rms].sort((a, b) => a - b)[Math.floor(n * .95)] || 0;
  words.forEach((w, i) => {
    const next = words[i + 1] ? Math.round(words[i + 1].at * 50) : n;
    let f = Math.round(w.end * 50);
    while (f < next && f < n && rms[f] > loud * .1) f++;
    w.end = Math.max(w.end, f / 50);
  });
  return words;
}

self.onmessage = async ({ data }) => {
  const post = (message) => self.postMessage(message);
  try {
    const s = await model(post), lp = await letters(s, data.audio, post);
    if (cost(lp.length / LETTERS, data.lines) > 8e8) throw new Error("too-long"); // plus de 800 Mo de calcul : le calage par Whisper prend le relais
    post({ type: "progress", phase: "align", value: 0 });
    post({ type: "done", device: "gpu", words: holdEnds(alignLines(lp, data.lines), data.audio) });
  } catch (error) {
    post({ type: "error", message: (error && error.message) || String(error) });
  }
};
