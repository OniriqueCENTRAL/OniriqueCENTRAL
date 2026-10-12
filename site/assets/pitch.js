// Détection de la note chantée ou jouée au micro, pour l'accordeur et la page Tessiture. Le son du micro est analysé
// dans le navigateur : rien n'est enregistré ni envoyé.
//
//   OniriquePitch.detect(samples, sampleRate)   →  { frequency, clarity } ou null (silence, bruit, pas de note nette)
//   OniriquePitch.listen(onPitch)   →  Promise d'une fonction qui coupe le micro ; onPitch reçoit { frequency, clarity } ou null
//   OniriquePitch.note(frequency, a4)   →  { midi, name, octave, cents }
window.OniriquePitch = (() => {
  const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const MIN_HZ = 60, MAX_HZ = 1600;

  /** Méthode de McLeod : autocorrélation normalisée, premier sommet net après le premier passage par zéro. */
  function detect(x, sampleRate) {
    const n = x.length;
    let energy = 0;
    for (let i = 0; i < n; i++) energy += x[i] * x[i];
    if (energy / n < 1e-5) return null; // silence

    const minLag = Math.floor(sampleRate / MAX_HZ), maxLag = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(n / 2));
    const nsdf = new Float32Array(maxLag + 2);
    for (let lag = 0; lag <= maxLag + 1; lag++) {
      let cross = 0, power = 0;
      for (let i = 0, end = n - lag; i < end; i++) { cross += x[i] * x[i + lag]; power += x[i] * x[i] + x[i + lag] * x[i + lag]; }
      nsdf[lag] = power ? 2 * cross / power : 0;
    }
    // Les sommets positifs, après que la courbe est passée une première fois sous zéro.
    let lag = 1;
    while (lag <= maxLag && nsdf[lag] > 0) lag++;
    const peaks = [];
    let best = 0;
    for (; lag <= maxLag; lag++) {
      if (nsdf[lag] > 0 && nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1] && lag >= minLag) { peaks.push(lag); if (nsdf[lag] > best) best = nsdf[lag]; }
    }
    if (best < 0.8) return null; // pas de note nette
    const chosen = peaks.find((p) => nsdf[p] >= best * 0.93); // le premier sommet presque aussi haut que le meilleur : la fondamentale, pas un multiple
    const a = nsdf[chosen - 1], b = nsdf[chosen], c = nsdf[chosen + 1], d = a - 2 * b + c;
    const exact = chosen + (d ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / d)) : 0);
    return { frequency: sampleRate / exact, clarity: b };
  }

  function note(frequency, a4 = 440) {
    const exact = 69 + 12 * Math.log2(frequency / a4), midi = Math.round(exact);
    return { midi, name: NAMES[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1, cents: Math.round((exact - midi) * 100) };
  }
  const label = (midi) => NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);

  async function listen(onPitch) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Ce navigateur ne donne pas accès au micro.");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (error) {
      throw new Error(error.name === "NotAllowedError" ? "L'accès au micro a été refusé. Autorise-le dans la barre d'adresse, puis réessaie." : "Aucun micro n'a été trouvé.");
    }
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048; // 43 ms à 48 kHz : deux périodes de la note la plus grave, sans peser sur l'affichage
    context.createMediaStreamSource(stream).connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    let running = true;
    const tick = () => {
      if (!running) return;
      analyser.getFloatTimeDomainData(buffer);
      onPitch(detect(buffer, context.sampleRate));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { running = false; stream.getTracks().forEach((track) => track.stop()); context.close(); };
  }

  return { detect, note, label, listen, NAMES };
})();
