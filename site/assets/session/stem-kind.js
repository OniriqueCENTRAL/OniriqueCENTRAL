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
  const KINDS = ["Master", "Instru","Kick", "Snare", "Clap", "Hi-Hat", "Cymbale", "Perc", "Drums", "808", "Bass", "Piano", "Guitare", "Synth", "Melodie", "Lead", "Backs", "Adlibs", "FX", "Autre"];

  // Ce qu'un nom de fichier dit de son contenu. Le premier motif trouvé l'emporte : « 808 » avant « kick » pour
  // « 808 kick », « hat » avant « drum » pour « drum hat ».
  const WORDS = [
    // Le morceau fini, envoyé en référence (« peur de rien master v6 », « Mix final », « Ref ») ; pas « LoopMasters ».
    // Une « ref » de voix (« PRE REF LEAD », « DOUBLURE REF2 », « harmo ref ») est une voix guide, pas le morceau.
    ["Master", /^(?!.*(voix|vox|voca|lead|harmo|armo|doubl|back|ad+[\s_-]?lib|couplet|refrain|hook|chant)).*((^|[^a-z])(master|mastered|premaster|pre[\s_-]?master|ref|preref|pre[\s_-]ref|reference)([^a-z]|$)|(^|[^a-z])mix[\s_-]?(final|v\d)|final[\s_-]?mix|full[\s_-]?mix)/],
    // Un bruitage de banque de sons (« Weather Storm Lightning Bolt Crash », « Rumble Subsonic Bass ») : un effet, même s'il
    // nomme un instrument.
    ["FX", /weather|thunder|lightning|storm|orage|tonnerre|(^|[^a-z])(rain|pluie)([^a-z]|$)|sound[\s_-]?effects?|effets?[\s_-]?sonores?|bruitage/],
    ["808",/(^|[^0-9])808([^0-9]|$)/],
    ["Hi-Hat", /hi[\s_-]?hat|(^|[^a-z])(hh|hat|hats|ohh|chh|charley|charleston)([^a-z]|$)/],
    ["Cymbale", /cymbal|crash|(^|[^a-z])ride([^a-z]|$)|splash/],
    ["Clap", /clap|snap/],
    ["Snare", /snare|(^|[^a-z])(sn|sd|rim|rimshot)([^a-z]|$)|caisse[\s_-]?claire/],
    // « couplet 1 kick », « 1er couplet parti 2 kick » : kicker, c'est rapper ; la piste est une voix. « REC KICK » aussi :
    // la piste d'enregistrement du rappeur (744 prises sur un PC de studio, toutes des voix).
    ["Kick", /^(?!.*(couplet|cpl|verse|chant|voix|vox|freestyle|(^|[^a-z])(rap|rec)([^a-z]|$))).*(kick|(^|[^a-z])(bd|kik|kck)([^a-z]|$)|grosse[\s_-]?caisse)/],
    ["Perc", /perc|shaker|tamb|conga|bongo|cowbell|clave|(^|[^a-z])(tom|toms)([^a-z]|$)|triangle/],
    // L'instru entière d'une session d'enregistrement (« Instru », « 2track », « @prodhilen 130BPM »).
    ["Instru", /instru|2[\s_-]?track|two[\s_-]?track|@prod|(^|[^a-z])(beat|prod|riddim|mixdown|bounce)([^a-z]|$)/],
    ["Drums", /drum|batterie|(^|[^a-z])(top[\s_-]?loop|break|fills?)([^a-z]|$)/],
    // Les noms des sessions de rap françaises (« PDTP ADDLIBS », « harmos », « Doublure CPL », « Soutiens High »).
    ["Adlibs", /ad+[\s_-]?libs?|(^|[^a-z])(adl|adlb)([^a-z]|$)/],
    ["Backs", /back|choeur|chœur|choir|harmo|(^|[^a-z])armos?([^a-z]|$)|doubl|soutien|unisson|(^|[^a-z])(dbl|bg|bgv|bgs|bv|bvs)([^a-z]|$)/],
    ["Synth", /(synth|pluck|arp|saw)[\s_-]?lead|lead[\s_-]?(synth|pluck|arp|saw)/],
    // « Lead » seul est la voix principale : dans une session de voix, c'est ainsi qu'on la nomme (« LEAD 1 », « Lead PRINT »).
    // Une piste qui s'appelle « REC », « REC KICK », « REC (consolidated) » (la piste où l'on enregistre, dans FL Studio)
    // est une voix ; pas « REC 2_2 - Audio 07 », le nom d'une session.
    ["Lead", /vox|voca+l|voix|voice|(^|[^a-z])(leads?|ld|vocs?|acapella|chant|rap|verse|hook|refrains?|couplets?|cpl|topline|freestyle|autotune)([^a-z]|$)|^rec(\s+[a-z]+)*(\s*\([^)]*\))?$/],
    ["Bass", /bass|basse|(^|[^a-z])sub([^a-z]|$)/],
    ["Piano", /piano|keys|rhodes|wurli|clav|orgue|organ|(^|[^a-z])(ep|epiano)([^a-z]|$)/],
    ["Guitare", /guitar|guitare|(^|[^a-z])(gtr|gt)([^a-z]|$)/],
    ["Synth", /synth|pad|pluck|arp|saw|bell|string|corde|brass|cuivre|flute|flûte|violin|violon|sax|horn|lead/],
    ["FX", /(^|[^a-z])(fx|fxs|sfx|dly|rvb|rvrb|revrb)\d*([^a-z]|$)|echo|delay|riser|sweep|impact|whoosh|noise|atmo|ambian|texture|foley|transition|reverse|downlifter|uplifter|vinyl|crackle|rumble|drone|granul|particle|glitch|reverb|(^|[^a-z])(tag|tags|txt|tex|verb|amb)([^a-z]|$)/],
    ["Melodie", /melod|mélod|(^|[^a-z])(melo|mel|sample|chord|accord|loop)([^a-z]|$)/],
    // Le print d'un mix (« SSL PRINT », « Print ») quand rien d'autre ne dit ce qu'il contient.
    ["Master", /(^|[^a-z])print([^a-z]|$)/],
  ];

  // Ce qui n'est pas un nom : un identifiant (« 97729dcbeadb4a95… », un UUID) où « bd » ferait un kick, et les suffixes
  // des copies de Pro Tools (« .dup3 »).
  const NOISE = /[0-9a-f]{16,}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}|\.dup\d*/g;
  const INSTRU = /instru|(^|[^a-z])(prod|beat)([^a-z]|$)/;
  const match = (text) => { for (const [kind, pattern] of WORDS) if (pattern.test(text)) return kind; return null; };
  /**
   * Le dernier morceau d'un nom dit la piste, le début dit souvent le projet : « FOLIE (prod @azurel) 133BPM - LEAD GRY »
   * est une voix, « famille veut me voir stems_KICK » un kick. On lit le morceau après le dernier « _ », puis après le
   * dernier « - », puis le nom entier.
   */
  function fromName(fileName) {
    // « _2 », « _3 » : les prises suivantes d'une même piste dans FL Studio (« …_REC KICK_2 »).
    const text = String(fileName).replace(/\.[^.]+$/, "").toLowerCase().normalize("NFC").replace(NOISE, " ").replace(/_\d+$/, "");
    const last = (separator) => { const pieces = text.split(separator); return pieces.length > 1 ? pieces.pop() : ""; };
    const parts = [last("_"), last(/\s-\s|\s-|-\s/), text].filter((p) => p.trim());
    for (const part of parts) {
      const kind = match(part);
      // « master prod », « Prod_Master » : la prod masterisée, une instru et pas le morceau fini.
      if (kind === "Master" && INSTRU.test(text)) return "Instru";
      if (kind) return kind;
    }
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

  const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

  /**
   * Ce qui distingue les types, mesuré sur les seules trames où il y a du son (un kick posé toutes les mesures n'est pas
   * noyé dans le silence) :
   *  - où est l'énergie, du grave à l'aigu, trame par trame et en amplitude (en puissance, le grave écrase tout le reste) ;
   *  - comment le son se tient dans le temps : attaques par seconde, temps pour retomber, part du temps où il sonne ;
   *  - la note : une voix glisse sans cesse d'une hauteur à l'autre, un instrument tient les siennes ;
   *  - ce que contient chaque attaque, pour séparer un kick d'une snare même quand l'une traîne plus que l'autre.
   */
  function features(whole, sampleRate) {
    // 90 secondes à partir du premier son : un stem exporté depuis le début du morceau (des adlibs du dernier refrain)
    // peut se taire bien plus longtemps, et n'aurait été entendu que silencieux.
    let loudest = 0;
    for (let i = 0; i < whole.length; i++) { const v = Math.abs(whole[i]); if (v > loudest) loudest = v; }
    let first = 0;
    while (first < whole.length && Math.abs(whole[first]) < loudest * 0.05) first++;
    const samples = whole.subarray(Math.max(0, first - Math.round(0.05 * sampleRate)));
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

    // Quand la piste chante, sur tout le morceau (dixièmes de seconde, à 34 dB sous son plus fort) : pour dire, entre
    // voix, laquelle chante avec le lead, à côté, ou à sa place (refine).
    const tenth = Math.round(sampleRate / 10), loud = [];
    for (let i = 0; i + tenth <= whole.length; i += tenth) {
      let sum = 0;
      for (let k = i; k < i + tenth; k++) sum += whole[k] * whole[k];
      loud.push(Math.sqrt(sum / tenth));
    }
    const peak = loud.reduce((a, b) => Math.max(a, b), 0), sung = Uint8Array.from(loud, (v) => (v > peak * 0.02 ? 1 : 0));

    // Une trame : ses quatre bandes (sous 120 Hz, 120-400, 400-2500, au-dessus) en part de l'amplitude, son centre de
    // gravité, sa platitude (1 : du bruit ; 0 : des notes) et, par l'autocorrélation, sa note et à quel point elle en a une.
    const bins = N / 2, hz = sampleRate / N, re = new Float32Array(N), im = new Float32Array(N);
    const edges = [20, 120, 400, 2500, sampleRate / 2].map((f) => Math.min(bins, Math.max(1, Math.round(f / hz))));
    const flatFrom = Math.round(300 / hz), flatTo = Math.min(bins, Math.round(8000 / hz));
    const minLag = Math.floor(sampleRate / 900), maxLag = Math.ceil(sampleRate / 70);
    const windowAcf = new Float64Array(maxLag + 2); // la fenêtre elle-même fait baisser l'autocorrélation avec le décalage
    for (let lag = 0; lag < windowAcf.length; lag++) for (let i = 0; i + lag < N; i++) windowAcf[lag] += window[i] * window[i + lag];
    function frame(start) {
      for (let i = 0; i < N; i++) { re[i] = (samples[start + i] || 0) * window[i]; im[i] = 0; }
      fft(re, im);
      const bands = [0, 0, 0, 0];
      let total = 0, weighted = 0, logSum = 0, linear = 0;
      for (let k = 1; k < bins; k++) {
        const power = re[k] * re[k] + im[k] * im[k], magnitude = Math.sqrt(power);
        total += magnitude; weighted += k * hz * magnitude;
        for (let b = 0; b < 4; b++) if (k >= edges[b] && k < edges[b + 1]) bands[b] += magnitude;
        if (k >= flatFrom && k < flatTo) { logSum += Math.log(power + 1e-20); linear += power; }
        re[k] = power; im[k] = 0;
      }
      re[0] = 0; re[bins] = 0;
      for (let k = 1; k < bins; k++) re[N - k] = re[k];
      im.fill(0);
      fft(re, im); // l'autocorrélation, à un facteur près
      let best = 0, bestLag = 0;
      if (re[0] > 0) for (let lag = minLag; lag <= maxLag; lag++) {
        const r = re[lag] / re[0] * windowAcf[0] / windowAcf[lag];
        if (r > best && r >= re[lag - 1] / re[0] * windowAcf[0] / windowAcf[lag - 1] && r >= re[lag + 1] / re[0] * windowAcf[0] / windowAcf[lag + 1]) { best = r; bestLag = lag; }
      }
      let lag = bestLag;
      if (bestLag) { // entre deux échantillons, au sommet de la parabole
        const a = re[bestLag - 1], b = re[bestLag], c = re[bestLag + 1], d = a - 2 * b + c;
        if (d < 0) lag += 0.5 * (a - c) / d;
      }
      const count = flatTo - flatFrom;
      return { bands: bands.map((v) => v / (total || 1)), centroid: weighted / (total || 1),
        flatness: count > 0 && linear > 0 ? Math.exp(logSum / count) / (linear / count) : 0, voicing: Math.min(1, best), pitch: lag ? sampleRate / lag : 0 };
    }

    // Les trames où il y a du son.
    const frames = [];
    for (let start = 0; start + N <= limit; start += hop) {
      let sum = 0;
      for (let i = 0; i < N; i++) sum += samples[start + i] * samples[start + i];
      frames.push(Math.sqrt(sum / N) >= top * 0.1 ? frame(start) : null);
    }
    const heard = frames.filter(Boolean);
    if (!heard.length) return { silent: true };
    const band = (b) => mean(heard.map((f) => f.bands[b]));

    // La note : sur deux trames voisines qui en ont une, de combien elle a bougé (en cents, les sauts d'une note à une
    // autre mis à part). Une voix glisse en permanence ; un piano, une basse, une 808 tiennent leur note.
    const moves = [];
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1], b = frames[i];
      if (!a || !b || a.voicing < 0.5 || b.voicing < 0.5) continue;
      const cents = Math.abs(1200 * Math.log2(b.pitch / a.pitch));
      if (cents < 150) moves.push(cents);
    }
    const voiced = heard.filter((f) => f.voicing >= 0.5);

    // Ce que contient chaque attaque : 50 ms à partir d'elle.
    const hits = onsets.slice(0, 200).map((i) => frame(Math.max(0, i * step - N / 8)));
    const centroids = heard.map((f) => Math.log2(f.centroid + 1));
    const spread = Math.sqrt(mean(centroids.map((v) => (v - mean(centroids)) ** 2)));

    return {
      silent: false,
      sub: band(0), low: band(1), mid: band(2), high: band(3),
      centroid: median(heard.map((f) => f.centroid)),            // le centre de gravité du spectre, en hertz
      spread,                                                     // combien il bouge d'une trame à l'autre (octaves)
      flatness: mean(heard.map((f) => f.flatness)),              // 1 : du bruit ; 0 : des notes
      both: heard.filter((f) => f.bands[0] > 0.1 && f.bands[3] > 0.25).length / heard.length, // grave et aigu en même temps
      voiced: voiced.length / heard.length,                      // part des trames qui ont une note
      pitch: median(voiced.map((f) => f.pitch)),                 // la note du milieu, en hertz
      glide: median(moves),                                      // cents par 46 ms quand la note bouge sans sauter
      onsets: onsets.length / seconds,                           // attaques par seconde
      decay: median(decays),                                     // secondes pour retomber au quart
      active,                                                    // part du temps où il y a du son
      sung,                                                      // 1 par dixième de seconde où elle sonne, tout le morceau
      hitSub: mean(hits.map((f) => f.bands[0])), hitHigh: mean(hits.map((f) => f.bands[3])),
      hitCentroid: median(hits.map((f) => f.centroid)), hitFlatness: mean(hits.map((f) => f.flatness)),
      // Des coups graves et des coups aigus dans la même piste : une batterie (la part de la plus rare des deux sortes).
      hitMix: hits.length ? Math.min(hits.filter((f) => f.bands[0] + f.bands[1] > 0.35).length, hits.filter((f) => f.bands[3] > 0.5).length) / hits.length : 0,
    };
  }
  /**
   * Le type d'après le son seul. Réglé sur des stems connus (tests/detect.mjs) : ce qui n'est clairement ni une voix,
   * ni une instru, ni frappé, ni grave, ni un effet est mélodique : piano, guitare ou synthé quand le son le dit
   * (instrument), « Melodie » sinon.
   */
  function fromSound(f) {
    if (!f || f.silent) return "Autre";
    // Une voix : pas de grave, une note presque tout le temps, qui glisse sans arrêt, et peu d'attaques franches. Une
    // note qui glisse beaucoup (> 20) ne vient que d'une voix : un peu de grave (une cabine qui ronfle) ne la trahit pas.
    if ((f.sub < 0.05 || (f.sub < 0.12 && f.glide > 20 && f.both < 0.1)) && f.low < 0.45 && f.voiced > 0.55 && f.glide > 12 && f.flatness < 0.15
      && f.onsets < 1.2 && f.pitch > 100 && f.pitch < 700) return "Lead";
    // Une voix de rap ou passée à l'autotune (réglé sur 97 voix de sessions clients) : le débit fait beaucoup d'attaques,
    // l'autotune empêche la note de glisser. Ce qui reste : une note presque tout le temps, pas de grave, de l'air dans
    // l'aigu, et un souffle (consonnes) qu'un instrument n'a pas.
    if (f.voiced > 0.7 && f.sub < 0.06 && f.high > 0.12 && f.spread > 0.25 && f.flatness > 0.004 && f.flatness < 0.12 && f.pitch > 90 && f.pitch < 800
      && (f.glide > 12 || (f.centroid > 1300 && f.flatness > 0.01))) return "Lead";
    // Une texture (nappe de bruit, grondement, particules) : un son qui tient sans jamais attaquer, et sans note tenue.
    if (f.onsets < 0.03 && f.hitMix === 0 && f.voiced < 0.5 && f.active > 0.3 && f.sub + f.low < 0.7) return "FX"; // une basse tenue n'en est pas une
    // Une instru entière : du grave et de l'aigu dans les mêmes trames, presque tout le temps, avec du rythme (une prod
    // aux attaques douces en a peu, mais son grave et son aigu ensemble restent, sans tenir une note comme une guitare).
    // Une voix qui glisse par-dessus : le morceau fini, un master (compressé, il n'a presque plus d'attaques).
    const sings = f.voiced > 0.22 && f.glide > 8 && f.pitch > 110 && f.pitch < 450; // la note d'une voix, pas d'un 808 ni d'un charley
    if (f.both > 0.1 && f.active > 0.6 && f.sub > 0.1 && (f.onsets > 0.4 || (f.both > 0.2 && (f.voiced < 0.5 || sings)))) return sings ? "Master" : "Instru";
    // Un morceau ou une prod passés au bus (master, print, instru de session) : réglé sur 80 masters et instrus de
    // sessions clients. Du sub et de l'aigu, un spectre qui change sans cesse de couleur (la voix, puis le kick, puis le
    // charley), et du son presque tout le temps : aucune piste seule n'a les trois (un kick a le spectre, pas la durée ;
    // une mélodie la durée, pas le sub).
    if (f.sub > 0.06 && f.high > 0.1 && f.spread > 0.5 && f.active > 0.45) return sings ? "Master" : "Instru";
    // Frappé : des coups qui retombent vite, ou qui laissent du silence entre eux (un kick long reste un kick).
    // Une note stable presque tout le temps, des attaques sans bruit ni sub : un instrument joué note à note (piano,
    // pluck), pas une percu (une caisse ou un tom accordés glissent, ou soufflent dans leur attaque).
    const struck = f.onsets > 0.3 && ((f.decay < 0.3 && f.active < 0.6) || f.active < 0.4)
      && !(f.voiced > 0.8 && f.hitSub < 0.18 && f.glide < 6 && f.hitFlatness < 0.03);
    // Un kick : du sub dans les coups, jamais avec un aigu frappé à part (hitMix), même si son clic éclaire la trame.
    const kick = struck && f.hitSub > 0.18 && f.hitCentroid < 2000 && f.hitMix < 0.05;
    // Une batterie entière : grave et aigu ensemble aussi, mais frappés, avec des silences entre les coups.
    if (!kick && (f.both > 0.15 || f.hitMix > 0.15) && f.onsets > 0.6 && f.active < 0.75) return "Drums";

    if (struck) {
      if (kick) return "Kick";
      if (f.hitHigh > 0.75 && f.onsets > 0.9) return "Hi-Hat";
      if (f.hitHigh > 0.4 && f.hitFlatness > 0.15) return "Snare";
      return "Perc";
    }
    // Une cymbale : de l'aigu frappé de loin en loin, qui sonne longtemps sans changer de couleur.
    if (f.high > 0.55 && f.hitHigh > 0.65 && f.onsets < 0.35 && f.spread < 0.45 && f.voiced < 0.3) return "Cymbale";
    if (f.sub + f.low > 0.7 && f.sub > 0.15) { // un piano joué grave n'a pas de sub
      // Une basse qui repart à chaque note et s'éteint lentement : une 808. Tenue : une basse.
      return f.sub > 0.6 && f.onsets > 0.4 && f.decay >= 0.25 ? "808" : "Bass";
    }
    // Un effet : rare, sans note tenue, posé ici et là (montées, impacts, bruits) ; ou un son tenu entendu deux ou trois fois.
    if ((f.onsets < 0.3 && f.voiced < 0.4 && f.active < 0.6) || (f.onsets < 0.05 && f.active < 0.1)) return "FX";
    return instrument(f) || "Melodie";
  }

  /**
   * L'instrument d'une piste mélodique, ou null quand le son ne le dit pas assez (elle reste « Melodie »). Réglé sur des
   * pianos, guitares et synthés connus (57 justes sur 66, un seul faux) et vérifié sur de vrais pianos et une nappe :
   *  - un synthé (nappe, cordes) tient le son sans jamais attaquer ;
   *  - une guitare sonne presque tout le temps, sur un spectre très large (cordes graves et aiguës ensemble) ;
   *  - un piano attaque et s'éteint, sans aigu.
   */
  function instrument(f) {
    if (f.onsets < 0.05) return "Synth";
    if (f.spread > 0.7 && f.active > 0.8) return "Guitare";
    if (f.high < 0.1 && f.spread < 0.45) return "Piano";
    return null;
  }

  /**
   * Ce qui ne se voit qu'en comparant les voix entre elles, au moment où chacune chante (features.sung). Le lead est la
   * plus présente, avec les voix nommées « lead » ; puis, de la plus présente à la moins :
   *  - qui chante quand le lead se tait est une autre partie du lead (un couplet, un refrain sur sa propre piste) ;
   *  - qui chante presque toujours avec lui le double ou l'harmonise : des backs ;
   *  - qui chante par-dessus par endroits, ou seulement quelques mots : des adlibs.
   * Réglé sur une session aux pistes nommées (LEAD VOCAL 1-3, AD LIBS 1-3). stems = [{ kind, from, features }] ;
   * ne change que les voix reconnues au son.
   */
  const VOICES = ["Lead", "Backs", "Adlibs"];
  // Un nom qui dit le rôle ; « vocal », « vox » disent seulement que c'est une voix, et le rôle reste à trouver.
  const ROLE = /lead|ad[\s_-]?libs?|(^|[^a-z])adl([^a-z]|$)|back|choeur|chœur|choir|harmon|double|dbl/i;
  function refine(stems) {
    const voices = stems.filter((s) => VOICES.includes(s.kind) && s.features && s.features.sung);
    if (!voices.length) return; // aucune voix entendue (illisibles, ou pas de voix) : rien à comparer
    const fixed = (s) => s.from === "toi" || (s.from === "nom" && ROLE.test(s.name || ""));
    const n = Math.min(...voices.map((s) => s.features.sung.length)), lead = new Uint8Array(n);
    // La même prise exportée deux fois (brute et passée par la console) : un doublon, qui suit le rôle de sa jumelle.
    // Le doublon est celle des deux dont le nom en dit le moins (« Insert 3 » plutôt que « main vocal »).
    const twins = new Map(), order = [...voices].sort((a, b) => !fromName(a.name || "") - !fromName(b.name || ""));
    order.forEach((s, i) => {
      delete s.twin;
      const twin = order.slice(0, i).find((o) => !twins.has(o) && same(o.features, s.features, n));
      if (twin) { twins.set(s, twin); s.twin = twin.name; }
    });
    const guess = voices.filter((s) => !fixed(s) && !twins.has(s)).sort((a, b) => present(b) - present(a));
    if (guess.length) {
      const add = (s) => { for (let i = 0; i < n; i++) lead[i] |= s.features.sung[i]; };
      voices.filter((s) => fixed(s) && s.kind === "Lead").forEach(add);
      if (!lead.some(Boolean)) { guess[0].kind = "Lead"; add(guess.shift()); }
      for (const s of guess) refineOne(s, lead, n, add);
    }
    for (const [s, twin] of twins) if (!fixed(s)) s.kind = twin.kind;
    for (const s of voices) if (!fixed(s)) s.from = "son"; // « vocal » disait la voix, le son a dit le rôle
  }
  function same(a, b, n) {
    let differ = 0;
    for (let i = 0; i < n; i++) differ += a.sung[i] !== b.sung[i];
    return differ < n * 0.03 && ["sub", "low", "mid", "high"].every((k) => Math.abs(a[k] - b[k]) < 0.03) && Math.abs(a.pitch - b.pitch) < 5;
  }
  function refineOne(s, lead, n, add) {
    let sung = 0, along = 0;
    for (let i = 0; i < n; i++) if (s.features.sung[i]) { sung++; along += lead[i]; }
    const share = along / (sung || 1);
    if (share < 0.12 && present(s) >= 0.05) { s.kind = "Lead"; add(s); }
    else s.kind = share > 0.7 && present(s) >= 0.05 ? "Backs" : "Adlibs"; // quelques mots sur le lead : des adlibs
  }
  const present = (s) => s.features.sung.reduce((a, b) => a + b, 0) / (s.features.sung.length || 1);

  function classify(fileName, f) {
    if (f && f.silent) return { kind: "Autre", from: "son" };
    const named = fromName(fileName);
    // « Melo », « sample », « loop » disent seulement que c'est mélodique : le son dit l'instrument, s'il le peut.
    const played = named === "Melodie" && f && instrument(f);
    if (played) return { kind: played, from: "son" };
    // « REF », « PRINT » : souvent le morceau, parfois la voix guide d'une session de voix. Le son tranche : un morceau a
    // de la musique, une voix seule non.
    if (named === "Master" && f && fromSound(f) === "Lead") return { kind: "Lead", from: "son" };
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
    const bare = (stem) => stem.name.replace(/\.[^.]+$/, ""); // sans l'extension : « Hi-Hat » avant « Hi-Hat #2 »
    const ordered = stems.map((stem, index) => ({ stem, index }))
      .sort((a, b) => KINDS.indexOf(a.stem.kind) - KINDS.indexOf(b.stem.kind) || bare(a.stem).localeCompare(bare(b.stem), "fr", { numeric: true }) || a.index - b.index);
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

  // La table des mots, en texte, pour qui reconnaît des noms ailleurs (l'app la passe à Python pour lire une template).
  const WORDS_SOURCE = WORDS.map(([kind, pattern]) => [kind, pattern.source]);
  const api = { KINDS, WORDS: WORDS_SOURCE, features, classify, refine, fromName, fromSound, instrument, names, safe, tag, zip, crc32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OniriqueStems = api;
})(typeof window !== "undefined" ? window : globalThis);
