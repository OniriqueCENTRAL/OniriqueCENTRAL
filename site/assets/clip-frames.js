// Les images des clips vidéo pour l'export de ONIRIQUE CUT, décodées par WebCodecs (mp4box.js lit le MP4/MOV) au lieu d'une
// balise <video> qu'on cale image par image : bien plus rapide, et indépendant de l'onglet affiché (un onglet caché freine
// les balises vidéo, pas le décodeur). Un clip qui ne se lit pas ainsi (WebM, codec inconnu) donne null : l'export garde
// alors la balise vidéo pour lui.
//
//   const reader = await clipFrames(file)   // null si ce clip ne se décode pas ici
//   const frame = await reader.frameAt(t)    // l'image affichée au temps t (secondes, comme video.currentTime)
//   reader.rotation                          // 0, 90, 180 ou 270 : la rotation du téléphone, à appliquer au dessin
//   reader.close()
import { createFile, DataStream, Endianness, MP4BoxBuffer } from "https://cdn.jsdelivr.net/npm/mp4box@2.4.1/dist/mp4box.all.mjs";

const demuxed = new Map(); // fichier → Promise de { config, samples, syncs, timescale, offset, rotation } (ou null)

/** Les images compressées de la piste vidéo, dans l'ordre de décodage, et la configuration du décodeur. */
async function demux(file) {
  const mp4 = createFile(), bytes = MP4BoxBuffer.fromArrayBuffer(await file.arrayBuffer(), 0);
  let track = null;
  const samples = [];
  const done = new Promise((resolve) => {
    mp4.onError = () => resolve(false);
    mp4.onReady = (info) => {
      track = info.videoTracks[0];
      if (!track || !track.nb_samples) return resolve(false);
      mp4.setExtractionOptions(track.id, null, { nbSamples: track.nb_samples });
      mp4.start();
    };
    mp4.onSamples = (_id, _user, list) => { for (const s of list) samples.push(s); if (samples.length >= track.nb_samples) resolve(true); };
  });
  mp4.appendBuffer(bytes, true);
  mp4.flush();
  if (!(await Promise.race([done, new Promise((r) => setTimeout(() => r(samples.length > 0), 0))]))) return null;
  let description;
  for (const entry of mp4.getTrackById(track.id).mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) { const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN); box.write(s); description = new Uint8Array(s.buffer, 8); break; }
  }
  const config = { codec: track.codec, codedWidth: track.video.width, codedHeight: track.video.height, ...(description ? { description } : {}) };
  if (!(await VideoDecoder.isConfigSupported(config).catch(() => ({}))).supported) return null;
  const m = track.matrix || [65536, 0, 0, 0, 65536, 0], angle = Math.round(Math.atan2(m[1], m[0]) * 180 / Math.PI / 90) * 90;
  const timescale = samples[0].timescale;
  return { config, samples, timescale, rotation: (angle + 360) % 360,
    syncs: samples.map((s, i) => (s.is_sync ? i : -1)).filter((i) => i >= 0),
    // La balise <video> commence au premier instant affiché (une liste d'édition décale souvent d'une image) : on fait pareil.
    offset: Math.min(...samples.map((s) => s.cts)) / timescale };
}

export async function clipFrames(file) {
  if (!window.VideoDecoder) return null;
  if (!demuxed.has(file)) demuxed.set(file, demux(file).catch(() => null));
  const d = await demuxed.get(file);
  return d && new Reader(d);
}

/** Ce qui se passe dans le clip, échantillonné tous les `step` secondes, sur une image réduite à 64 px de large :
 *  motion (l'image change), sharp (netteté) et focus (où est le sujet, de 0 à gauche à 1 à droite, lissé sur ~2 s). */
export async function analyzeClip(file, duration) {
  const reader = await clipFrames(file);
  if (!reader) return null;
  const step = Math.max(.25, duration / 240), n = Math.max(2, Math.floor(duration / step)), W = 64;
  const canvas = new OffscreenCanvas(W, W), ctx = canvas.getContext("2d", { willReadFrequently: true });
  const motion = new Float32Array(n), sharp = new Float32Array(n), focus = new Float32Array(n).fill(.5);
  let prev = null;
  try {
    for (let i = 0; i < n; i++) {
      const f = await Promise.race([reader.frameAt(i * step), new Promise((_, no) => setTimeout(() => no(new Error("décodage bloqué")), 5000))]);
      if (!f) break;
      const rot = reader.rotation, [vw, vh] = rot % 180 ? [f.displayHeight, f.displayWidth] : [f.displayWidth, f.displayHeight];
      const w = W, h = Math.max(8, Math.round(W * vh / vw));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(rot * Math.PI / 180);
      const [a, b] = rot % 180 ? [h, w] : [w, h];
      ctx.drawImage(f, -a / 2, -b / 2, a, b); ctx.restore();
      const px = ctx.getImageData(0, 0, w, h).data, y = new Float32Array(w * h);
      for (let k = 0; k < y.length; k++) y[k] = .299 * px[4 * k] + .587 * px[4 * k + 1] + .114 * px[4 * k + 2];
      let lap = 0, sx = 0, se = 0, m = 0;
      for (let r = 1; r < h - 1; r++) for (let c = 1; c < w - 1; c++) {
        const k = r * w + c, e = Math.abs(y[k + 1] - y[k - 1]) + Math.abs(y[k + w] - y[k - w]);
        lap += Math.abs(4 * y[k] - y[k - 1] - y[k + 1] - y[k - w] - y[k + w]); sx += e * c; se += e;
      }
      if (prev && prev.length === y.length) { for (let k = 0; k < y.length; k++) m += Math.abs(y[k] - prev[k]); m /= y.length; }
      sharp[i] = lap / ((w - 2) * (h - 2)); motion[i] = m; if (se) focus[i] = sx / se / (w - 1); prev = y;
    }
  } finally { reader.close(); }
  motion[0] = motion[1];
  const half = Math.max(1, Math.round(1 / step));
  const smooth = focus.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) { s += focus[j]; c++; } return s / c; });
  return { step, motion, sharp, focus: smooth };
}

class Reader {
  constructor(d) { this.d = d; this.rotation = d.rotation; this.decoder = null; this.frames = []; this.current = null; this.wake = () => {}; }

  /** Repart de l'image clé n° i (ordre de décodage). */
  reset(i) {
    this.close();
    this.decoder = new VideoDecoder({ output: (f) => { this.frames.push(f); this.wake(); }, error: (e) => { this.failed = e; this.wake(); } });
    this.decoder.ondequeue = () => this.wake();
    this.decoder.configure(this.d.config);
    this.next = i; this.flushed = this.flushDone = false;
  }

  /** L'image affichée au temps t ; elle reste valable jusqu'au prochain appel (ou close). */
  async frameAt(t) {
    const { samples, syncs, timescale, offset } = this.d, target = Math.round((t + offset) * timescale);
    let key = syncs[0];
    for (const i of syncs) { if (samples[i].cts <= target) key = i; else break; }
    // En arrière, ou loin devant (après une autre image clé) : on repart de l'image clé ; sinon on continue à décoder.
    const behind = this.current && this.current.timestamp > target;
    if (!this.decoder || behind || key > this.next) this.reset(key);
    for (;;) {
      if (this.failed) throw this.failed;
      while (this.frames.length && this.frames[0].timestamp <= target) { if (this.current) this.current.close(); this.current = this.frames.shift(); }
      if (this.frames.length || this.flushDone) break; // une image après t est arrivée : celle d'avant est la bonne
      // Fin du clip : on vide le décodeur sans l'attendre ici, pour fermer à mesure les images qui en sortent (sinon il se bloque).
      if (this.next >= samples.length && !this.flushed) {
        const decoder = this.decoder;
        this.flushed = true;
        decoder.flush().then(() => { if (decoder === this.decoder) { this.flushDone = true; this.wake(); } },
          (e) => { if (decoder === this.decoder) { this.failed = e; this.wake(); } });
      }
      // Peu d'images d'avance : le décodeur matériel a peu de place, et se bloque si on garde trop d'images non fermées.
      while (this.next < samples.length && this.decoder.decodeQueueSize < 8 && this.frames.length < 3) {
        const s = samples[this.next++];
        this.decoder.decode(new EncodedVideoChunk({ type: s.is_sync ? "key" : "delta", timestamp: s.cts, duration: s.duration, data: s.data }));
      }
      await new Promise((resolve) => { this.wake = resolve; });
    }
    return this.current || this.frames[0] || null;
  }

  close() {
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = null;
    for (const f of this.frames) f.close();
    this.frames = [];
    if (this.current) this.current.close();
    this.current = null; this.failed = null;
  }
}
