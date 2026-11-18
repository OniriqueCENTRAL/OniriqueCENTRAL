// Le son d'une sortie précise arrive de tools/audiotap en PCM 16 bits, 48 kHz, stéréo (comme pour la WATCHPARTY) : ce
// module de la fenêtre des clips (clips-recorder.js) en fait du son. Dans un fichier : la page n'accepte pas de module fabriqué.
class P extends AudioWorkletProcessor {
  constructor() { super(); this.q = []; this.off = 0; this.size = 0;
    this.port.onmessage = (e) => { const b = new Int16Array(e.data); this.q.push(b); this.size += b.length;
      while (this.size > 48000 * 2 * 0.25 && this.q.length > 1) { this.size -= this.q.shift().length; this.off = 0; } }; }
  process(_inputs, outputs) { const [l, r] = outputs[0];
    for (let i = 0; i < l.length; i++) { const b = this.q[0]; if (!b) { l[i] = r[i] = 0; continue; }
      l[i] = b[this.off] / 32768; r[i] = b[this.off + 1] / 32768; this.off += 2;
      if (this.off >= b.length) { this.size -= b.length; this.q.shift(); this.off = 0; } }
    return true; } }
registerProcessor("clips-pcm", P);
