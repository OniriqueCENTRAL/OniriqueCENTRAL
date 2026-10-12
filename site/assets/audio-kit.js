// Ce que partagent les outils qui lisent un fichier audio : dépôt, décodage, écriture d'un WAV, téléchargement.
// Tout se passe dans le navigateur : aucun fichier n'est envoyé.
//
//   OniriqueAudio.dropZone(button, input, onFiles, { multiple })   dépôt n'importe où sur la page, ou clic sur la zone
//   OniriqueAudio.decode(file, { minRate })   →  AudioBuffer, à la fréquence du fichier (ou minRate si elle est plus basse)
//   OniriqueAudio.render(audio, { rate, channels, from, to })   →  AudioBuffer rééchantillonné / découpé
//   OniriqueAudio.wav(channels, sampleRate, bits)   →  Blob (16 et 24 bits entiers, 32 bits flottants)
//   OniriqueAudio.mp3(channels, sampleRate, kbps, onProgress)   →  Promise d'un Blob (encodé dans assets/mp3-worker.js)
//   OniriqueAudio.download(blob, name), .clock(seconds), .decimal(n, digits), .baseName(file)
window.OniriqueAudio = (() => {
  const decimal = (n, digits = 1) => n.toFixed(digits).replace(".", ",");
  const clock = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  const baseName = (file) => file.name.replace(/\.[^.]+$/, "");

  /** Fréquence d'échantillonnage écrite dans un fichier WAV, FLAC ou MP3 ; 0 si elle ne se lit pas. */
  function sourceRate(v) {
    const tag = (o, text) => o + text.length <= v.byteLength && [...text].every((c, i) => v.getUint8(o + i) === c.charCodeAt(0));
    const valid = (rate) => (rate >= 8000 && rate <= 192000 ? rate : 0);
    if (tag(0, "RIFF") && tag(8, "WAVE")) {
      for (let o = 12; o + 16 <= v.byteLength && o < 1e6;) {
        if (tag(o, "fmt ")) return valid(v.getUint32(o + 12, true));
        const size = v.getUint32(o + 4, true);
        o += 8 + size + (size & 1);
      }
      return 0;
    }
    if (tag(0, "fLaC") && v.byteLength > 22) return valid((v.getUint8(18) << 12) | (v.getUint8(19) << 4) | (v.getUint8(20) >> 4));
    let o = 0; // MP3 : la première trame, après l'étiquette ID3 s'il y en a une
    if (tag(0, "ID3") && v.byteLength > 10) o = 10 + (((v.getUint8(6) & 127) << 21) | ((v.getUint8(7) & 127) << 14) | ((v.getUint8(8) & 127) << 7) | (v.getUint8(9) & 127));
    for (const end = Math.min(v.byteLength - 4, o + 65536); o < end; o++) {
      if (v.getUint8(o) !== 0xFF || (v.getUint8(o + 1) & 0xE0) !== 0xE0) continue;
      const version = (v.getUint8(o + 1) >> 3) & 3, layer = (v.getUint8(o + 1) >> 1) & 3, index = (v.getUint8(o + 2) >> 2) & 3, bitrate = v.getUint8(o + 2) >> 4;
      if (version === 1 || layer === 0 || index === 3 || bitrate === 0 || bitrate === 15) continue;
      return [44100, 48000, 32000][index] >> (version === 3 ? 0 : version === 2 ? 1 : 2);
    }
    return 0;
  }

  async function decode(file, { minRate = 0 } = {}) {
    const Context = window.AudioContext || window.webkitAudioContext;
    const bytes = await file.arrayBuffer();
    const rate = Math.max(minRate, sourceRate(new DataView(bytes)));
    let context;
    try { context = new Context(rate ? { sampleRate: rate } : undefined); } catch { context = new Context(); }
    try {
      return await new Promise((resolve, reject) => { const p = context.decodeAudioData(bytes, resolve, reject); if (p && p.catch) p.catch(reject); });
    } catch {
      throw new Error("Ton navigateur ne sait pas lire « " + file.name + " ». Essaie en MP3 ou en WAV.");
    } finally { context.close(); }
  }

  /** Le son entre from et to (secondes), à la fréquence et au nombre de voies demandés. */
  async function render(audio, { rate = audio.sampleRate, channels = audio.numberOfChannels, from = 0, to = audio.duration } = {}) {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const offline = new Offline(channels, Math.max(1, Math.round((to - from) * rate)), rate);
    const source = offline.createBufferSource();
    source.buffer = audio;
    source.connect(offline.destination);
    source.start(0, from, to - from);
    return offline.startRendering();
  }

  const channelsOf = (audio) => Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));

  function wav(channels, sampleRate, bits = 24) {
    const count = channels.length, frames = channels[0].length, bytes = bits / 8, size = frames * count * bytes;
    const v = new DataView(new ArrayBuffer(44 + size));
    const text = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    text(0, "RIFF"); v.setUint32(4, 36 + size, true); text(8, "WAVEfmt "); v.setUint32(16, 16, true);
    v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, count, true); v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * count * bytes, true); v.setUint16(32, count * bytes, true); v.setUint16(34, bits, true);
    text(36, "data"); v.setUint32(40, size, true);
    for (let c = 0; c < count; c++) {
      const data = channels[c];
      for (let i = 0, o = 44 + c * bytes; i < frames; i++, o += count * bytes) {
        const s = Math.max(-1, Math.min(1, data[i]));
        if (bits === 32) v.setFloat32(o, s, true);
        else if (bits === 24) { const x = Math.round(s * 8388607); v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255); }
        // 16 bits : un bruit très faible (dither triangulaire) remplace la distorsion d'arrondi
        else v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(s * 32767 + Math.random() - Math.random()))), true);
      }
    }
    return new Blob([v.buffer], { type: "audio/wav" });
  }

  /** Le son en MP3 (44,1 ou 48 kHz, une ou deux voies) ; onProgress reçoit l'avancement de 0 à 1. */
  function mp3(channels, sampleRate, kbps, onProgress) {
    return new Promise((resolve, reject) => {
      const worker = new Worker("assets/mp3-worker.js");
      const fail = (message) => { worker.terminate(); reject(new Error(message)); };
      worker.onmessage = ({ data }) => {
        if (data.blob) { worker.terminate(); resolve(data.blob); } else if (data.error) fail(data.error); else if (onProgress) onProgress(data.progress);
      };
      worker.onerror = () => fail("L'encodage en MP3 a échoué.");
      worker.postMessage({ channels, sampleRate, kbps });
    });
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /** Le dépôt est accepté n'importe où sur la page ; un texte ou un lien glissé par erreur est ignoré. */
  function dropZone(button, input, onFiles, { multiple = false } = {}) {
    input.multiple = multiple;
    button.onclick = () => input.click();
    const give = (list) => { const files = [...list]; if (files.length && !button.disabled) onFiles(multiple ? files : files[0]); };
    input.onchange = () => { give(input.files); input.value = ""; };
    const carries = (event) => [...(event.dataTransfer?.types || [])].includes("Files");
    let depth = 0;
    addEventListener("dragenter", (event) => { if (!carries(event)) return; event.preventDefault(); depth++; button.classList.add("over"); });
    addEventListener("dragover", (event) => { if (!carries(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; });
    addEventListener("dragleave", (event) => { if (carries(event) && --depth <= 0) { depth = 0; button.classList.remove("over"); } });
    addEventListener("drop", (event) => {
      if (!carries(event)) return;
      event.preventDefault();
      depth = 0;
      button.classList.remove("over");
      give(event.dataTransfer.files);
    });
  }

  /** L'état de la zone de dépôt : occupée (avec un message) ou libre. */
  function busy(button, on, title) {
    button.disabled = on;
    button.classList.toggle("busy", on);
    const strong = button.querySelector("strong"), span = button.querySelector("span");
    if (!strong.dataset.idle) strong.dataset.idle = strong.textContent;
    strong.textContent = title || strong.dataset.idle;
    if (span) span.hidden = on || !!title;
  }

  return { decimal, clock, baseName, sourceRate, decode, render, channelsOf, wav, mp3, download, dropZone, busy };
})();
