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

export async function transcribe(buffer, status = () => {}, { isolated = false, language = "french" } = {}) {
  const voice = isolated ? buffer : (await isolateVoice(buffer, status)) || buffer; // sans séparation : le morceau entier
  const [audio] = await resample(voice, 16000, 1);
  const out = await runWorker(new URL("whisper-worker.js", import.meta.url), { audio, language }, [audio.buffer], (d) => status(d.phase === "download"
    ? "Téléchargement de l'IA des paroles (environ 600 Mo, une seule fois sur cet appareil)… " + pct(d.value) : "L'IA écoute les paroles…" + (d.value ? " " + pct(d.value) : "")));
  return { lrc: wordsToLrc(out.words), words: out.words.length, device: out.device };
}
