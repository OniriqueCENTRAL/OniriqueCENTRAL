// Les empreintes de voix pour assets/voices.js : WeSpeaker ResNet34 (entraîné sur VoxCeleb, licence CC BY 4.0, export ONNX
// onnx-community) via Transformers.js, sur le processeur. Le modèle (26 Mo) se télécharge une fois, puis reste dans le cache
// du navigateur. Tourne dans ce Web Worker (module) ; rien ne quitte le navigateur.
//
//   postMessage({ audio, spans })  (mono, 16 000 Hz ; spans : [[début, fin], …] en secondes)
//     →  { type: "progress", phase: "download" | "listen", value: 0…1 }
//     →  { type: "done", embeddings: [Float32Array(256) de norme 1, …] }   ou   { type: "error", message }
import { AutoProcessor, AutoModel, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

// Le modèle à une version figée (commit Hugging Face) : il ne peut pas changer sous nos pieds.
const MODEL = "onnx-community/wespeaker-voxceleb-resnet34-LM", revision = "6a61a1833ff2583aabeba044f5c8221f00b67ceb";
env.allowLocalModels = false;

self.onmessage = async ({ data: { audio, spans } }) => {
  try {
    const progress_callback = (p) => { if (p.status === "progress" && p.total > 1e6) self.postMessage({ type: "progress", phase: "download", value: p.progress / 100 }); };
    const processor = await AutoProcessor.from_pretrained(MODEL, { revision });
    const model = await AutoModel.from_pretrained(MODEL, { revision, dtype: "fp32", device: "wasm", progress_callback });
    const embeddings = [];
    for (const [k, [a, b]] of spans.entries()) {
      // Une demi-seconde au moins, autour du milieu de la phrase : plus court, l'empreinte ne veut plus rien dire.
      const mid = (a + b) / 2, half = Math.max(.25, (b - a) / 2);
      const part = audio.subarray(Math.max(0, Math.floor((mid - half) * 16000)), Math.min(audio.length, Math.ceil((mid + half) * 16000)));
      const { last_hidden_state: e } = await model(await processor(part));
      const v = Float32Array.from(e.data), norm = Math.hypot(...v) || 1;
      embeddings.push(v.map((x) => x / norm));
      self.postMessage({ type: "progress", phase: "listen", value: (k + 1) / spans.length });
    }
    self.postMessage({ type: "done", embeddings });
  } catch (error) {
    self.postMessage({ type: "error", message: String((error && error.message) || error) });
  }
};
