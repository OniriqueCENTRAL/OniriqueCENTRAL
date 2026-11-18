import { h, eyebrow, button, toast, attempt, led, modal, dropdown } from '../ui.js';
import { call } from '../app.js';

// CLIPS, comme Medal : la CENTRAL garde en mémoire les dernières secondes de l'écran et du son de l'ordinateur, une
// touche en fait un clip (main/clips.js). Ici : les réglages, la bibliothèque, le lecteur avec sa coupe, et le lien
// onirique.store/clip qui se lit dans Discord.
const LENGTHS = [15, 30, 60, 120];
const QUALITIES = [['720/30', '720p · 30 i/s'], ['1080/30', '1080p · 30 i/s'], ['1080/60', '1080p · 60 i/s']];
// La coupe, faite hors du jeu, en VP8 : le serveur en refait de toute façon un MP4 pour le lien.
const MIME = () => ['video/webm;codecs=vp8,opus', 'video/webm;codecs=h264,opus'].find((m) => MediaRecorder.isTypeSupported(m));
const clock = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const mo = (bytes) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} Mo`;
const svg = (d, size = 18) => {
  const box = h('span', { class: 'op-ico', 'aria-hidden': 'true' });
  box.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  return box;
};
const ICON = {
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  pause: '<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
};

// La touche pressée, au format d'Electron. Les lettres suivent le clavier (AZERTY compris), le reste la position.
const NAMED = { NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  Space: 'Space', Tab: 'Tab', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Pause: 'Pause', PrintScreen: 'PrintScreen', ScrollLock: 'Scrolllock',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', Backslash: '\\' };
function accelerator(e) {
  const key = /^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5)
    : /^F\d{1,2}$/.test(e.code) ? e.code : /^Numpad\d$/.test(e.code) ? `num${e.code.slice(6)}` : NAMED[e.code];
  if (!key) return null;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super', key].filter(Boolean).join('+');
}
const keyLabel = (k) => k.replace('Super', 'Windows').replace('Shift', 'Maj').replace(/num(\d)$/, 'Pavé $1');

/** Les noms des micros ou des sorties de ce PC. Sans accès au micro ils n'ont pas de nom : il est demandé une fois. */
async function deviceNames(kind) {
  let list = await navigator.mediaDevices.enumerateDevices();
  if (!list.some((d) => d.kind === kind && d.label)) {
    (await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null))?.getTracks().forEach((t) => t.stop());
    list = await navigator.mediaDevices.enumerateDevices();
  }
  return [...new Set(list.filter((d) => d.kind === kind && d.label && !/^(default|communications)$/.test(d.deviceId)).map((d) => d.label))];
}
// Un appareil choisi puis débranché reste dans la liste, marqué.
const withSaved = (names, saved) => names.map((n) => [n, n]).concat(saved && !names.includes(saved) ? [[saved, `${saved} (débranché)`]] : []);

let current = null; // l'écran affiché, redessiné quand un clip arrive
window.central.onClips(() => { if (current?.isConnected()) current.refresh(); });
const refresh = () => { if (current?.isConnected()) current.refresh(); };
// Le lecteur survit aux redessins de l'application (retour dans la fenêtre après une partie…) : le clip ouvert, sa
// lecture et sa coupe restent en place.
const editorBox = h('div');
let opened = null; // le clip ouvert dans le lecteur

export function clipsView() {
  const statusBox = h('div', { class: 'stack' });
  const library = h('div', { class: 'clip-grid' });

  const drawStatus = async () => {
    const [st, inputs, outputs] = await Promise.all([call('clips:state').catch((error) => (toast(error.message, true), null)),
      deviceNames('audioinput').catch(() => []), deviceNames('audiooutput').catch(() => [])]);
    if (!st) return;
    const s = st.settings;
    const set = (patch) => attempt(async () => { await call('clips:set', patch); }).finally(drawStatus);
    const field = (label, control) => h('div', { class: 'stack clip-field' }, h('span', null, label), control);
    statusBox.replaceChildren(
      h('div', { class: 'row between wrap' },
        h('div', { class: 'row' }, led(st.running),
          h('span', null, h('b', null, st.running ? 'Les clips tournent' : 'Les clips sont coupés'), h('br'),
            h('span', { class: 'muted' }, st.running
              ? `${keyLabel(s.key)} garde les ${s.seconds} dernières secondes. Un petit son confirme le clip, sans fenêtre : ton jeu reste au premier plan.`
              : 'Rien n’est capté tant que tu ne les actives pas.'))),
        h('div', { class: 'row' },
          st.running ? button('Clipper maintenant', () => attempt(() => call('clips:now')), 'small quiet') : null,
          button(st.running ? 'Couper' : 'Activer les clips', () => set({ on: !st.running }), st.running ? 'small quiet' : 'small primary'))),
      st.problem ? h('p', { class: 'clip-problem' }, st.problem) : '',
      h('div', { class: 'clip-settings' },
        field('Durée du clip', dropdown('Durée du clip', LENGTHS.map((n) => [n, n < 60 ? `${n} secondes` : `${n / 60} minute${n > 60 ? 's' : ''}`]), s.seconds, (v) => set({ seconds: v }))),
        field('Qualité', dropdown('Qualité', QUALITIES, `${s.height}/${s.fps}`, (v) => { const [height, fps] = v.split('/').map(Number); set({ height, fps }); })),
        field('Touche', keyPicker(s.key, (k) => set({ key: k }))),
        field('Écran', dropdown('Écran', [['', 'Écran principal'], ...st.screens.map((x) => [x.id, x.name])], s.screen, (v) => set({ screen: v })))),
      h('div', { class: 'clip-settings' },
        st.tap ? field('Son capté', dropdown('Son capté', [['', 'Sortie de Windows'], ...withSaved(outputs, s.output)], s.output, (v) => set({ output: v }))) : null,
        field('Micro', dropdown('Micro', [['off', 'Pas de micro'], ['', 'Micro de Windows'], ...withSaved(inputs, s.mic === 'off' ? '' : s.mic)], s.mic, (v) => set({ mic: v }))),
        s.mic === 'off' ? null : field('Micro en mono', h('label', { class: 'check clip-mono' },
          h('input', { type: 'checkbox', checked: s.mono, onchange: (e) => set({ mono: e.target.checked }) }),
          h('span', { class: 'muted' }, 'La voix au milieu, même si le micro n’est branché que d’un côté')))),
      h('div', { class: 'row between wrap clip-dir' },
        h('span', { class: 'muted' }, 'Dossier des clips : ', h('button', { class: 'linkish', type: 'button', title: 'Ouvrir le dossier', onclick: () => call('clips:reveal') }, st.dir)),
        h('div', { class: 'row' },
          s.dir ? button('Par défaut', () => attempt(() => call('clips:pick-dir', true)).finally(drawStatus), 'small quiet') : null,
          button('Changer de dossier…', () => attempt(() => call('clips:pick-dir', false)).finally(drawStatus), 'small quiet'))),
      h('p', { class: 'muted', style: { margin: 0 } }, st.tap
        ? 'Le son capté est tout ce que joue la sortie choisie : jeu, musique, Discord. Avec Voicemeeter ou une carte son, prends celle que tu écoutes.'
        : 'Le son capté est celui de l’ordinateur : jeu, musique, Discord.'));
  };

  const drawLibrary = async () => {
    const clips = await call('clips:list').catch(() => []);
    if (!clips.length) return library.replaceChildren(h('p', { class: 'muted' }, 'Aucun clip pour l’instant. Active les clips, joue, et appuie sur la touche au bon moment.'));
    library.replaceChildren(...clips.map((c) => h('button', { class: `clip-card${opened?.name === c.name ? ' active' : ''}`, type: 'button', onclick: () => openEditor(c) },
      c.thumb ? h('img', { src: c.thumb, alt: '' }) : h('div', { class: 'clip-noimg' }),
      h('span', { class: 'clip-len' }, clock(c.duration - c.start)),
      c.shared ? h('span', { class: 'clip-online' }, 'En ligne') : null,
      h('span', { class: 'clip-meta' }, h('b', null, c.shared?.title || new Date(c.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })),
        h('small', { class: 'muted' }, `${mo(c.size)}${c.name.includes('-coupe') ? ' · coupé' : ''}`)))));
  };

  // Le lecteur : lecture, début et fin sur la même frise, puis « Enregistrer la coupe » ou « Partager » (la coupe d'abord).
  async function openEditor(clip) {
    if (opened?.url) URL.revokeObjectURL(opened.url);
    const bytes = await call('clips:read', clip.name).catch((error) => (toast(error.message, true), null));
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: clip.name.endsWith('.mp4') ? 'video/mp4' : 'video/webm' }));
    opened = { name: clip.name, url };
    refresh();
    const p = player(url, clip.duration || 0, clip.start);
    const cut = () => p.a > 0.3 || (p.total && p.b < p.total - 0.3);
    const phase = h('span', { class: 'muted', 'data-phase': `clip:${clip.name}` });
    const title = h('input', { maxLength: 100, placeholder: 'Titre du clip (facultatif)', 'aria-label': 'Titre du clip', value: clip.shared?.title || '' });
    const linkBox = h('div');
    const showLink = (name, shared) => linkBox.replaceChildren(!shared ? '' : h('div', { class: 'clip-link row between wrap' },
      h('span', null, h('span', { class: 'muted' }, 'En ligne : '), h('b', { 'data-no-translate': '' }, shared.url)),
      h('div', { class: 'row' },
        button('Copier le lien', () => attempt(() => call('clips:copy', name), 'Lien copié.'), 'small quiet'),
        button('Retirer le lien', () => modal('Retirer le lien', h('p', { class: 'muted', style: { margin: 0 } }, 'Le lien ne mènera plus à rien. Le clip reste sur ce PC.'),
          [{ label: 'Retirer', run: async () => { await call('clips:unshare', name); showLink(name, null); refresh(); } }], 'Retirer le lien'), 'small quiet'))));
    showLink(clip.name, clip.shared);

    const saveCut = async (btn) => {
      p.video.pause();
      const blob = await exportCut(url, p.a, p.b, (r) => { btn.textContent = `Coupe ${Math.round(r * 100)} %`; });
      return call('clips:save-cut', clip.name, new Uint8Array(await blob.arrayBuffer()), p.b - p.a, blob.type.split(';')[0]);
    };
    const busy = (btn, run) => async () => {
      btn.disabled = true;
      const text = btn.textContent;
      try { await run(btn); } catch (error) { toast(error.message || 'Échec.', true); }
      btn.disabled = false; btn.textContent = text; phase.textContent = '';
    };
    const cutBtn = button('Enregistrer la coupe', null, 'small quiet');
    cutBtn.onclick = busy(cutBtn, async () => { await saveCut(cutBtn); toast('Coupe enregistrée : un nouveau clip, l’original reste.'); refresh(); });
    const shareBtn = button('Partager le lien', null, 'small primary');
    shareBtn.onclick = busy(shareBtn, async () => {
      const name = cut() ? await saveCut(shareBtn) : clip.name;
      shareBtn.textContent = 'Envoi…';
      phase.dataset.phase = `clip:${name}`;
      const shared = await call('clips:share', name, title.value);
      showLink(name, shared);
      toast('Lien du clip copié : colle-le dans Discord.');
      refresh();
    });
    editorBox.replaceChildren(h('div', { class: 'panel clip-editor' },
      eyebrow('Clip'),
      p.el,
      h('div', { class: 'row wrap clip-share' }, title, shareBtn),
      phase, linkBox,
      h('div', { class: 'row wrap' }, cutBtn,
        button('Dans le dossier', () => call('clips:reveal', clip.name), 'small quiet'),
        button('Supprimer', () => modal('Supprimer ce clip', h('p', { class: 'muted', style: { margin: 0 } }, 'Il part dans la corbeille de Windows. Son lien, s’il en a un, reste en ligne.'),
          [{ label: 'Supprimer', run: async () => {
            await call('clips:delete', clip.name);
            URL.revokeObjectURL(url); opened = null; editorBox.replaceChildren(); refresh();
          } }], 'Supprimer'), 'small quiet'))));
  }

  current = { isConnected: () => library.isConnected, refresh: () => { drawStatus(); drawLibrary(); } };
  drawStatus();
  drawLibrary();
  return [
    eyebrow('Outils'),
    h('h1', null, 'Tes ', h('em', null, 'clips')),
    h('p', { class: 'lede' }, 'Comme Medal : la CENTRAL garde en mémoire les dernières secondes de ton écran et du son. Appuie sur la touche et ce moment devient un clip, à couper puis partager par un lien qui se lit dans Discord. Rien ne s’écrit sur le disque tant que tu n’appuies pas.'),
    h('div', { class: 'panel' }, eyebrow('Enregistrement'), statusBox),
    editorBox,
    h('div', { class: 'panel' }, eyebrow('Bibliothèque'), library),
  ];
}

/** La touche des clips : un clic, puis la touche voulue (avec Ctrl, Alt, Maj ou Windows si on veut). Échap annule. */
function keyPicker(value, onchange) {
  const cap = h('button', { type: 'button', class: 'keycap', title: 'Changer la touche' }, keyLabel(value));
  let listening = false;
  const stop = () => {
    listening = false;
    cap.classList.remove('listening');
    cap.textContent = keyLabel(value);
    window.removeEventListener('keydown', onKey, true);
    call('clips:key-pause', false).catch(() => {});
  };
  const onKey = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') return stop();
    if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) {
      cap.textContent = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Maj', e.metaKey && 'Windows'].filter(Boolean).join(' + ') + ' + …';
      return;
    }
    const k = accelerator(e);
    stop();
    if (k && k !== value) onchange(k);
  };
  cap.addEventListener('click', async () => {
    if (listening) return stop();
    listening = true;
    await call('clips:key-pause', true).catch(() => {});
    cap.classList.add('listening');
    cap.textContent = 'Appuie sur la touche…';
    window.addEventListener('keydown', onKey, true);
  });
  cap.addEventListener('blur', () => { if (listening) stop(); });
  return cap;
}

/** Le lecteur ONIRIQUE : la vidéo, ses boutons, et une frise où se règlent le début et la fin du clip. */
function player(url, total, start) {
  const video = h('video', { src: url, preload: 'auto', class: 'op-video', playsInline: true });
  const st = { a: start, b: total, total };
  const pct = (t) => `${total ? (t / total) * 100 : 0}%`;
  const playBtn = h('button', { type: 'button', class: 'op-btn', 'aria-label': 'Lecture' });
  const muteBtn = h('button', { type: 'button', class: 'op-btn', 'aria-label': 'Couper le son' });
  const time = h('span', { class: 'op-time' });
  const range = h('span', { class: 'op-range' });
  const sel = h('div', { class: 'op-sel' }), head = h('div', { class: 'op-head' });
  const handle = (label) => h('div', { class: 'op-h', role: 'slider', tabindex: 0, 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': Math.round(total) });
  const ha = handle('Début du clip'), hb = handle('Fin du clip');
  const track = h('div', { class: 'op-track' }, sel, ha, hb, head);
  const box = h('div', { class: 'oplayer', tabindex: 0 },
    h('div', { class: 'op-screen' }, video),
    h('div', { class: 'op-bar' }, playBtn, time, h('span', { class: 'spacer' }), range, muteBtn,
      h('button', { type: 'button', class: 'op-btn', 'aria-label': 'Plein écran', onclick: () => (document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen()).catch(() => {}) }, svg(ICON.full))),
    track);

  const paint = () => {
    const t = Math.min(total, video.currentTime || 0);
    sel.style.left = pct(st.a); sel.style.width = pct(st.b - st.a);
    ha.style.left = pct(st.a); hb.style.left = pct(st.b); head.style.left = pct(t);
    ha.setAttribute('aria-valuenow', Math.round(st.a)); ha.setAttribute('aria-valuetext', clock(st.a));
    hb.setAttribute('aria-valuenow', Math.round(st.b)); hb.setAttribute('aria-valuetext', clock(st.b));
    time.textContent = `${clock(t - st.a)} / ${clock(st.b - st.a)}`;
    range.textContent = `Coupe : ${clock(st.a)} → ${clock(st.b)}`;
    playBtn.replaceChildren(svg(video.paused ? ICON.play : ICON.pause));
    playBtn.setAttribute('aria-label', video.paused ? 'Lecture' : 'Pause');
    muteBtn.replaceChildren(svg(video.muted ? ICON.mute : ICON.sound));
  };
  const seek = (t) => { video.currentTime = Math.max(0, Math.min(total, t)); paint(); };
  const toggle = () => {
    if (!video.paused) return video.pause();
    if (video.currentTime < st.a || video.currentTime >= st.b - 0.05) video.currentTime = st.a;
    video.play().catch(() => {});
  };
  // Pendant la lecture, la frise suit chaque image ; arrivée à la fin de la coupe, la lecture s'arrête et revient au début.
  const follow = () => {
    if (video.currentTime >= st.b) { video.pause(); video.currentTime = st.a; }
    paint();
    if (!video.paused) video.requestVideoFrameCallback(follow);
  };
  video.addEventListener('play', () => { paint(); video.requestVideoFrameCallback(follow); });
  video.addEventListener('pause', paint);
  video.addEventListener('seeked', paint);
  // Aussi sans images à l'écran (fenêtre cachée par une autre) : la lecture s'arrête quand même à la fin de la coupe.
  video.addEventListener('timeupdate', () => { if (video.currentTime >= st.b) { video.pause(); video.currentTime = st.a; } paint(); });
  video.addEventListener('click', toggle);
  playBtn.addEventListener('click', toggle);
  muteBtn.addEventListener('click', () => { video.muted = !video.muted; paint(); });
  // Un WebM enregistré en direct n'annonce pas sa durée : un saut tout au bout la fait trouver au lecteur.
  video.addEventListener('loadedmetadata', () => {
    if (video.duration !== Infinity) return seek(st.a);
    video.addEventListener('durationchange', () => seek(st.a), { once: true });
    video.currentTime = 1e101;
  }, { once: true });

  const timeAt = (e) => Math.max(0, Math.min(total, ((e.clientX - track.getBoundingClientRect().left) / track.clientWidth) * total));
  const drag = (el, move) => el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    move(timeAt(e));
    const onMove = (ev) => move(timeAt(ev));
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', () => el.removeEventListener('pointermove', onMove), { once: true });
  });
  const setA = (t) => { st.a = Math.max(0, Math.min(t, st.b - 1)); seek(st.a); };
  const setB = (t) => { st.b = Math.min(total, Math.max(t, st.a + 1)); seek(Math.max(st.a, st.b - 2)); };
  drag(ha, setA);
  drag(hb, setB);
  drag(track, (t) => seek(Math.min(Math.max(t, st.a), st.b)));
  for (const [el, set, get] of [[ha, setA, () => st.a], [hb, setB, () => st.b]]) {
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 5 : 0.5;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); set(get() + (e.key === 'ArrowRight' ? step : -step)); }
    });
  }
  box.addEventListener('keydown', (e) => {
    if (e.target.closest('.op-h, button') && e.key !== ' ') return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek(video.currentTime + (e.key === 'ArrowRight' ? 5 : -5)); }
  });
  paint();
  return { el: box, video, get a() { return st.a; }, get b() { return st.b; }, total };
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
