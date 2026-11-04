// Paroles automatiques pour ONIRIQUE CUT et CLOUD : Whisper (OpenAI, licence MIT) via Transformers.js, avec le moment de
// chaque mot. Tourne dans ce Web Worker (module), sur la carte graphique (WebGPU) ou le processeur. Rien ne quitte le
// navigateur : seul le modèle (~760 Mo sur carte graphique) se télécharge, une fois, puis reste dans le cache du navigateur.
//
//   postMessage({ audio, guide, language })  (mono, 16 000 Hz ; guide : la voix isolée, pour savoir où l'on chante)
//     →  { type: "progress", phase: "download" | "load" | "transcribe", value: 0…1 }  (load : le modèle est lu depuis l'appareil)
//     →  { type: "done", device, words: [{ text, start, end }] }   ou   { type: "error", message }
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

// Sur la carte graphique : Whisper « large-v3-turbo » (bien plus juste en français, ~760 Mo) ; sur le processeur, « small »
// (~250 Mo, plus rapide à faire tourner). Versions figées des modèles.
const GPU = { model: "onnx-community/whisper-large-v3-turbo_timestamped", revision: "b3f77bf9a8c4d5ea3415827033d1ffea7955fd9a",
  device: "webgpu", dtype: { encoder_model: "q4", decoder_model_merged: "q4" } };
const CPU = { model: "onnx-community/whisper-small_timestamped", revision: "65caa70f294b46e1c33ff820aae6b16d048ab818", device: "wasm", dtype: "q8" };
env.allowLocalModels = false;
// Le modèle se garde dans les fichiers du navigateur (OPFS) : le cache web refuse les fichiers de plus de ~200 Mo, et le gros
// fichier du modèle se retéléchargeait à chaque fois. Lu depuis le disque, il ne passe pas non plus par une copie en mémoire.
const hash = (x) => { let h = 2166136261; for (const ch of x) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };
const fileName = (key) => { const k = String(key && key.url ? key.url : key); return hash(k) + "-" + k.split("/").pop().replace(/[^\w.-]/g, "_").slice(-80); };
const folder = () => navigator.storage.getDirectory().then((root) => root.getDirectoryHandle("whisper", { create: true }));
const onDisk = new Set(); // les fichiers du modèle lus depuis l'appareil : leur « progression » n'est pas un téléchargement
const opfsCache = {
  async match(key) {
    try {
      const file = await (await (await folder()).getFileHandle(fileName(key))).getFile();
      if (!file.size) return undefined;
      onDisk.add(String(key && key.url ? key.url : key).split("/").pop());
      return new Response(file, { headers: { "content-length": String(file.size) } });
    }
    catch { return undefined; }
  },
  async put(key, response) {
    // Une copie : la réponse elle-même sert encore au chargement du modèle.
    try { const copy = response.clone(), w = await (await (await folder()).getFileHandle(fileName(key), { create: true })).createWritable(); await copy.body.pipeTo(w); }
    catch { /* pas de place : il se retéléchargera la prochaine fois */ }
  },
};
if (self.navigator.storage && self.navigator.storage.getDirectory) { env.useBrowserCache = false; env.useCustomCache = true; env.customCache = opfsCache; }

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
    // Seuls les fichiers du modèle (.onnx) comptent : le moteur, lui, vient du cache ordinaire du navigateur.
    const fetching = [...files.keys()].some((f) => /\.onnx/.test(f) && !onDisk.has(String(f).split("/").pop()));
    post({ type: "progress", phase: fetching ? "download" : "load", value: loaded / total });
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
    if (c.timestamp[0] >= (to - from) / RATE) continue; // après la fin de ce qu'on lui a fait écouter : inventé
    const start = from / RATE + c.timestamp[0], end = from / RATE + Math.min((to - from) / RATE, c.timestamp[1] ?? c.timestamp[0]);
    if (words.length && !/^\s/.test(c.text)) { const w = words.at(-1); w.text += c.text.trim(); w.end = end; }
    else words.push({ text: c.text.trim(), start, end });
  }
  return { words, invented: INVENTED.test(r.text || ""), seconds: (to - from) / RATE };
}

self.onmessage = async ({ data }) => {
  const post = (message) => self.postMessage(message);
  try {
    const asr = await transcriber(post), language = data.language || "french", audio = data.audio, list = pieces(data.guide || audio), words = [];
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
