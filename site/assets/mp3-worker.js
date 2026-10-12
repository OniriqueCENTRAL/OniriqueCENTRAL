// Encodage MP3 pour le convertisseur et la découpe : tourne dans un Web Worker, avec l'encodeur lamejs
// (vendor/lamejs.min.js, licence LGPL : vendor/lamejs-LICENSE.txt). Rien ne quitte le navigateur.
//
//   postMessage({ channels: [Float32Array, (Float32Array)], sampleRate: 44100 | 48000, kbps })
//     →  { progress: 0…1 } au fil de l'eau, puis { blob }  ou  { error }
importScripts("vendor/lamejs.min.js");

self.onmessage = ({ data: { channels, sampleRate, kbps } }) => {
  try {
    const lame = lamejs.Mp3Encoder ? lamejs : new lamejs();
    const encoder = new lame.Mp3Encoder(channels.length, sampleRate, kbps);
    const frames = channels[0].length, BLOCK = 1152 * 40, parts = [];
    const pcm = channels.map(() => new Int16Array(BLOCK));
    for (let start = 0; start < frames; start += BLOCK) {
      const count = Math.min(BLOCK, frames - start);
      channels.forEach((data, c) => {
        for (let i = 0; i < count; i++) { const s = Math.max(-1, Math.min(1, data[start + i])); pcm[c][i] = s < 0 ? s * 32768 : s * 32767; }
      });
      const left = pcm[0].subarray(0, count), right = channels.length > 1 ? pcm[1].subarray(0, count) : undefined;
      const out = right ? encoder.encodeBuffer(left, right) : encoder.encodeBuffer(left);
      if (out.length) parts.push(new Uint8Array(out));
      self.postMessage({ progress: Math.min(1, (start + count) / frames) });
    }
    const end = encoder.flush();
    if (end.length) parts.push(new Uint8Array(end));
    self.postMessage({ blob: new Blob(parts, { type: "audio/mpeg" }) });
  } catch {
    self.postMessage({ error: "L'encodage en MP3 a échoué." });
  }
};
