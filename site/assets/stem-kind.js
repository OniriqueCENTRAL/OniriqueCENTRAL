// Reconnaître le type d'une piste (kick, snare, hi-hat, 808, basse, mélodie…), la renommer, et ranger le tout dans
// un pack .zip. Tout se passe dans le navigateur.
//
//   OniriqueStems.features(samples, sampleRate)   →  ce qui est mesuré sur le son (mono, 22 050 Hz suffit)
//   OniriqueStems.classify(fileName, features)    →  { kind, from: "nom" | "son" }
//   OniriqueStems.KINDS                           →  les types, dans l'ordre où un pack les range
//   OniriqueStems.names(stems, { bpm, key, tagFiles })   →  le nouveau nom de chaque piste, dans l'ordre du pack
//   OniriqueStems.zip(entries)                    →  Promise d'un Blob ; entries = [{ name, file }]
//
// Le nom du fichier passe d'abord : celui qui a exporté « Kick.wav » sait ce qu'il y a dedans. Le son ne décide que
// pour les pistes dont le nom ne dit rien (« Audio 07 », « Piste 3 »).
(function (root) {
  // Dans l'ordre d'un pack : la batterie, les basses, ce qui est mélodique, les voix, le reste.
  const KINDS = ["Kick", "Snare", "Clap", "Hi-Hat", "Cymbale", "Perc", "Drums", "808", "Bass", "Piano", "Guitare", "Synth", "Melodie", "Voix", "Backs", "FX", "Autre"];

  // Ce qu'un nom de fichier dit de son contenu. Le premier motif trouvé l'emporte : « 808 » avant « kick » pour
  // « 808 kick », « hat » avant « drum » pour « drum hat ».
  const WORDS = [
    ["808", /(^|[^0-9])808([^0-9]|$)/],
    ["Hi-Hat", /hi[\s_-]?hat|(^|[^a-z])(hh|hat|hats|ohh|chh|charley|charleston)([^a-z]|$)/],
    ["Cymbale", /cymbal|crash|(^|[^a-z])ride([^a-z]|$)|splash/],
    ["Clap", /clap|snap/],
    ["Snare", /snare|(^|[^a-z])(sn|sd|rim|rimshot)([^a-z]|$)|caisse[\s_-]?claire/],
    ["Kick", /kick|(^|[^a-z])(bd|kik|kck)([^a-z]|$)|grosse[\s_-]?caisse/],
    ["Perc", /perc|shaker|tamb|conga|bongo|cowbell|clave|(^|[^a-z])(tom|toms)([^a-z]|$)|triangle/],
    ["Drums", /drum|batterie|(^|[^a-z])(beat|top[\s_-]?loop|break)([^a-z]|$)/],
    ["Backs", /adlib|ad[\s_-]lib|back|choeur|chœur|choir|harmon|double|dbl/],
    ["Voix", /vox|vocal|voix|voice|lead[\s_-]?v|(^|[^a-z])(acapella|chant|rap|verse|hook|refrain|topline)([^a-z]|$)/],
    ["Bass", /bass|basse|(^|[^a-z])sub([^a-z]|$)/],
    ["Piano", /piano|keys|rhodes|wurli|clav|orgue|organ|(^|[^a-z])(ep|epiano)([^a-z]|$)/],
    ["Guitare", /guitar|guitare|(^|[^a-z])(gtr|gt)([^a-z]|$)/],
    ["Synth", /synth|pad|pluck|arp|saw|bell|string|corde|brass|cuivre|flute|flûte|violin|violon|sax|horn|lead/],
    ["FX", /(^|[^a-z])(fx|sfx)([^a-z]|$)|riser|sweep|impact|whoosh|noise|atmo|ambian|texture|foley|transition|reverse|downlifter|uplifter/],
    ["Melodie", /melod|mélod|(^|[^a-z])(melo|mel|sample|chord|accord|loop)([^a-z]|$)/],
  ];

  function fromName(fileName) {
    const text = String(fileName).replace(/\.[^.]+$/, "").toLowerCase().normalize("NFC");
    for (const [kind, pattern] of WORDS) if (pattern.test(text)) return kind;
    return null;
  }

  //------------------------------------------------------------------------------------------------------------------
  // Le son.
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = -2 * Math.PI / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const c = Math.cos(step * k), s = Math.sin(step * k), a = start + k, b = a + half;
          const xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  const median = (values) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[sorted.length >> 1];
  };

  /**
   * Ce qui distingue les types : où est l'énergie dans le spectre, et comment le son se tient dans le temps.
   * Seules les trames où il y a du son comptent, pour qu'un kick posé toutes les mesures ne soit pas noyé dans le silence.
   */
  function features(samples, sampleRate) {
    const N = 2048, hop = 1024, limit = Math.min(samples.length, Math.round(90 * sampleRate));
    const window = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));

    // L'enveloppe, toutes les 10 ms.
    const step = Math.max(1, Math.round(sampleRate / 100)), envelope = [];
    let top = 0;
    for (let i = 0; i + step <= limit; i += step) {
      let sum = 0;
      for (let k = i; k < i + step; k++) sum += samples[k] * samples[k];
      const rms = Math.sqrt(sum / step);
      envelope.push(rms);
      if (rms > top) top = rms;
    }
    if (!envelope.length || top < 0.0005) return { silent: true };

    // Les attaques : l'enveloppe qui monte d'un coup, au-dessus du cinquième de son maximum. Après chacune, le temps
    // qu'elle met à retomber au quart de son sommet dit si le son est frappé (court) ou tenu (long).
    const onsets = [], decays = [];
    for (let i = 1; i < envelope.length; i++) {
      const before = Math.max(envelope[i - 1], i > 1 ? envelope[i - 2] : 0);
      if (envelope[i] < top * 0.2 || envelope[i] < before * 2.2 + top * 0.02) continue;
      if (onsets.length && i - onsets[onsets.length - 1] < 6) continue;
      let peakAt = i;
      for (let k = i; k < Math.min(envelope.length, i + 5); k++) if (envelope[k] > envelope[peakAt]) peakAt = k;
      let end = peakAt;
      while (end < envelope.length && end - peakAt < 300 && envelope[end] > envelope[peakAt] * 0.25) end++;
      onsets.push(i);
      decays.push((end - peakAt) / 100);
    }
    const seconds = envelope.length / 100;
    const active = envelope.filter((v) => v > top * 0.1).length / envelope.length;

    // Le spectre moyen des trames où il y a du son.
    const bins = N / 2, spectrum = new Float64Array(bins), re = new Float32Array(N), im = new Float32Array(N);
    let frames = 0;
    for (let start = 0; start + N <= limit; start += hop) {
      let sum = 0;
      for (let i = 0; i < N; i++) sum += samples[start + i] * samples[start + i];
      if (Math.sqrt(sum / N) < top * 0.1) continue;
      for (let i = 0; i < N; i++) { re[i] = samples[start + i] * window[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 1; k < bins; k++) spectrum[k] += re[k] * re[k] + im[k] * im[k];
      frames++;
    }
    if (!frames) return { silent: true };

    const hz = sampleRate / N, band = (from, to) => {
      let sum = 0;
      for (let k = Math.max(1, Math.ceil(from / hz)); k < Math.min(bins, Math.ceil(to / hz)); k++) sum += spectrum[k];
      return sum;
    };
    const total = band(20, sampleRate / 2) || 1e-20;
    let weighted = 0, logSum = 0, linear = 0, count = 0;
    for (let k = 1; k < bins; k++) {
      weighted += k * hz * spectrum[k];
      if (k * hz >= 300 && k * hz <= 8000) { logSum += Math.log(spectrum[k] + 1e-20); linear += spectrum[k]; count++; }
    }
    return {
      silent: false,
      sub: band(20, 100) / total,          // part de l'énergie sous 100 Hz
      low: band(100, 250) / total,
      mid: band(250, 2000) / total,
      high: band(2000, sampleRate / 2) / total,
      centroid: weighted / total,          // le centre de gravité du spectre, en hertz
      flatness: count ? Math.exp(logSum / count) / (linear / count + 1e-20) : 0, // 1 : du bruit ; 0 : des notes
      onsets: onsets.length / seconds,     // attaques par seconde
      decay: median(decays),               // secondes pour retomber au quart, au milieu de la distribution
      active,                              // part du temps où il y a du son
    };
  }

  /** Le type d'après le son seul. Volontairement prudent : ce qui n'est ni clairement frappé ni clairement grave est « Melodie ». */
  function fromSound(f) {
    if (!f || f.silent) return "Autre";
    const bottom = f.sub + f.low;
    const struck = f.onsets > 0.25 && f.decay > 0 && f.decay < 0.2 && f.active < 0.7;

    if (struck) {
      // Du grave et de l'aigu frappés ensemble : une batterie entière.
      // (un kick pèse bien plus lourd que le reste : quelques centièmes d'aigu à côté de lui suffisent).
      if (bottom > 0.2 && f.high > 0.04 && f.onsets > 2.5) return "Drums";
      if (bottom > 0.6 && f.centroid < 600) return "Kick";
      if (f.high > 0.6 && f.centroid > 3500) return "Hi-Hat";
      if (f.flatness > 0.2 && f.mid + f.high > 0.4) return "Snare";
      return "Perc";
    }
    if (bottom > 0.7 && f.centroid < 400) {
      // Une basse qui repart à chaque note et s'éteint lentement : une 808. Tenue : une basse.
      return f.onsets > 0.2 && f.decay >= 0.2 ? "808" : "Bass";
    }
    return "Melodie";
  }

  function classify(fileName, f) {
    if (f && f.silent) return { kind: "Autre", from: "son" };
    const named = fromName(fileName);
    return named ? { kind: named, from: "nom" } : { kind: fromSound(f), from: "son" };
  }

  //------------------------------------------------------------------------------------------------------------------
  // Les noms.
  /** Retire d'un texte ce qu'un nom de fichier ne peut pas porter, sur aucun système. */
  const safe = (text) => String(text).replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").replace(/^[ .]+|[ .]+$/g, "");

  /** « 140 BPM - F minor », ou ce qu'on en connaît. */
  const tag = ({ bpm, key }) => [bpm && safe(bpm) + " BPM", key && safe(key)].filter(Boolean).join(" - ");

  /**
   * Le nouveau nom de chaque piste, dans l'ordre du pack : un numéro pour que l'ordre survive à un tri par nom, le type,
   * un rang quand plusieurs pistes ont le même type, puis le tempo et la tonalité si on les veut dans chaque fichier.
   * stems = [{ name, kind }] ; rend [{ stem, name }].
   */
  function names(stems, { bpm = "", key = "", tagFiles = true } = {}) {
    const ordered = stems.map((stem, index) => ({ stem, index }))
      .sort((a, b) => KINDS.indexOf(a.stem.kind) - KINDS.indexOf(b.stem.kind) || a.stem.name.localeCompare(b.stem.name, "fr", { numeric: true }) || a.index - b.index);
    const perKind = new Map();
    ordered.forEach(({ stem }) => perKind.set(stem.kind, (perKind.get(stem.kind) || 0) + 1));
    const seen = new Map(), digits = Math.max(2, String(ordered.length).length), suffix = tagFiles ? tag({ bpm, key }) : "";
    return ordered.map(({ stem }, position) => {
      const rank = (seen.get(stem.kind) || 0) + 1;
      seen.set(stem.kind, rank);
      const extension = (stem.name.match(/\.[A-Za-z0-9]{1,5}$/) || [""])[0].toLowerCase();
      const label = stem.kind + (perKind.get(stem.kind) > 1 ? " " + rank : "");
      return { stem, name: [String(position + 1).padStart(digits, "0") + " " + label, suffix].filter(Boolean).join(" - ") + extension };
    });
  }

  //------------------------------------------------------------------------------------------------------------------
  // Le pack : un .zip sans compression (de l'audio ne se compresse presque pas), écrit autour des fichiers eux-mêmes.
  const CRC = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes, crc = 0) {
    crc = ~crc >>> 0;
    for (let i = 0; i < bytes.length; i++) crc = CRC[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return ~crc >>> 0;
  }

  /** entries = [{ name, file }], file étant un Blob ou un File. Les fichiers ne sont pas recopiés : le .zip les entoure. */
  async function zip(entries, onProgress = () => {}) {
    const encoder = new TextEncoder(), now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = [];
    let offset = 0;

    for (const [index, { name, file }] of entries.entries()) {
      if (file.size > 0xFFFFFFFE || offset > 0xFFFFFFFE) throw new Error("Ce pack dépasse 4 Go : fais-en deux.");
      // Lu par tranches pour la somme de contrôle, sans garder le fichier entier en mémoire.
      let crc = 0;
      for (let at = 0; at < file.size; at += 8 << 20) crc = crc32(new Uint8Array(await file.slice(at, at + (8 << 20)).arrayBuffer()), crc);
      const bytes = encoder.encode(name);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // noms en UTF-8
      local.setUint16(8, 0, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
      local.setUint32(14, crc, true); local.setUint32(18, file.size, true); local.setUint32(22, file.size, true);
      local.setUint16(26, bytes.length, true); local.setUint16(28, 0, true);
      parts.push(local.buffer, bytes, file);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true); entry.setUint16(12, time, true); entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true); entry.setUint32(20, file.size, true); entry.setUint32(24, file.size, true);
      entry.setUint16(28, bytes.length, true); entry.setUint32(42, offset, true);
      central.push(entry.buffer, bytes);
      offset += 30 + bytes.length + file.size;
      onProgress((index + 1) / entries.length);
    }

    const size = central.reduce((sum, part) => sum + part.byteLength, 0);
    if (offset + size > 0xFFFFFFFE) throw new Error("Ce pack dépasse 4 Go : fais-en deux.");
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
  }

  const api = { KINDS, features, classify, fromName, fromSound, names, safe, tag, zip, crc32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OniriqueStems = api;
})(typeof window !== "undefined" ? window : globalThis);
