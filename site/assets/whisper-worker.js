// Paroles automatiques pour ONIRIQUE CUT et CLOUD : Whisper (OpenAI, licence MIT) via Transformers.js, avec le moment de
// chaque mot. Tourne dans ce Web Worker (module), sur la carte graphique (WebGPU) ou le processeur. Rien ne quitte le
// navigateur : seul le modèle (~760 Mo sur carte graphique) se télécharge, une fois, puis reste dans le cache du navigateur.
//
//   postMessage({ audio, language })  (mono, 16 000 Hz)
//     →  { type: "progress", phase: "download" | "transcribe", value: 0…1 }
//     →  { type: "done", device, words: [{ text, start, end }] }   ou   { type: "error", message }
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

// Sur la carte graphique : Whisper « large-v3-turbo » (bien plus juste en français, ~760 Mo) ; sur le processeur, « small »
// (~250 Mo, plus rapide à faire tourner). Versions figées des modèles.
const GPU = { model: "onnx-community/whisper-large-v3-turbo_timestamped", revision: "b3f77bf9a8c4d5ea3415827033d1ffea7955fd9a",
  device: "webgpu", dtype: { encoder_model: "q4", decoder_model_merged: "q4" } };
const CPU = { model: "onnx-community/whisper-small_timestamped", revision: "65caa70f294b46e1c33ff820aae6b16d048ab818", device: "wasm", dtype: "q8" };
env.allowLocalModels = false;

let ready = null, device = "cpu";
async function transcriber(post) {
  if (ready) return ready;
  const adapter = self.navigator.gpu ? await self.navigator.gpu.requestAdapter().catch(() => null) : null;
  device = adapter ? "gpu" : "cpu";
  // Le téléchargement : plusieurs fichiers, dont on suit la somme.
  const files = new Map();
  const progress_callback = (x) => {
    if (x.status !== "progress" || !x.total) return;
    files.set(x.file, [x.loaded, x.total]);
    let loaded = 0, total = 0;
    for (const [l, t] of files.values()) { loaded += l; total += t; }
    post({ type: "progress", phase: "download", value: loaded / total });
  };
  const { model, ...options } = adapter ? GPU : CPU;
  ready = pipeline("automatic-speech-recognition", model, { progress_callback, ...options });
  ready.catch(() => { ready = null; });
  return ready;
}

// Ce que Whisper invente quand il décroche (il a appris sur des sous-titres de vidéos) : un morceau qui sort ça est raté.
const INVENTED = /sous-?titr|amara\.org|merci d'avoir regard|abonnez|n'oubliez pas de vous abonner|j[ée]r[ée]my diaz|st' ?501|radio-canada|cc by|mais je vous en prie/i;
const RATE = 16000, FRAME = RATE / 10; // l'énergie de la voix, par dixième de seconde

/** Les morceaux de voix à écouter un par un (≤ 25 s), coupés dans les respirations ; les silences sont sautés. */
function pieces(audio) {
  const n = Math.floor(audio.length / FRAME), rms = new Float32Array(n);
  for (let f = 0; f < n; f++) { let s = 0; for (let i = f * FRAME; i < (f + 1) * FRAME; i++) s += audio[i] * audio[i]; rms[f] = Math.sqrt(s / FRAME); }
  const loud = [...rms].sort((a, b) => a - b)[Math.floor(n * .95)] || 0, voiced = (f) => rms[f] > loud * .08;
  const out = [];
  for (let f = 0; f < n;) {
    while (f < n && !voiced(f)) f++;
    if (f >= n) break;
    // Jusqu'à 25 s au plus : on coupe au point le plus calme entre 12 et 25 s, ou au premier long silence.
    let end = Math.min(n, f + 250), quiet = 0;
    for (let g = f; g < end; g++) { quiet = voiced(g) ? 0 : quiet + 1; if (quiet >= 15) { end = g - 10; break; } }
    if (end - f >= 250 && end < n) { let best = f + 120; for (let g = f + 120; g < f + 250; g++) if (rms[g] < rms[best]) best = g; end = best; }
    out.push([Math.max(0, f - 3) * FRAME, Math.min(n, end + 3) * FRAME]);
    f = end + 1;
  }
  return out;
}

/** Les mots d'un morceau, datés depuis le début du son ; un mot sans espace devant continue le précédent (« j » + « 'ai »). */
async function listen(asr, audio, from, to, language) {
  const r = await asr(audio.subarray(from, to), { language, task: "transcribe", return_timestamps: "word", no_repeat_ngram_size: 6 });
  const words = [];
  for (const c of r.chunks || []) {
    if (!Number.isFinite(c.timestamp[0]) || !c.text.trim()) continue;
    const start = from / RATE + c.timestamp[0], end = from / RATE + (c.timestamp[1] ?? c.timestamp[0]);
    if (words.length && !/^\s/.test(c.text)) { const w = words.at(-1); w.text += c.text.trim(); w.end = end; }
    else words.push({ text: c.text.trim(), start, end });
  }
  return { words, invented: INVENTED.test(r.text || ""), seconds: (to - from) / RATE };
}

self.onmessage = async ({ data }) => {
  const post = (message) => self.postMessage(message);
  try {
    const asr = await transcriber(post), language = data.language || "french", audio = data.audio, list = pieces(audio), words = [];
    post({ type: "progress", phase: "transcribe", value: 0 });
    for (const [k, [from, to]] of list.entries()) {
      let got = await listen(asr, audio, from, to, language);
      // Raté (phrase inventée, ou bien trop peu de mots pour autant de voix) : on réécoute en deux moitiés.
      if (got.invented || got.words.length < got.seconds * .8) {
        const mid = from + Math.floor((to - from) / 2), halves = [await listen(asr, audio, from, mid, language), await listen(asr, audio, mid, to, language)];
        const better = halves.filter((h) => !h.invented).flatMap((h) => h.words);
        if (better.length > (got.invented ? 0 : got.words.length)) got = { words: better, invented: false };
      }
      if (!got.invented) words.push(...got.words);
      post({ type: "progress", phase: "transcribe", value: (k + 1) / list.length });
    }
    post({ type: "done", device, words });
  } catch (error) {
    post({ type: "error", message: (error && error.message) || String(error) });
  }
};
