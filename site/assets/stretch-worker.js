// Changement de durée sans changement de hauteur, pour la page « Transposer » : tourne dans un Web Worker.
// Rien ne quitte le navigateur.
//
//   postMessage({ channels: [Float32Array…], sampleRate, stretch })   stretch = durée voulue / durée d'origine
//     →  { progress: 0…1 } au fil de l'eau, puis { channels: [Float32Array…] }  ou  { error }
//
// Méthode (WSOLA) : le son est découpé en fenêtres qui se recouvrent de moitié, reposées plus ou moins serrées. Chaque
// fenêtre est prise à l'endroit, proche de sa position théorique, où elle prolonge le mieux la précédente : les
// formes d'onde se raccordent, et les attaques (kick, caisse claire) restent nettes.

const DECIMATE = 8; // la recherche du meilleur raccord se fait d'abord sur un son réduit, puis s'affine

function stretchAll({ channels, sampleRate, stretch }, report) {
  const length = channels[0].length;
  const size = 2 * Math.round(sampleRate * 0.0225); // fenêtre de 45 ms : assez longue pour les graves, assez courte pour les attaques
  const hop = size / 2, reach = Math.round(sampleRate * 0.012); // on cherche le raccord à ±12 ms
  const outLength = Math.max(1, Math.round(length * stretch)), step = hop / stretch;
  // Un court silence est ajouté devant le son, puis retiré du résultat : la toute première attaque tombe ainsi en
  // pleine fenêtre, et non dans son fondu d'entrée.
  const lead = Math.ceil(hop / stretch) + 1, skip = Math.round(lead * stretch);
  const frames = Math.ceil((outLength + skip) / hop) + 1;

  // Le son d'entrée, prolongé de silence pour que la dernière fenêtre et sa recherche aient de quoi lire.
  const pad = size + reach + hop + DECIMATE, total = lead + length + pad;
  const input = channels.map((c) => { const p = new Float32Array(total); p.set(c, lead); return p; });
  const guide = new Float32Array(total);
  for (const c of input) for (let i = 0; i < guide.length; i++) guide[i] += c[i] / input.length;
  const small = new Float32Array(Math.floor(guide.length / DECIMATE));
  for (let i = 0; i < small.length; i++) { let sum = 0; for (let j = 0; j < DECIMATE; j++) sum += guide[i * DECIMATE + j]; small[i] = sum / DECIMATE; }

  const window = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size));
  const out = channels.map(() => new Float32Array((frames + 1) * hop + size));
  const last = total - size - 1, smallSize = Math.floor(size / DECIMATE);

  let previous = 0;
  for (let k = 0; k < frames; k++) {
    const ideal = Math.round(k * step);
    let position = Math.min(ideal, last);
    if (k > 0) {
      // Ce que la fenêtre précédente aurait joué ensuite : c'est à cela que la nouvelle doit ressembler.
      const natural = Math.min(previous + hop, last);
      const from = Math.max(0, ideal - reach), to = Math.min(last, ideal + reach);
      if (natural >= from && natural <= to) position = natural; // la suite naturelle est à portée : aucun raccord à faire
      else {
        const target = Math.floor(natural / DECIMATE);
        let best = -Infinity, coarse = Math.floor(Math.min(ideal, last) / DECIMATE);
        for (let c = Math.floor(from / DECIMATE), end = Math.min(Math.floor(to / DECIMATE), small.length - smallSize - 1); c <= end; c++) {
          let cross = 0, energy = 1e-9;
          for (let i = 0; i < smallSize; i++) { const v = small[c + i]; cross += v * small[target + i]; energy += v * v; }
          const score = cross / Math.sqrt(energy);
          if (score > best) { best = score; coarse = c; }
        }
        best = -Infinity;
        for (let p = Math.max(from, coarse * DECIMATE - DECIMATE), end = Math.min(to, coarse * DECIMATE + DECIMATE); p <= end; p++) {
          let cross = 0, energy = 1e-9;
          for (let i = 0; i < size; i += 4) { const v = guide[p + i]; cross += v * guide[natural + i]; energy += v * v; }
          const score = cross / Math.sqrt(energy);
          if (score > best) { best = score; position = p; }
        }
      }
    }
    for (let c = 0; c < input.length; c++) {
      const source = input[c], target = out[c], at = k * hop;
      for (let i = 0; i < size; i++) target[at + i] += source[position + i] * window[i];
    }
    previous = position;
    if (k % 400 === 0 && report) report(k / frames);
  }
  return out.map((target) => target.slice(skip, skip + outLength));
}

if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof importScripts === "function") {
  self.onmessage = (event) => {
    try {
      const channels = stretchAll(event.data, (progress) => self.postMessage({ progress }));
      self.postMessage({ channels }, channels.map((c) => c.buffer));
    } catch { self.postMessage({ error: "Le traitement a échoué sur ce fichier." }); }
  };
}
if (typeof module !== "undefined") module.exports = { stretchAll }; // essais hors navigateur
