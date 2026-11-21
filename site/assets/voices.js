// Qui parle (ou qui chante) chaque phrase, pour ONIRIQUE CUT : une empreinte de voix par phrase (assets/voices-worker.js),
// puis les phrases se regroupent par voix. Tout tourne dans le navigateur, rien n'est envoyé.
//
//   const voices = await voicesOf(audioBuffer, [[début, fin], …], status, { song: true })
//   → [1, 1, 2, 3, …] : la voix de chaque phrase, numérotées dans l'ordre où elles arrivent ; null si l'IA ne tourne pas ici

/** Regroupe les phrases par voix. embs : les empreintes (vecteurs de norme 1), durs : la durée de chaque phrase (s).
 *  Les phrases d'au moins minDur secondes se rassemblent tant que leur ressemblance moyenne dépasse threshold (et toujours
 *  jusqu'à max voix au plus) ; les plus courtes, peu fiables seules (« Quoi ? »), rejoignent la voix la plus proche.
 *  smooth (un son) : une phrase seule entre deux phrases d'une même autre voix la rejoint, un son allant par parties. */
export function groupVoices(embs, durs, { max = 3, threshold = .4, minDur = 1, smooth = false } = {}) {
  if (!embs.length) return [];
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const long = embs.map((_, i) => i).filter((i) => durs[i] >= minDur);
  const groups = (long.length ? long : embs.map((_, i) => i)).map((i) => [i]);
  const link = (A, B) => { let s = 0; for (const i of A) for (const j of B) s += dot(embs[i], embs[j]); return s / (A.length * B.length); };
  while (groups.length > 1) {
    let best = -Infinity, bi = 0, bj = 1;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const s = link(groups[i], groups[j]);
      if (s > best) { best = s; bi = i; bj = j; }
    }
    if (best < threshold && groups.length <= max) break;
    groups[bi] = groups[bi].concat(groups[bj]);
    groups.splice(bj, 1);
  }
  const centroids = groups.map((g) => embs[0].map((_, k) => g.reduce((s, i) => s + embs[i][k], 0)));
  const label = embs.map((e, i) => {
    const own = groups.findIndex((g) => g.includes(i));
    if (own >= 0) return own;
    let best = 0, score = -Infinity;
    centroids.forEach((c, k) => { const s = dot(e, c) / (Math.hypot(...c) || 1); if (s > score) { score = s; best = k; } });
    return best;
  });
  if (smooth) for (let i = 1; i + 1 < label.length; i++) if (label[i - 1] === label[i + 1] && label[i] !== label[i - 1] && durs[i] < 2.5) label[i] = label[i - 1];
  const order = [];
  for (const g of label) if (!order.includes(g)) order.push(g);
  return label.map((g) => order.indexOf(g) + 1);
}

/** Le son en mono, 16 000 Hz (ce que l'IA écoute). */
async function mono16(buffer) {
  const off = new OfflineAudioContext(1, Math.ceil(buffer.duration * 16000), 16000), src = off.createBufferSource();
  src.buffer = buffer; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0).slice();
}

/** buffer : le son (la voix isolée pour un morceau, le dialogue tel quel pour un film) ; spans : [début, fin] de chaque phrase.
 *  song : réglages d'un morceau (voix traitées, qui se ressemblent davantage ; un son va par parties). */
export async function voicesOf(buffer, spans, status = () => {}, { song = false, max = 3 } = {}) {
  if (!spans.length) return [];
  try {
    const audio = await mono16(buffer);
    const worker = new Worker(new URL("voices-worker.js?v=1", import.meta.url), { type: "module" });
    const out = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => (data.type === "done" ? resolve(data) : data.type === "error" ? reject(new Error(data.message))
        : status(data.phase === "download" ? "Téléchargement de l'IA des voix (26 Mo, une seule fois)… " + Math.round(data.value * 100) + " %" : "L'IA reconnaît les voix… " + Math.round(data.value * 100) + " %"));
      worker.onerror = (event) => reject(new Error(event.message || "l'IA n'a pas pu démarrer"));
      worker.postMessage({ audio, spans }, [audio.buffer]);
    }).finally(() => worker.terminate());
    // Seuils mesurés : un dialogue de film (Harry Potter 5) donne ~0,5 de ressemblance pour une même voix et ~0,3 entre deux ;
    // les voix d'un son (DEAD, trois artistes) se ressemblent davantage (0,35 à 0,5 pour une même voix, 0,2 à 0,35 entre deux).
    return groupVoices(out.embeddings, spans.map(([a, b]) => b - a), song ? { max, threshold: .36, smooth: true } : { max, threshold: .4 });
  } catch { return null; }
}
