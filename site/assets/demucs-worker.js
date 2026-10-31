// Séparation des pistes par IA pour ONIRIQUE CUT : Demucs v4 « htdemucs » (Meta, licence MIT), porté pour le navigateur
// par demucs-web (MIT). Tourne dans ce Web Worker (module), sur la carte graphique (WebGPU) ou, à défaut, sur le processeur
// (WASM, bien plus lent). Rien ne quitte le navigateur : seul le modèle (172 Mo) se télécharge, une fois, puis reste en cache.
//
//   postMessage({ L, R })  (stéréo, 44 100 Hz)
//     →  { type: "progress", phase: "download" | "separate", value: 0…1 } (plusieurs fois)
//     →  { type: "done", device: "gpu" | "cpu", parts: { drums, bass, other, vocals } }  (chaque piste : [gauche, droite])
//     ou { type: "error", message }
import * as ort from "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort.webgpu.min.mjs";
import { DemucsProcessor } from "https://cdn.jsdelivr.net/npm/demucs-web@1.0.2/src/index.js";

// Le modèle à une version figée (commit Hugging Face) : il ne peut pas changer sous nos pieds.
const MODEL = "https://huggingface.co/timcsy/demucs-web-onnx/resolve/92e33df61cfc9eb820272aaa62d2ef6dcf4d950d/htdemucs_embedded.onnx";
const MODEL_BYTES = 180534758;
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/";
ort.env.wasm.numThreads = 1; // plusieurs fils demandent une page isolée (COOP/COEP), ce que le site n'est pas

/** Le modèle : depuis le cache du navigateur, sinon téléchargé (avec sa progression) puis gardé. */
async function modelBytes(progress) {
  const cache = await caches.open("onirique-demucs").catch(() => null);
  const hit = cache && await cache.match(MODEL).catch(() => null);
  if (hit) return hit.arrayBuffer();
  const response = await fetch(MODEL);
  if (!response.ok || !response.body) throw new Error("Le modèle d'IA n'a pas pu être téléchargé.");
  const reader = response.body.getReader(), chunks = [];
  for (let got = 0; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    progress(Math.min(1, got / MODEL_BYTES));
  }
  const blob = new Blob(chunks);
  if (cache) await cache.put(MODEL, new Response(blob)).catch(() => {}); // pas de place : il se retéléchargera la prochaine fois
  return blob.arrayBuffer();
}

let processor = null, device = "cpu";
async function ready(post) {
  if (processor) return processor;
  const adapter = self.navigator.gpu ? await self.navigator.gpu.requestAdapter().catch(() => null) : null;
  device = adapter ? "gpu" : "cpu";
  const p = new DemucsProcessor({ ort, sessionOptions: { executionProviders: adapter ? ["webgpu", "wasm"] : ["wasm"] } });
  await p.loadModel(await modelBytes((value) => post({ type: "progress", phase: "download", value })));
  return (processor = p);
}

self.onmessage = async ({ data }) => {
  const post = (message, transfer) => self.postMessage(message, transfer || []);
  try {
    const p = await ready(post);
    p.onProgress = ({ progress }) => post({ type: "progress", phase: "separate", value: progress });
    post({ type: "progress", phase: "separate", value: 0 });
    const out = await p.separate(data.L, data.R);
    const parts = Object.fromEntries(Object.entries(out).map(([name, t]) => [name, [t.left, t.right]]));
    post({ type: "done", device, parts }, Object.values(parts).flatMap((pair) => pair.map((a) => a.buffer)));
  } catch (error) {
    post({ type: "error", message: (error && error.message) || String(error) });
  }
};
