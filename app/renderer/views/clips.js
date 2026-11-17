import { h, eyebrow, button, toast, attempt, led, modal } from '../ui.js';
import { call } from '../app.js';

// CLIPS, comme Medal : la CENTRAL garde en mémoire les dernières secondes de l'écran et du son de l'ordinateur, une
// touche en fait un clip (main/clips.js). Ici : les réglages, la bibliothèque, la coupe et le partage par ONIRIQUE ENVOI.
const LENGTHS = [15, 30, 60, 120];
const QUALITIES = [['720/30', '720p · 30 i/s'], ['1080/30', '1080p · 30 i/s'], ['1080/60', '1080p · 60 i/s']];
// La coupe, faite hors du jeu, en VP8 : le WebM que lisent le plus de téléphones et Discord.
const MIME = () => ['video/webm;codecs=vp8,opus', 'video/webm;codecs=h264,opus'].find((m) => MediaRecorder.isTypeSupported(m));
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const mo = (bytes) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} Mo`;

let current = null; // l'écran affiché, redessiné quand un clip arrive
window.central.onClips(() => { if (current?.isConnected()) current.refresh(); });

export function clipsView() {
  const statusBox = h('div', { class: 'stack' });
  const library = h('div', { class: 'clip-grid' });
  const editorBox = h('div');
  let opened = null; // le clip ouvert dans l'éditeur

  const drawStatus = async () => {
    const st = await call('clips:state').catch((error) => (toast(error.message, true), null));
    if (!st) return;
    const s = st.settings;
    const set = (patch) => attempt(async () => { await call('clips:set', patch); await drawStatus(); });
    const select = (label, value, options, onchange) => h('label', { class: 'stack', style: { gap: '6px' } }, h('span', null, label),
      h('select', { onchange: (e) => onchange(e.target.value) }, options.map(([v, text]) => h('option', { value: v, selected: v === value }, text))));
    const key = s.key;
    statusBox.replaceChildren(
      h('div', { class: 'row between wrap' },
        h('div', { class: 'row' }, led(st.running),
          h('span', null, h('b', null, st.running ? 'Les clips tournent' : 'Les clips sont coupés'), h('br'),
            h('span', { class: 'muted' }, st.running
              ? `${key} garde les ${s.seconds} dernières secondes. Un petit son confirme le clip, sans fenêtre : ton jeu reste au premier plan.`
              : 'Rien n’est capté tant que tu ne les actives pas.'))),
        h('div', { class: 'row' },
          st.running ? button('Clipper maintenant', () => attempt(() => call('clips:now')), 'small quiet') : null,
          button(st.running ? 'Couper' : 'Activer les clips', () => set({ on: !st.running }), st.running ? 'small quiet' : 'small primary'))),
      st.problem ? h('p', { class: 'clip-problem' }, st.problem) : '',
      h('div', { class: 'clip-settings' },
        select('Durée du clip', String(s.seconds), LENGTHS.map((n) => [String(n), n < 60 ? `${n} secondes` : `${n / 60} minute${n > 60 ? 's' : ''}`]), (v) => set({ seconds: Number(v) })),
        select('Qualité', `${s.height}/${s.fps}`, QUALITIES, (v) => { const [height, fps] = v.split('/').map(Number); set({ height, fps }); }),
        select('Touche', key, st.keys.map((k) => [k, k]), (v) => set({ key: v })),
        select('Écran', s.screen, [['', 'Écran principal'], ...st.screens.map((x) => [x.id, x.name])], (v) => set({ screen: v }))),
      h('p', { class: 'muted', style: { margin: 0 } }, 'Le son capté est celui de l’ordinateur (jeu, musique, Discord). Les clips vont dans ',
        h('button', { class: 'linkish', type: 'button', onclick: () => call('clips:reveal') }, st.dir), '.'));
  };

  const drawLibrary = async () => {
    const clips = await call('clips:list').catch(() => []);
    if (!clips.length) return library.replaceChildren(h('p', { class: 'muted' }, 'Aucun clip pour l’instant. Active les clips, joue, et appuie sur la touche au bon moment.'));
    library.replaceChildren(...clips.map((c) => h('button', { class: `clip-card${opened?.name === c.name ? ' active' : ''}`, type: 'button', onclick: () => openEditor(c) },
      c.thumb ? h('img', { src: c.thumb, alt: '' }) : h('div', { class: 'clip-noimg' }),
      h('span', { class: 'clip-len' }, clock(Math.max(0, c.duration - c.start))),
      h('span', { class: 'clip-meta' }, h('b', null, new Date(c.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })),
        h('small', { class: 'muted' }, `${mo(c.size)}${c.name.includes('-coupe') ? ' · coupé' : ''}`)))));
  };

  // L'éditeur : lecture, début et fin à la souris, puis « Enregistrer la coupe » ou « Partager » (la coupe d'abord).
  async function openEditor(clip) {
    if (opened?.url) URL.revokeObjectURL(opened.url);
    const bytes = await call('clips:read', clip.name).catch((error) => (toast(error.message, true), null));
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: clip.name.endsWith('.mp4') ? 'video/mp4' : 'video/webm' }));
    opened = { name: clip.name, url };
    drawLibrary();
    const total = clip.duration || 0;
    let a = clip.start, b = total;
    const video = h('video', { src: url, controls: true, preload: 'auto', class: 'clip-video' });
    const label = h('span', { class: 'muted' });
    const range = (value, onInput) => h('input', { type: 'range', min: 0, max: total, step: 0.1, value, oninput: (e) => onInput(Number(e.target.value)) });
    const showLabel = () => { label.textContent = `De ${clock(a)} à ${clock(b)} · ${clock(b - a)}`; };
    const inA = range(a, (v) => { a = Math.min(v, b - 1); inA.value = a; video.currentTime = a; showLabel(); });
    const inB = range(b, (v) => { b = Math.max(v, a + 1); inB.value = b; video.currentTime = Math.max(a, b - 2); showLabel(); });
    showLabel();
    // Un WebM enregistré en direct n'annonce pas sa durée : un saut tout au bout la fait trouver au lecteur (barre de lecture).
    video.addEventListener('loadedmetadata', () => {
      if (video.duration !== Infinity) { video.currentTime = a; return; }
      video.addEventListener('durationchange', () => { video.currentTime = a; }, { once: true });
      video.currentTime = 1e101;
    }, { once: true });
    video.addEventListener('timeupdate', () => { if (total && video.currentTime >= b) { video.pause(); video.currentTime = a; } });
    const cut = () => a > 0.3 || (total && b < total - 0.3);
    const phase = h('span', { class: 'muted', 'data-phase': `clip:${clip.name}` });
    const linkBox = h('div');

    const saveCut = async (btn) => {
      const blob = await exportCut(url, a, b, (r) => { btn.textContent = `Coupe ${Math.round(r * 100)} %`; });
      return call('clips:save-cut', clip.name, new Uint8Array(await blob.arrayBuffer()), b - a, blob.type.split(';')[0]);
    };
    const busy = (btn, run) => async () => {
      btn.disabled = true;
      const text = btn.textContent;
      try { await run(btn); } catch (error) { toast(error.message || 'Échec.', true); }
      btn.disabled = false; btn.textContent = text;
    };
    const cutBtn = button('Enregistrer la coupe', null, 'small quiet');
    cutBtn.onclick = busy(cutBtn, async () => { await saveCut(cutBtn); toast('Coupe enregistrée : un nouveau clip, l’original reste.'); drawLibrary(); });
    const shareBtn = button('Partager le lien', null, 'small primary');
    shareBtn.onclick = busy(shareBtn, async () => {
      const name = cut() ? await saveCut(shareBtn) : clip.name;
      shareBtn.textContent = 'Envoi…';
      phase.dataset.phase = `clip:${name}`;
      const link = await call('clips:share', name);
      phase.textContent = '';
      linkBox.replaceChildren(h('p', { class: 'muted', style: { margin: 0 } }, 'Lien copié, valable 30 jours : ', h('b', { 'data-no-translate': '' }, link)));
      toast('Lien du clip copié.');
      drawLibrary();
    });
    editorBox.replaceChildren(h('div', { class: 'panel clip-editor' },
      eyebrow('Clip'),
      video,
      h('div', { class: 'clip-trim' }, h('label', null, 'Début', inA), h('label', null, 'Fin', inB)),
      h('div', { class: 'row between wrap' }, label,
        h('div', { class: 'row wrap' }, cutBtn, shareBtn,
          button('Dans le dossier', () => call('clips:reveal', clip.name), 'small quiet'),
          button('Supprimer', () => modal('Supprimer ce clip', h('p', { class: 'muted', style: { margin: 0 } }, 'Il part dans la corbeille de Windows.'),
            [{ label: 'Supprimer', run: async () => {
              await call('clips:delete', clip.name);
              URL.revokeObjectURL(url); opened = null; editorBox.replaceChildren(); drawLibrary();
            } }], 'Supprimer'), 'small quiet'))),
      phase, linkBox));
  }

  current = { isConnected: () => library.isConnected, refresh: () => { drawStatus(); drawLibrary(); } };
  drawStatus();
  drawLibrary();
  return [
    eyebrow('Outils'),
    h('h1', null, 'Tes ', h('em', null, 'clips')),
    h('p', { class: 'lede' }, 'Comme Medal : la CENTRAL garde en mémoire les dernières secondes de ton écran et du son. Appuie sur la touche et ce moment devient un clip, à couper puis partager par un lien. Rien ne s’écrit sur le disque tant que tu n’appuies pas.'),
    h('div', { class: 'panel' }, eyebrow('Enregistrement'), statusBox),
    editorBox,
    h('div', { class: 'panel' }, eyebrow('Bibliothèque'), library),
  ];
}

/** Réenregistre le passage [a, b] du clip en temps réel (lecture silencieuse) : le fichier coupé, prêt à partager. */
async function exportCut(url, a, b, onProgress) {
  const video = h('video', { src: url, preload: 'auto' });
  await new Promise((ok, ko) => { video.onloadedmetadata = ok; video.onerror = () => ko(new Error('Clip illisible.')); });
  video.currentTime = a;
  await new Promise((ok) => { video.onseeked = ok; });
  const audio = new AudioContext(), out = audio.createMediaStreamDestination();
  audio.createMediaElementSource(video).connect(out); // le son part dans la coupe, pas dans les enceintes
  const mime = MIME();
  const recorder = new MediaRecorder(new MediaStream([...video.captureStream().getVideoTracks(), ...out.stream.getAudioTracks()]),
    { mimeType: mime, videoBitsPerSecond: 8e6, audioBitsPerSecond: 160e3 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  await video.play();
  recorder.start(1000); // une fois la lecture partie : pas d'image figée au début
  await new Promise((ok) => {
    // Une horloge plutôt que les images de la fenêtre : elles s'arrêtent quand la CENTRAL est cachée par une autre.
    const timer = setInterval(() => {
      onProgress(Math.min(1, (video.currentTime - a) / (b - a)));
      if (video.currentTime >= b || video.ended || video.paused) { clearInterval(timer); ok(); }
    }, 50);
  });
  video.pause();
  const stopped = new Promise((ok) => { recorder.onstop = ok; });
  recorder.stop();
  await stopped;
  audio.close();
  return new Blob(chunks, { type: mime });
}
