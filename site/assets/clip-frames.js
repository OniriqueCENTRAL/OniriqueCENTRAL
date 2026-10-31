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

class Reader {
  constructor(d) { this.d = d; this.rotation = d.rotation; this.decoder = null; this.frames = []; this.current = null; this.wake = () => {}; }

  /** Repart de l'image clé n° i (ordre de décodage). */
  reset(i) {
    this.close();
    this.decoder = new VideoDecoder({ output: (f) => { this.frames.push(f); this.wake(); }, error: (e) => { this.failed = e; this.wake(); } });
    this.decoder.ondequeue = () => this.wake();
    this.decoder.configure(this.d.config);
    this.next = i; this.flushed = false;
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
      if (this.frames.length || this.flushed) break; // une image après t est arrivée : celle d'avant est la bonne
      if (this.next >= samples.length) { this.flushed = true; await this.decoder.flush(); continue; }
      while (this.next < samples.length && this.decoder.decodeQueueSize < 8) {
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
