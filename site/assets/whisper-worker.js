// Paroles automatiques pour ONIRIQUE CUT : Whisper « small » (OpenAI, licence MIT) via Transformers.js, avec le moment de
// chaque mot. Tourne dans ce Web Worker (module), sur la carte graphique (WebGPU) ou le processeur. Rien ne quitte le
// navigateur : seul le modèle (~600 Mo) se télécharge, une fois, puis reste dans le cache du navigateur.
//
//   postMessage({ audio, language })  (mono, 16 000 Hz)
//     →  { type: "progress", phase: "download" | "transcribe", value: 0…1 }
//     →  { type: "done", device, words: [{ text, start, end }] }   ou   { type: "error", message }
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

const MODEL = "onnx-community/whisper-small_timestamped";
const REVISION = "65caa70f294b46e1c33ff820aae6b16d048ab818"; // version figée du modèle
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
  const options = adapter
    // Encodeur en fp32 : en fp16 sur WebGPU, il ne sort que des mots vides.
    ? { device: "webgpu", dtype: { encoder_model: "fp32", decoder_model_merged: "q4" } }
    : { device: "wasm", dtype: "q8" };
  ready = pipeline("automatic-speech-recognition", MODEL, { revision: REVISION, progress_callback, ...options });
  ready.catch(() => { ready = null; });
  return ready;
}

self.onmessage = async ({ data }) => {
  const post = (message) => self.postMessage(message);
  try {
    const asr = await transcriber(post);
    post({ type: "progress", phase: "transcribe", value: 0 });
    // Par tranches de 30 s (ce que Whisper écoute d'un coup), qui se chevauchent un peu.
    const chunk = 30, stride = 5, total = Math.max(1, Math.ceil(data.audio.length / 16000 / (chunk - 2 * stride)));
    let done = 0;
    const result = await asr(data.audio, {
      language: data.language || "french", task: "transcribe", return_timestamps: "word", chunk_length_s: chunk, stride_length_s: stride,
      chunk_callback: () => post({ type: "progress", phase: "transcribe", value: Math.min(.99, ++done / total) }),
    });
    // Un morceau sans espace devant continue le mot d'avant (« j » + « 'ai » = « j'ai »).
    const words = [];
    for (const c of result.chunks || []) {
      const end = c.timestamp[1] ?? c.timestamp[0];
      if (!Number.isFinite(c.timestamp[0]) || !c.text.trim()) continue;
      if (words.length && !/^\s/.test(c.text)) { const w = words.at(-1); w.text += c.text.trim(); w.end = end; }
      else words.push({ text: c.text.trim(), start: c.timestamp[0], end });
    }
    post({ type: "done", device, words });
  } catch (error) {
    post({ type: "error", message: (error && error.message) || String(error) });
  }
};
