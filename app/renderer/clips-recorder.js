// L'enregistreur des clips, dans une fenêtre cachée (main/clips.js). Comme Medal : l'écran et le son de l'ordinateur
// restent en mémoire, rien ne s'écrit sur le disque tant qu'on n'appuie pas sur la touche.
// Deux enregistreurs se relaient : un nouveau démarre toutes les `seconds` secondes et le plus vieux s'arrête, si bien
// que l'un d'eux a toujours commencé au moins `seconds` secondes avant l'appui. Le clip garde ce début en trop (entre 0
// et `seconds` secondes), noté dans `start` : la bibliothèque s'ouvre au bon endroit et la coupe le retire.

/** L'enregistreur le plus récent qui couvre les `seconds` dernières secondes, sinon le plus ancien (juste après le lancement). */
function pick(recs, t, seconds) {
  return recs.filter((r) => r.at <= t - seconds * 1000).at(-1) || recs[0] || null;
}

if (typeof module !== 'undefined') module.exports = { pick };
else run();

async function run() {
  const q = new URLSearchParams(location.search);
  const seconds = Number(q.get('seconds')), fps = Number(q.get('fps')), height = Number(q.get('height'));
  let screen;
  try {
    // La capture « desktop » d'Electron : sans clic à faire (la fenêtre est cachée), avec le son de l'ordinateur sous Windows.
    const video = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: q.get('source'), maxFrameRate: fps, maxHeight: height } };
    screen = await navigator.mediaDevices.getUserMedia({ video, audio: q.get('audio') === '1' ? { mandatory: { chromeMediaSource: 'desktop' } } : false });
  } catch (error) {
    return window.clipsRec.error(`L'écran n'a pas pu être capté (${error.message}).`);
  }
  screen.getVideoTracks()[0].addEventListener('ended', () => window.clipsRec.error("L'écran capté a disparu (débranché ?)."));
  let sound;
  try { sound = await soundTrack(screen, q); } catch (error) { return window.clipsRec.error(`Le son n'a pas pu être capté (${error.message}).`); }
  const stream = new MediaStream([...screen.getVideoTracks(), ...sound]);
  // H.264 d'abord : l'encodeur de la carte graphique s'en charge, le jeu garde le processeur. En WebM : un MP4 pris en
  // cours d'enregistrement annonce une durée fausse, et le lecteur ne va pas plus loin.
  const mime = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus']
    .find((m) => MediaRecorder.isTypeSupported(m));
  const bitrate = height >= 1080 ? (fps > 30 ? 12e6 : 8e6) : 5e6;
  const recs = [];
  const launch = () => {
    const entry = { at: Date.now(), chunks: [], rec: new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 160e3 }) };
    entry.rec.ondataavailable = (e) => { if (e.data.size) entry.chunks.push(e.data); };
    entry.rec.start(1000);
    recs.push(entry);
    while (recs.length > 2) recs.shift().rec.stop();
  };
  launch();
  setInterval(launch, seconds * 1000);

  let busy = false;
  window.clipsRec.onSave(async () => {
    const t = Date.now(), r = pick(recs, t, seconds);
    if (!r || busy) return;
    busy = true;
    try {
      // Les dernières images arrivent avant d'assembler le fichier ; l'enregistreur, lui, continue.
      await new Promise((ok) => { r.rec.addEventListener('dataavailable', ok, { once: true }); r.rec.requestData(); });
      const blob = new Blob(r.chunks, { type: mime });
      const duration = (t - r.at) / 1000;
      window.clipsRec.saved(new Uint8Array(await blob.arrayBuffer()),
        { at: t, duration, start: Math.max(0, duration - seconds), mime: mime.split(';')[0], thumb: await thumb(stream) });
      blip();
    } catch (error) {
      window.clipsRec.error(`Le clip n'a pas pu être enregistré (${error.message}).`);
    } finally { busy = false; }
  });
}

/** La piste son du clip : le son de l'ordinateur (ou d'une sortie choisie) et, si on veut, le micro, mélangés. */
async function soundTrack(screen, q) {
  const ctx = new AudioContext({ sampleRate: 48000 }), mix = ctx.createMediaStreamDestination();
  let sources = 0;
  if (q.get('pcm') === '1') {
    await ctx.audioWorklet.addModule('clips-pcm-worklet.js');
    const node = new AudioWorkletNode(ctx, 'clips-pcm', { outputChannelCount: [2] });
    window.clipsRec.onPcm((u8) => { const b = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength); node.port.postMessage(b, [b]); });
    node.connect(mix);
    sources++;
  } else if (screen.getAudioTracks().length) {
    ctx.createMediaStreamSource(new MediaStream(screen.getAudioTracks())).connect(mix);
    sources++;
  }
  const mic = q.get('mic');
  if (mic !== 'off') {
    try {
      let deviceId;
      if (mic) {
        // Les micros n'ont de nom qu'une fois l'accès donné : une première demande, puis celui qui porte ce nom.
        (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
        deviceId = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.label === mic)?.deviceId;
        if (!deviceId) throw new Error(`« ${mic} » n'est pas branché`);
      }
      // Pas d'annulation d'écho : elle retirerait du micro le son du jeu… et parfois la voix avec.
      const voice = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: true, autoGainControl: false } });
      let node = ctx.createMediaStreamSource(voice);
      if (q.get('mono') === '1') {
        // Mono : la gauche et la droite additionnées sur une seule voie, puis remises des deux côtés. Un micro branché sur
        // une seule entrée de la carte son s'entend alors au milieu, au lieu d'une seule oreille.
        const split = ctx.createChannelSplitter(2), sum = ctx.createGain();
        sum.channelCount = 1; sum.channelCountMode = 'explicit'; sum.channelInterpretation = 'discrete';
        node.connect(split);
        split.connect(sum, 0); split.connect(sum, 1);
        node = sum;
      }
      node.connect(mix);
      sources++;
    } catch (error) {
      window.clipsRec.warn(`Le micro n'est pas capté (${error.message}) : le clip garde l'écran et le son de l'ordinateur.`);
    }
  }
  return sources ? mix.stream.getAudioTracks() : [];
}

/** L'image du moment, en petit, pour la bibliothèque. */
async function thumb(stream) {
  try {
    const frame = await new ImageCapture(stream.getVideoTracks()[0]).grabFrame();
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = Math.round(320 * frame.height / frame.width);
    canvas.getContext('2d').drawImage(frame, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch { return null; }
}

/** Le signal qu'un clip est pris : deux notes brèves, sans fenêtre ni notification (le jeu garde le premier plan). */
function blip() {
  const ctx = new AudioContext(), gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.value = 0.12;
  [880, 1320].forEach((f, i) => {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    o.connect(gain);
    o.start(ctx.currentTime + i * 0.09);
    o.stop(ctx.currentTime + i * 0.09 + 0.08);
  });
  setTimeout(() => ctx.close(), 400);
}
