// Le lecteur de « Mes sons », commun à mes-sons.html (le membre) et ecoute.html (l'auditeur d'un lien) : une barre
// flottante en bas de page (pochette, forme d'onde, précédent, lecture, suivant, aléatoire, répétition, file, volume)
// et, en la dépliant, la grande forme d'onde avec les commentaires placés dessus, la vitesse et la boucle. Sur téléphone,
// la barre s'ouvre en lecteur plein écran : pochette ronde, forme d'onde qui défile sous la tête de lecture, partager,
// précédent, lecture, suivant, répétition, et en bas la file, les commentaires, les paroles et les réglages.
//
//   const player = OniriquePlayer.create({ onPlay(item), onComment(item, at, text, name) → Promise<comment>, askName,
//                                          onDelete(item, comment) → Promise, onChange(item), onShare(item) })
//   player.play(items, index)   joue une liste (un projet) à partir de ce titre ; player.enqueue(item) l'ajoute à la file
//   item : { key, id, trackId, title, feat, subtitle, cover, url, downloadUrl, duration, peaks, comments, lyrics }
//   OniriquePlayer.parseLyrics(text) → [{ at, text }] : les paroles au format LRC, at en secondes (null : ligne sans repère)
//   player.setAccent(color)      la couleur de la lecture (celle de la pochette du projet), null : la braise d'ONIRIQUE
//   OniriquePlayer.peaksOf(file) → Promise<{ peaks, duration }>, calculés dans le navigateur à l'envoi
//   OniriquePlayer.tint(url)     → Promise<{ accent, glow, deep } | null>, les couleurs tirées d'une pochette
//   OniriquePlayer.stageLabel(s) → « Maquette », « V2 », « Final », ou rien
//   OniriquePlayer.releaseLabel(d) → « Date de sortie prévue : 4 décembre 2026 » (à venir) ou « Date de sortie : … » (passée)
//   OniriquePlayer.icon(name)    → une icône SVG (play, pause, prev, next, shuffle, repeat, repeat1, queue, volume, mute,
//                                  link, more, plus, close, back, download, chevron, star)
(() => {
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter((c) => c !== null && c !== undefined));
    return node;
  };
  const time = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };

  const PATHS = {
    play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor"/>',
    pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/>',
    prev: '<path d="M18 6.5v11a.8.8 0 0 1-1.25.66L9 12.66a.8.8 0 0 1 0-1.32l7.75-5.5A.8.8 0 0 1 18 6.5Z" fill="currentColor"/><rect x="5.5" y="6" width="2.4" height="12" rx="1" fill="currentColor"/>',
    next: '<path d="M6 6.5v11a.8.8 0 0 0 1.25.66L15 12.66a.8.8 0 0 0 0-1.32l-7.75-5.5A.8.8 0 0 0 6 6.5Z" fill="currentColor"/><rect x="16.1" y="6" width="2.4" height="12" rx="1" fill="currentColor"/>',
    shuffle: '<path d="M3 7h3.5c2 0 3 1 4.2 2.8l2.6 4.4C14.5 16 15.5 17 17.5 17H21M3 17h3.5c1.4 0 2.3-.5 3.1-1.4M14.4 8.4c.8-.9 1.7-1.4 3.1-1.4H21M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    repeat: '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19m0 0-2.5-2.5M19 6l-2.5 2.5M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5m0 0 2.5 2.5M5 18l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    repeat1: '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19m0 0-2.5-2.5M19 6l-2.5 2.5M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5m0 0 2.5 2.5M5 18l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.2 10.2 12.4 9.4v5.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    queue: '<path d="M4 6h16M4 11h16M4 16h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 14.5v5l4-2.5Z" fill="currentColor"/>',
    volume: '<path d="M4 9.5h3l4.5-4v13L7 14.5H4Z" fill="currentColor"/><path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    mute: '<path d="M4 9.5h3l4.5-4v13L7 14.5H4Z" fill="currentColor"/><path d="m15.5 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    more: '<circle cx="5.5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="18.5" cy="12" r="1.7" fill="currentColor"/>',
    plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    close: '<path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    back: '<path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    chevron: '<path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
    down: '<path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    share: '<path d="M12 15V4m0 0L8 8m4-4 4 4M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    lyrics: '<path d="M12 3.5a3 3 0 0 0-3 3V12a3 3 0 0 0 6 0V6.5a3 3 0 0 0-3-3ZM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    comment: '<path d="M12 4c4.7 0 8.5 3.2 8.5 7.2S16.7 18.4 12 18.4c-1 0-2-.1-2.9-.4L4.5 20l1.3-3.7C4.3 15 3.5 13.2 3.5 11.2 3.5 7.2 7.3 4 12 4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    sliders: '<path d="M4 7h9m4 0h3M4 12h3m4 0h9M4 17h11m4 0h1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="15" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    expand: '<path d="m6 15 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    star: '<path d="M12 1.5 13.3 10.7 22.5 12 13.3 13.3 12 22.5 10.7 13.3 1.5 12 10.7 10.7Z" fill="currentColor"/>',
  };
  const icon = (name) => {
    const span = document.createElement("span");
    span.className = "op-icon";
    span.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${PATHS[name]}</svg>`;
    return span;
  };

  const css = `
.op-icon { display: inline-grid; place-items: center; line-height: 0; }
.op-pill { position: fixed; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 40; width: min(1120px, calc(100vw - 24px));
  display: flex; align-items: center; gap: 10px; padding: 8px 12px 8px 8px; border-radius: 999px; border: 1px solid rgba(255,210,214,.16);
  background: rgba(20,9,11,.95); box-shadow: 0 20px 60px -20px rgba(0,0,0,.9), 0 0 40px -18px var(--op-accent, rgba(226,52,68,.55)); }
.op-pill[hidden], .op-sheet[hidden], .op-queue[hidden], .op-comments[hidden] { display: none; }
.op-cover { flex: none; width: 44px; height: 44px; border-radius: 50%; object-fit: cover; background: linear-gradient(135deg, #5C0008, #2A0A0E); border: 1px solid rgba(255,210,214,.16); cursor: pointer; }
.op-pill.playing .op-cover { animation: op-spin 9s linear infinite; will-change: transform; }
@keyframes op-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .op-pill.playing .op-cover { animation: none; } }
.op-meta { min-width: 0; width: 170px; flex: none; cursor: pointer; line-height: 1.25; }
.op-meta b { display: block; font: 700 13px var(--f-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.op-meta b .op-feat, .op-head b .op-feat { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--line, rgba(255,210,214,.13)); background: rgba(255,255,255,.05); font: 600 10.5px/1.5 var(--f-body); color: var(--mist); vertical-align: 1px; }
.op-meta > span { display: block; font-size: 12px; color: var(--haze); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.op-mini { flex: 1; min-width: 200px; height: 44px; cursor: pointer; touch-action: none; display: block; }
.op-time { flex: none; font: 500 11px var(--f-mono); color: var(--haze); white-space: nowrap; }
.op-btn { flex: none; width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 50%; background: none; color: var(--mist); cursor: pointer; }
.op-btn:hover { background: rgba(255,255,255,.06); }
.op-btn.on { color: var(--op-accent, var(--ember)); }
.op-btn.main { width: 42px; height: 42px; background: var(--mist); color: var(--night); }
.op-btn.main:hover { background: #fff; }
.op-vol { width: 80px; accent-color: var(--op-accent, var(--ember)); min-height: 0; padding: 0; }
.op-sheet, .op-queue { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(80px + env(safe-area-inset-bottom)); z-index: 39; width: min(1120px, calc(100vw - 24px));
  max-height: min(62vh, 560px); overflow: auto; padding: 18px; border-radius: 22px; border: 1px solid rgba(255,210,214,.16);
  background: rgba(20,9,11,.97); box-shadow: 0 20px 60px -20px rgba(0,0,0,.9); display: grid; gap: 14px; }
.op-head { display: flex; align-items: center; gap: 12px; }
.op-head b { flex: 1; min-width: 0; font: 700 16px var(--f-display); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.op-wave { width: 100%; height: 110px; display: block; cursor: pointer; touch-action: none; }
.op-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; font-size: 13px; color: var(--haze); }
.op-tools label { display: inline-flex; flex-direction: row; align-items: center; gap: 8px; font: 400 13px var(--f-body); letter-spacing: 0; text-transform: none; color: var(--haze); }
.op-tools input[type=range] { width: 120px; min-height: 0; padding: 0; accent-color: var(--ember); }
.op-tools input[type=checkbox] { width: 16px; height: 16px; min-height: 0; margin: 0; accent-color: var(--ember); }
.op-chip { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px; border: 1px solid rgba(255,210,214,.16); background: none; color: var(--mist); font: 600 12px var(--f-body); cursor: pointer; text-decoration: none; }
.op-chip:hover { border-color: var(--ember); }
.op-chip.on { background: var(--op-accent, var(--ember)); border-color: var(--op-accent, var(--ember)); color: var(--night); }
.op-comments { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 14px; }
.op-comments li { display: flex; gap: 10px; align-items: baseline; }
.op-comments button.at { flex: none; font: 600 12px var(--f-mono); color: var(--ember); background: none; border: 0; padding: 0; cursor: pointer; }
.op-comments .who { color: var(--haze); }
.op-say { display: flex; flex-wrap: wrap; gap: 8px; }
.op-say input { flex: 1 1 220px; min-height: 40px; }
.op-say input.op-name { flex: 0 1 150px; }
.op-queue ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.op-queue li button { width: 100%; display: flex; align-items: center; gap: 12px; padding: 8px; border: 0; border-radius: 12px; background: none; color: var(--mist); font: 500 14px var(--f-body); text-align: left; cursor: pointer; }
.op-queue li button:hover { background: rgba(255,255,255,.05); }
.op-queue li.now button { color: var(--ember); }
.op-queue img, .op-queue .op-q-cover { width: 36px; height: 36px; border-radius: 8px; object-fit: cover; flex: none; background: linear-gradient(135deg, #5C0008, #2A0A0E); }
.op-queue small { display: block; color: var(--haze); font-size: 12px; }
@media (max-width: 1000px) { .op-vol { display: none; } .op-mini { min-width: 120px; } }
/* Les boutons : couleurs et bordures en fondu, petit enfoncement au clic, léger soulèvement des boutons principaux.
   scale / translate (et non transform) : les éléments déjà placés avec transform (barre, bouton +, panneaux) restent en place. */
button, .btn, .op-chip, a.op-chip, .tile .art, .trk, .item, .dots, .stage, .feat, .play, .round, .fab, .install, .edit-toggle, .add-bar {
  transition: background-color .22s ease, border-color .22s ease, color .22s ease, box-shadow .25s ease, opacity .2s ease, scale .16s ease, translate .22s ease; }
button:active:not(:disabled), .btn:active, .op-chip:active, .stage:active, .feat:active, .dots:active, .install:active, .edit-toggle:active { scale: .94; }
.op-btn.main:active, .round.white:active, .play-all:active, .tile .fab-play:active { scale: .9; }
.trk:active, .item:active, .add-bar:active { scale: .985; }
.tile .art:active { scale: .97; }
.btn-primary:hover, .round.white:hover, .play-all:hover, .op-btn.main:hover, .fab:hover { translate: 0 -2px; }
.tile .art:hover { translate: 0 -3px; box-shadow: 0 18px 40px -18px rgba(0,0,0,.9); }
.tile .fab-play { transition: background-color .2s ease, scale .2s ease, opacity .2s ease; }
.tile .art:hover .fab-play { scale: 1.08; }
/* Menus, fenêtres et panneaux : ouverture en fondu, avec un léger zoom ou une montée. */
@keyframes op-pop { from { opacity: 0; scale: .96; } }
@keyframes op-rise { from { opacity: 0; translate: 0 14px; } }
@keyframes op-fade { from { opacity: 0; } }
.menu { animation: op-pop .16s ease-out; transform-origin: top center; }
dialog[open] { animation: op-pop .22s cubic-bezier(.2, .8, .2, 1); }
dialog[open]::backdrop { animation: op-fade .22s ease-out; }
.op-sheet, .op-queue, .uploads { animation: op-rise .26s cubic-bezier(.2, .8, .2, 1); }
.op-pill { animation: op-rise .35s cubic-bezier(.2, .8, .2, 1); }
.details-right > *, .share-body > * { animation: op-fade .25s ease-out both; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after, dialog::backdrop { animation: none !important; transition: none !important; }
}
@media (max-width: 720px) {
  .op-pill { gap: 4px; padding-right: 8px; }
  .op-meta { width: auto; flex: 1; }
  .op-mini, .op-time, .op-hide-sm { display: none; }
}
/* Le lecteur plein écran du téléphone. */
.op-full { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; justify-content: center; gap: 18px; overflow: hidden;
  padding: calc(52px + env(safe-area-inset-top)) 14px calc(18px + env(safe-area-inset-bottom)); background: #110a0c; color: var(--mist, #f6eeee);
  animation: op-rise .3s cubic-bezier(.2, .8, .2, 1); touch-action: none; }
.op-full[hidden] { display: none; }
.op-full-bg { position: absolute; inset: -60px; z-index: -1; background-size: cover; background-position: center; filter: blur(50px) brightness(.3) saturate(1.2); }
.op-full-bg::after { content: ""; position: absolute; inset: 0; background: radial-gradient(120% 70% at 50% 35%, transparent, rgba(13,8,9,.85)); }
.op-full-top { position: absolute; top: calc(8px + env(safe-area-inset-top)); left: 10px; }
.op-full-top .op-btn { width: 44px; height: 44px; }
.op-card { position: relative; display: grid; justify-items: center; gap: 22px; padding: 26px 18px 22px; border-radius: 34px; overflow: hidden;
  background: rgba(255,236,238,.06); border: 1px solid rgba(255,210,214,.1); box-shadow: 0 30px 80px -30px rgba(0,0,0,.9); }
.op-card-title { text-align: center; max-width: 100%; }
.op-card-title b { display: block; font: 600 clamp(18px, 5.6vw, 23px)/1.25 var(--f-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.op-card-title b .op-feat { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; border: 1px solid rgba(255,210,214,.2); font: 600 11px/1.5 var(--f-body); vertical-align: 3px; }
.op-card-title span { display: block; margin-top: 4px; font-size: 15px; color: var(--haze, #b9a9ab); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.op-disc { width: min(66vw, 300px, 34vh); aspect-ratio: 1; border-radius: 50%; object-fit: cover; background: linear-gradient(135deg, #5C0008, #2A0A0E);
  border: 3px solid rgba(255,236,238,.18); box-shadow: 0 24px 60px -24px rgba(0,0,0,.95), 0 0 70px -30px var(--op-accent, #e23444); }
.op-full.playing .op-disc { animation: op-spin 14s linear infinite; }
.op-scrub { width: calc(100% + 36px); height: 64px; display: block; touch-action: none; cursor: grab; }
.op-full-time { font: 500 15px var(--f-mono, monospace); letter-spacing: .02em; }
/* Les paroles à la place de la pochette ronde ; synchronisées, la ligne chantée s'allume et reste au milieu */
.op-lyrics { width: 100%; height: min(44vh, 400px); overflow-y: auto; touch-action: pan-y; overscroll-behavior: contain; scrollbar-width: none;
  mask-image: linear-gradient(transparent, #000 14%, #000 86%, transparent); padding: 18% 2px; }
.op-full.lyrics-on .op-disc, .op-lyrics[hidden] { display: none; }
.op-lyrics p { margin: 0; padding: 5px 0; font: 700 clamp(19px, 5.4vw, 24px)/1.3 var(--f-body); color: var(--mist, #f6eeee); overflow-wrap: anywhere; }
.op-lyrics p.gap { min-height: 12px; }
.op-lyrics.synced p { color: rgba(246,238,238,.32); transition: color .25s; }
.op-lyrics.synced p.past { color: rgba(246,238,238,.6); }
.op-lyrics.synced p.on { color: #fff; }
.op-full.lyrics-on .op-lyrics { animation: op-lyrics-in .5s cubic-bezier(.2, .8, .2, 1) both; }
.op-full.lyrics-on .op-lyrics p { animation: op-lyrics-in .55s cubic-bezier(.2, .8, .2, 1) both; animation-delay: calc(var(--i, 0) * 40ms + 80ms); }
.op-full.disc-back .op-disc { animation: op-disc-in .5s cubic-bezier(.2, .8, .2, 1) both; }
.op-full.disc-back.playing .op-disc { animation: op-disc-in .5s cubic-bezier(.2, .8, .2, 1) both, op-spin 14s linear .5s infinite; }
@keyframes op-lyrics-in { from { opacity: 0; translate: 0 18px; } }
@keyframes op-disc-in { from { opacity: 0; scale: .85; } }
@media (prefers-reduced-motion: reduce) { .op-full.lyrics-on .op-lyrics, .op-full.lyrics-on .op-lyrics p, .op-full.disc-back .op-disc { animation: none; } }
.op-full-controls { width: 100%; display: flex; align-items: center; justify-content: space-between; }
.op-full-controls .op-btn { width: 52px; height: 52px; color: var(--mist, #f6eeee); }
.op-full-controls .op-btn svg { width: 28px; height: 28px; }
.op-full-controls .op-btn.big { width: 72px; height: 72px; color: #fff; }
.op-full-controls .op-btn.big svg { width: 54px; height: 54px; }
.op-full-controls .op-btn.on { color: var(--op-accent, var(--ember)); }
.op-full-bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.op-full-bar > div, .op-full-bar > button { display: flex; align-items: center; gap: 6px; height: 62px; padding: 0 10px; border-radius: 999px; background: rgba(255,236,238,.07); border: 1px solid rgba(255,210,214,.1); }
.op-full-bar .op-btn { width: 46px; height: 46px; }
.op-full-bar svg { width: 24px; height: 24px; }
.op-full-bar > button.op-settings { gap: 10px; padding: 0 22px 0 18px; color: var(--mist, #f6eeee); font: 500 17px var(--f-body); cursor: pointer; }
.op-full-bar .op-btn.on, .op-full-bar > button.on { color: var(--op-accent, var(--ember)); }
html.op-full-open, html.op-full-open body { overflow: hidden; }
/* Les paroles en grand, sur toute la page : la pochette floutée en fond, teintée de sa couleur, qui respire avec le son
   (--op-level, de 0 à 1) ; la ligne chantée s'allume, les suivantes attendent en retrait. La barre du lecteur reste dessus. */
.op-stage { position: fixed; inset: 0; z-index: 38; display: flex; flex-direction: column; overflow: hidden; isolation: isolate;
  color: var(--mist, #f6eeee); background: #0d0809; animation: op-stage-in .45s cubic-bezier(.2, .8, .2, 1) both; }
.op-stage[hidden] { display: none; }
.op-stage:focus { outline: none; }
.op-stage-bg { position: absolute; inset: -90px; z-index: -1; background: center / cover no-repeat;
  filter: blur(80px) saturate(1.5) brightness(calc(.38 + var(--op-level, 0) * .14)); transform: scale(calc(1.05 + var(--op-level, 0) * .05)); transition: transform .14s linear, filter .14s linear; }
.op-stage-bg::after { content: ""; position: absolute; inset: 0;
  background: radial-gradient(80% 60% at 18% 12%, color-mix(in srgb, var(--op-accent, #e23444) 38%, transparent), transparent 70%),
    radial-gradient(70% 55% at 90% 100%, color-mix(in srgb, var(--op-accent, #e23444) 22%, transparent), transparent 70%),
    linear-gradient(180deg, rgba(13,8,9,.25), rgba(13,8,9,.78)); }
.op-stage-top { flex: none; display: flex; align-items: center; gap: 14px; padding: calc(16px + env(safe-area-inset-top)) clamp(16px, 4vw, 48px) 8px; }
.op-stage-top img { width: 52px; height: 52px; flex: none; border-radius: 12px; object-fit: cover; box-shadow: 0 10px 30px -10px rgba(0,0,0,.9), 0 0 36px -14px var(--op-accent, #e23444); }
.op-stage-top > div { flex: 1; min-width: 0; display: grid; gap: 2px; }
.op-stage-top small { font: 500 11px/1 var(--f-mono, monospace); letter-spacing: .18em; text-transform: uppercase; color: var(--op-accent, #e23444); }
.op-stage-top b { font: 700 17px/1.25 var(--f-display, sans-serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.op-stage-top span { font-size: 13px; color: rgba(246,238,238,.62); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.op-stage-top .op-btn { width: 44px; height: 44px; border-radius: 14px; background: rgba(255,236,238,.08); }
.op-stage-lyrics { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; overscroll-behavior: contain; padding: 12vh clamp(20px, 9vw, 140px) 46vh;
  -webkit-mask-image: linear-gradient(transparent, #000 10%, #000 78%, transparent); mask-image: linear-gradient(transparent, #000 10%, #000 78%, transparent); }
.op-stage-lyrics::-webkit-scrollbar { display: none; }
.op-stage-lyrics p { max-width: 1000px; margin: 0 auto; padding: .2em 0; font: 700 clamp(26px, 3.9vw, 50px)/1.2 var(--f-display, sans-serif); letter-spacing: -.015em;
  color: rgba(255,236,238,.92); overflow-wrap: anywhere; transform-origin: left center; animation: op-lyrics-in .6s cubic-bezier(.2, .8, .2, 1) both; animation-delay: calc(var(--i, 0) * 45ms + 120ms); }
.op-stage-lyrics p.gap { min-height: .7em; }
.op-stage-lyrics p.none { font-size: clamp(18px, 2.2vw, 24px); color: rgba(246,238,238,.6); }
.op-stage-lyrics.synced p { color: rgba(255,236,238,.26); cursor: pointer; transition: color .4s, transform .4s cubic-bezier(.2, .8, .2, 1), text-shadow .2s, opacity .4s; }
.op-stage-lyrics.synced p:hover { color: rgba(255,236,238,.6); }
.op-stage-lyrics.synced p.past { color: rgba(255,236,238,.5); }
.op-stage-lyrics.synced p.on { color: #fff; transform: scale(1.03);
  text-shadow: 0 0 calc(14px + var(--op-level, 0) * 34px) color-mix(in srgb, var(--op-accent, #e23444) 75%, transparent); }
html.op-stage-open, html.op-stage-open body { overflow: hidden; }
@keyframes op-stage-in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .op-stage, .op-stage-lyrics p { animation: none; } .op-stage-bg { transform: none; transition: none; } .op-stage-lyrics.synced p.on { transform: none; } }
html.op-full-open .op-sheet, html.op-full-open .op-queue { z-index: 51; bottom: calc(92px + env(safe-area-inset-bottom)); max-height: 58vh; }
@media (max-height: 680px) { .op-card { gap: 12px; padding: 16px 14px; } .op-full { gap: 10px; } .op-scrub { height: 48px; } }
`;

  function create({ onPlay, onComment, askName, onDelete, onChange, onShare } = {}) {
    document.head.append(el("style", { textContent: css }));
    const audio = new Audio();
    audio.preload = "metadata";
    let list = [], index = -1, upNext = [], shuffle = false, repeat = "off", loop = null;
    let volume = 1, accent = "#E23444";
    try { volume = Math.min(1, Math.max(0, Number(localStorage.getItem("onirique.volume") ?? 1))); } catch {}
    audio.volume = volume;

    const btn = (name, label, extra = "") => {
      const b = el("button", { className: "op-btn " + extra, type: "button", ariaLabel: label, title: label });
      b.append(icon(name));
      return b;
    };
    const setIcon = (b, name) => b.replaceChildren(icon(name));

    // La barre.
    const cover = el("img", { className: "op-cover", alt: "" });
    const title = el("b"), sub = el("span");
    const meta = el("div", { className: "op-meta", title: "Détails" }, title, sub);
    const mini = el("canvas", { className: "op-mini", ariaLabel: "Forme d'onde : cliquer pour aller à ce moment" });
    const clock = el("span", { className: "op-time" });
    const prev = btn("prev", "Précédent"), play = btn("play", "Lecture", "main"), next = btn("next", "Suivant");
    const shuffleBtn = btn("shuffle", "Aléatoire", "op-hide-sm"), repeatBtn = btn("repeat", "Répéter", "op-hide-sm");
    const queueBtn = btn("queue", "File d'attente"), volBtn = btn("volume", "Couper le son", "op-hide-sm");
    const vol = el("input", { className: "op-vol op-hide-sm", type: "range", min: 0, max: 1, step: 0.01, value: volume, ariaLabel: "Volume" });
    const more = btn("expand", "Détails : commentaires, vitesse, boucle");
    const stageBtn = btn("lyrics", "Paroles en grand", "op-hide-sm");
    stageBtn.hidden = true;
    const pill = el("div", { className: "op-pill", hidden: true, role: "region", ariaLabel: "Lecteur" },
      cover, meta, mini, clock, prev, play, next, shuffleBtn, repeatBtn, stageBtn, queueBtn, volBtn, vol, more);

    // Le panneau déplié : grande forme d'onde, commentaires, vitesse, boucle, téléchargement.
    const sheetTitle = el("b");
    const download = el("a", { className: "op-chip", hidden: true }, icon("download"), "Télécharger");
    const closeSheet = btn("close", "Fermer");
    const wave = el("canvas", { className: "op-wave", ariaLabel: "Forme d'onde : cliquer pour aller à ce moment" });
    const speed = el("input", { type: "range", min: 50, max: 150, step: 5, value: 100 });
    const speedText = el("span", { textContent: "100 %" });
    const keepPitch = el("input", { type: "checkbox", checked: true });
    const loopA = el("button", { className: "op-chip", type: "button", textContent: "Début boucle" });
    const loopB = el("button", { className: "op-chip", type: "button", textContent: "Fin boucle" });
    const loopOff = el("button", { className: "op-chip", type: "button", textContent: "Sans boucle", hidden: true });
    const comments = el("ul", { className: "op-comments" });
    const name = el("input", { className: "op-name", placeholder: "Ton nom", maxLength: 60, ariaLabel: "Ton nom" });
    const text = el("input", { placeholder: "Un commentaire à ce moment du titre…", maxLength: 1000, ariaLabel: "Commentaire" });
    const send = el("button", { className: "op-chip", type: "submit", textContent: "Commenter" });
    const say = el("form", { className: "op-say" }, askName ? name : null, text, send);
    const sheet = el("div", { className: "op-sheet", hidden: true },
      el("div", { className: "op-head" }, sheetTitle, download, closeSheet),
      wave,
      el("div", { className: "op-tools" },
        el("label", {}, "Vitesse", speed, speedText),
        el("label", {}, keepPitch, "Garder la hauteur"),
        loopA, loopB, loopOff),
      comments, onComment ? say : null);

    // La file d'attente.
    const queueList = el("ol");
    const closeQueue = btn("close", "Fermer");
    const queue = el("div", { className: "op-queue", hidden: true },
      el("div", { className: "op-head" }, el("b", { textContent: "File d'attente" }), closeQueue), queueList);
    // Le lecteur plein écran (téléphone).
    const phone = () => matchMedia("(max-width: 720px)").matches;
    const fullBg = el("div", { className: "op-full-bg" });
    const fullClose = btn("down", "Réduire le lecteur");
    const fullTitle = el("b"), fullSub = el("span");
    const disc = el("img", { className: "op-disc", alt: "" });
    const scrub = el("canvas", { className: "op-scrub", ariaLabel: "Forme d'onde : glisser pour avancer ou reculer" });
    const fullClock = el("div", { className: "op-full-time" });
    const fullShare = btn("share", "Partager"), fullPrev = btn("prev", "Précédent"), fullPlay = btn("play", "Lecture", "big");
    const fullNext = btn("next", "Suivant"), fullRepeat = btn("repeat", "Répéter");
    const fullQueue = btn("queue", "File d'attente"), fullComments = btn("comment", "Commentaires"), fullLyricsBtn = btn("lyrics", "Paroles");
    const fullLyrics = el("div", { className: "op-lyrics", hidden: true });
    const fullSettings = el("button", { className: "op-settings", type: "button", ariaLabel: "Vitesse, boucle et téléchargement" }, icon("sliders"), "Réglages");
    const full = el("div", { className: "op-full", hidden: true, role: "dialog", ariaLabel: "Lecteur" }, fullBg,
      el("div", { className: "op-full-top" }, fullClose),
      el("div", { className: "op-card" }, el("div", { className: "op-card-title" }, fullTitle, fullSub), disc, fullLyrics, scrub, fullClock,
        el("div", { className: "op-full-controls" }, onShare ? fullShare : el("span", { style: "width:52px" }), fullPrev, fullPlay, fullNext, fullRepeat)),
      el("div", { className: "op-full-bar" }, el("div", {}, fullQueue, fullComments, fullLyricsBtn), fullSettings));
    // Les paroles en grand (ordinateur) : toute la page, la barre du lecteur par-dessus.
    const stageBg = el("div", { className: "op-stage-bg" }), stageCover = el("img", { alt: "" });
    const stageTitle = el("b"), stageSub = el("span"), stageMode = el("small");
    const stageClose = btn("close", "Fermer les paroles");
    const stageLyrics = el("div", { className: "op-stage-lyrics" });
    const stage = el("div", { className: "op-stage", hidden: true, role: "dialog", ariaLabel: "Paroles", tabIndex: -1 }, stageBg,
      el("div", { className: "op-stage-top" }, stageCover, el("div", {}, stageMode, stageTitle, stageSub), stageClose), stageLyrics);
    document.body.append(stage, full, sheet, queue, pill);

    const item = () => list[index] || null;
    const duration = () => (Number.isFinite(audio.duration) && audio.duration) || (item() && item().duration) || 0;

    function drawWave(canvas, gap, markers) {
      const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      const g = canvas.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const t = item(), d = duration(), progress = d ? audio.currentTime / d : 0;
      if (loop && d) { g.globalAlpha = .2; g.fillStyle = accent; g.fillRect(loop.a / d * w, 0, ((loop.b ?? d) - loop.a) / d * w, h); g.globalAlpha = 1; }
      const peaks = t && t.peaks && t.peaks.length ? t.peaks : null;
      const top = markers ? 8 : 0, bars = Math.max(1, Math.floor(w / gap));
      for (let i = 0; i < bars; i++) {
        const p = peaks ? peaks[Math.floor(i / bars * peaks.length)] : 0.1;
        const bh = Math.max(2, p * (h - top - 4));
        g.fillStyle = i / bars < progress ? accent : "rgba(246,238,238,.32)";
        g.fillRect(i * gap, top + (h - top - bh) / 2, Math.max(1, gap - 1), bh);
      }
      g.fillStyle = "#FFECEE";
      g.fillRect(Math.round(progress * w), top, 1.5, h - top);
      if (markers && t && d) for (const c of t.comments || []) {
        g.beginPath(); g.arc(Math.min(w - 4, Math.max(4, c.at / d * w)), 4, 3.5, 0, 7); g.fill();
      }
    }
    // La forme d'onde du plein écran : la tête de lecture reste au milieu et le titre défile dessous, STEP pixels par valeur.
    const STEP = 3;
    function drawScrub() {
      const dpr = window.devicePixelRatio || 1, w = scrub.clientWidth, h = scrub.clientHeight;
      if (!w || !h) return;
      if (scrub.width !== Math.round(w * dpr) || scrub.height !== Math.round(h * dpr)) { scrub.width = Math.round(w * dpr); scrub.height = Math.round(h * dpr); }
      const g = scrub.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const t = item(), d = duration(), peaks = t && t.peaks && t.peaks.length ? t.peaks : null;
      const n = peaks ? peaks.length : 600, at = (d ? audio.currentTime / d : 0) * n, mid = w / 2;
      const first = Math.max(0, Math.floor(at - mid / STEP)), last = Math.min(n - 1, Math.ceil(at + (w - mid) / STEP));
      for (let i = first; i <= last; i++) {
        const x = mid + (i - at) * STEP, bh = Math.max(3, (peaks ? peaks[i] : 0.1) * (h - 6));
        g.fillStyle = x < mid ? "rgba(246,238,238,.3)" : "rgba(246,238,238,.8)";
        g.fillRect(x, (h - bh) / 2, 1.5, bh);
      }
      g.fillStyle = accent;
      g.fillRect(mid - 1.5, 0, 3, h);
    }
    const draw = () => { if (!pill.hidden) drawWave(mini, 3, false); if (!sheet.hidden) drawWave(wave, 3, true); if (!full.hidden) drawScrub(); };

    function listComments() {
      const t = item();
      comments.replaceChildren(...((t && t.comments) || []).slice().sort((a, b) => a.at - b.at).map((c) => el("li", {},
        el("button", { className: "at", type: "button", textContent: time(c.at), onclick: () => { audio.currentTime = c.at; audio.play(); } }),
        el("span", {}, el("span", { className: "who", textContent: c.author + " — " }), c.body),
        onDelete ? el("button", { className: "at", type: "button", textContent: "✕", ariaLabel: "Supprimer ce commentaire", onclick: async () => {
          if (!confirm("Supprimer ce commentaire ?")) return;
          try { await onDelete(t, c); t.comments.splice(t.comments.indexOf(c), 1); listComments(); draw(); } catch (error) { alert(error.message); }
        } }) : null)));
      // Ouverts depuis le plein écran sans aucun commentaire : une ligne dit où ils apparaîtront.
      if (!comments.children.length && full.dataset.panel === "comments") comments.append(el("li", { className: "who", textContent: onComment
        ? "Pas encore de commentaire : écris le premier, il sera placé à ce moment du titre."
        : "Pas encore de commentaire. Ceux qui écoutent tes liens peuvent en laisser un à un moment précis du titre." }));
      comments.hidden = !comments.children.length || full.dataset.panel === "settings";
    }
    function listQueue() {
      const rows = list.map((t, i) => ({ t, i, now: i === index })).filter((r) => r.i >= index).concat(upNext.map((t) => ({ t, i: -1 })));
      queueList.replaceChildren(...rows.map(({ t, i, now }) => el("li", { className: now ? "now" : "" }, el("button", {
        type: "button", onclick: () => (i >= 0 ? go(i) : (upNext.splice(upNext.indexOf(t), 1), insertNext(t))),
      }, t.cover ? el("img", { src: t.cover + "?w=160", alt: "" }) : el("span", { className: "op-q-cover" }),
      el("span", {}, t.title, el("small", { textContent: (now ? "En cours · " : "") + (t.subtitle || "") }))))));
    }
    const insertNext = (t) => { list.splice(index + 1, 0, t); go(index + 1); };

    function tick() {
      const now = time(audio.currentTime) + " / " + time(duration());
      if (clock.textContent !== now) clock.textContent = fullClock.textContent = now;
      if (loop && loop.b != null && audio.currentTime >= loop.b) audio.currentTime = loop.a;
      draw(); syncLyrics(); pulse();
    }
    // Les paroles du titre en cours, redessinées quand elles changent (un titre suivant, ou des paroles enregistrées).
    // Les deux vues des paroles (plein écran du téléphone, grande scène de l'ordinateur) : chacune suit la ligne chantée
    // et la garde à sa hauteur (au milieu sur téléphone, au tiers sur la scène).
    let lyricsOn = false, lyricsOf = null;
    const lyricBoxes = [[fullLyrics, 0.5], [stageLyrics, 0.36]];
    function syncLyrics() {
      const t = item(), text = (t && t.lyrics) || "";
      if (text !== lyricsOf) {
        lyricsOf = text;
        const lines = parseLyrics(text), synced = lines.some((l) => l.at !== null);
        for (const [box] of lyricBoxes) {
          box.dataset.line = -1;
          box.classList.toggle("synced", synced);
          box.replaceChildren(...(text ? lines : []).map((l, i) => {
            const row = el("p", { className: l.text.trim() ? "" : "gap", textContent: l.text.trim() ? l.text : l.at === null ? "" : "♪" });
            row.dataset.at = l.at ?? "";
            row.style.setProperty("--i", Math.min(i, 12)); // les premières lignes arrivent l'une après l'autre
            if (l.at !== null) row.onclick = () => { audio.currentTime = l.at; audio.play().catch(() => {}); };
            return row;
          }));
          box.scrollTop = 0;
        }
        if (!text && t) stageLyrics.append(el("p", { className: "none", textContent: "Pas encore de paroles pour « " + t.title + " »." }));
        stageMode.textContent = !text ? "Paroles" : synced ? "Paroles synchronisées" : "Paroles";
        fullLyricsBtn.hidden = stageBtn.hidden = !text;
        showLyrics(lyricsOn && !!text);
      }
      const now = audio.currentTime + 0.15;
      for (const [box, at] of lyricBoxes) {
        if (!box.classList.contains("synced") || box.hidden || (box === stageLyrics && stage.hidden)) continue;
        const rows = box.children;
        let current = -1;
        for (let i = 0; i < rows.length; i++) if (rows[i].dataset.at !== "" && Number(rows[i].dataset.at) <= now) current = i;
        if (current === Number(box.dataset.line)) continue;
        box.dataset.line = current;
        for (let i = 0; i < rows.length; i++) { rows[i].classList.toggle("on", i === current); rows[i].classList.toggle("past", i < current); }
        const on = rows[current];
        if (on) box.scrollTo({ top: on.offsetTop - box.offsetTop - box.clientHeight * at + on.offsetHeight / 2, behavior: "smooth" });
      }
    }
    function showLyrics(on) {
      // La pochette revient en douceur quand on referme les paroles.
      if (!on && !fullLyrics.hidden) { full.classList.remove("disc-back"); void full.offsetWidth; full.classList.add("disc-back"); }
      fullLyrics.hidden = !on;
      full.classList.toggle("lyrics-on", on);
      fullLyricsBtn.classList.toggle("on", on);
      fullLyrics.dataset.line = -1;
    }
    // Le fond de la scène respire avec le son : l'énergie des graves, lissée, de 0 à 1. Le son passe par un analyseur
    // créé au premier affichage (il faut un geste de l'auditeur) ; s'il ne peut pas l'être, la scène reste immobile.
    let analyser = null, bins = null, level = 0;
    function listen() {
      if (analyser !== null) return;
      try {
        const context = new (window.AudioContext || window.webkitAudioContext)();
        const source = context.createMediaElementSource(audio);
        analyser = context.createAnalyser();
        analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.7;
        source.connect(analyser); analyser.connect(context.destination);
        bins = new Uint8Array(analyser.frequencyBinCount);
        audio.addEventListener("play", () => context.resume());
        context.resume();
      } catch { analyser = false; }
    }
    function pulse() {
      if (stage.hidden) return;
      let v = 0;
      if (analyser && !audio.paused) {
        analyser.getByteFrequencyData(bins);
        for (let i = 1; i < 9; i++) v += bins[i];
        v = Math.max(0, (v / 8 / 255 - 0.25) / 0.55);
      }
      level = audio.paused ? 0 : level + (Math.min(1, v) - level) * (v > level ? 0.45 : 0.12);
      stage.style.setProperty("--op-level", level.toFixed(3));
    }
    function openStage() {
      if (!item()) return;
      stage.hidden = false; sheet.hidden = queue.hidden = true;
      more.classList.remove("on"); queueBtn.classList.remove("on"); stageBtn.classList.add("on");
      document.documentElement.classList.add("op-stage-open");
      stageLyrics.dataset.line = -1;
      // Le focus quitte le bouton micro : Entrée et Espace ne le « recliquent » pas (ce qui refermerait la scène).
      stage.focus({ preventScroll: true });
      listen(); tick();
      if (audio.paused) pulse();
    }
    function closeStage() {
      stage.hidden = true; stageBtn.classList.remove("on");
      document.documentElement.classList.remove("op-stage-open");
    }
    // Pendant la lecture, la forme d'onde suit l'image (timeupdate ne tombe que ~4 fois par seconde).
    let frame = 0;
    const animate = () => { tick(); frame = audio.paused ? 0 : requestAnimationFrame(animate); };
    function show() {
      const t = item();
      pill.hidden = false;
      document.body.style.paddingBottom = "110px";
      // Le titre, avec son « feat. » en badge s'il y en a un.
      for (const node of [title, sheetTitle, fullTitle]) node.replaceChildren(t.title, t.feat ? el("span", { className: "op-feat", textContent: "feat. " + t.feat }) : "");
      sub.textContent = fullSub.textContent = t.subtitle || "";
      for (const img of [cover, disc, stageCover]) if (t.cover) img.src = t.cover + (img === disc ? "?w=960" : "?w=160"); else img.removeAttribute("src");
      stageCover.hidden = !t.cover;
      stageTitle.textContent = t.title + (t.feat ? " (feat. " + t.feat + ")" : "");
      stageSub.textContent = t.subtitle || "";
      fullBg.style.backgroundImage = stageBg.style.backgroundImage = t.cover ? `url("${t.cover}?w=960")` : "";
      download.hidden = !t.downloadUrl;
      if (t.downloadUrl) download.href = t.downloadUrl;
      listComments(); listQueue(); tick();
      if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.subtitle || "", artwork: t.cover ? [{ src: t.cover + "?w=480" }] : [] });
      if (onChange) onChange(t);
    }
    function go(i, autoplay = true) {
      if (i < 0 || i >= list.length) return;
      index = i; loop = null;
      audio.src = list[i].url;
      applySpeed(); showLoop(); show();
      if (autoplay) audio.play().catch(() => {});
    }
    // La suite : la file d'abord, puis la liste (au hasard si demandé), puis du début si la répétition est mise.
    function advance(manual) {
      if (repeat === "one" && !manual) { audio.currentTime = 0; audio.play(); return; }
      if (upNext.length) return insertNext(upNext.shift());
      if (shuffle && list.length > 1) { let j; do j = Math.floor(Math.random() * list.length); while (j === index); return go(j); }
      if (index + 1 < list.length) return go(index + 1);
      if (repeat === "all" && list.length) return go(0);
      audio.pause(); audio.currentTime = 0;
    }

    audio.addEventListener("timeupdate", tick);
    audio.addEventListener("loadedmetadata", tick);
    const playing = (on) => {
      for (const b of [play, fullPlay]) { setIcon(b, on ? "pause" : "play"); b.ariaLabel = b.title = on ? "Pause" : "Lecture"; }
      pill.classList.toggle("playing", on); full.classList.toggle("playing", on);
    };
    audio.addEventListener("play", () => { if (!frame) frame = requestAnimationFrame(animate); playing(true); });
    audio.addEventListener("pause", () => { playing(false); pulse(); });
    audio.addEventListener("ended", () => advance(false));
    let counted = null;
    audio.addEventListener("playing", () => { const t = item(); if (onPlay && t && counted !== t.key) { counted = t.key; onPlay(t); } });
    audio.addEventListener("error", () => { if (item()) sub.textContent = "Lecture impossible : recharge la page."; });
    play.onclick = () => (audio.paused ? audio.play() : audio.pause());
    prev.onclick = () => (audio.currentTime > 3 || index === 0 ? (audio.currentTime = 0) : go(index - 1));
    next.onclick = () => advance(true);
    shuffleBtn.onclick = () => { shuffle = !shuffle; shuffleBtn.classList.toggle("on", shuffle); };
    repeatBtn.onclick = () => {
      repeat = { off: "all", all: "one", one: "off" }[repeat];
      for (const b of [repeatBtn, fullRepeat]) {
        b.classList.toggle("on", repeat !== "off");
        setIcon(b, repeat === "one" ? "repeat1" : "repeat");
        b.title = b.ariaLabel = { off: "Répéter", all: "Répéter la liste", one: "Répéter le titre" }[repeat];
      }
    };
    const setVolume = (v) => {
      audio.volume = v; vol.value = v;
      setIcon(volBtn, v ? "volume" : "mute");
      try { localStorage.setItem("onirique.volume", String(v)); } catch {}
    };
    let before = volume || 1;
    vol.oninput = () => setVolume(Number(vol.value));
    volBtn.onclick = () => { if (audio.volume) { before = audio.volume; setVolume(0); } else setVolume(before); };
    // Les boutons du bas du plein écran s'allument avec le panneau qu'ils ouvrent.
    const marks = () => {
      fullQueue.classList.toggle("on", !queue.hidden);
      fullComments.classList.toggle("on", !sheet.hidden && full.dataset.panel === "comments");
      fullSettings.classList.toggle("on", !sheet.hidden && full.dataset.panel === "settings");
    };
    // Le panneau en entier (barre de l'ordinateur), ou seulement ses commentaires ou ses réglages (plein écran).
    const tools = sheet.querySelector(".op-tools");
    const part = (which) => { full.dataset.panel = which || ""; tools.hidden = wave.hidden = which === "comments"; say.hidden = comments.hidden = which === "settings"; if (which !== "settings") listComments(); };
    queueBtn.onclick = () => { queue.hidden = !queue.hidden; sheet.hidden = true; queueBtn.classList.toggle("on", !queue.hidden); listQueue(); marks(); };
    closeQueue.onclick = () => { queue.hidden = true; queueBtn.classList.remove("on"); marks(); };
    const toggleSheet = () => { part(null); sheet.hidden = !sheet.hidden; queue.hidden = true; more.classList.toggle("on", !sheet.hidden); draw(); };
    closeSheet.onclick = () => { sheet.hidden = true; more.classList.remove("on"); marks(); };

    // Le plein écran : ouvert depuis la barre sur téléphone, refermé par la flèche ou en glissant vers le bas.
    function openFull() {
      if (!item()) return;
      full.hidden = false; sheet.hidden = queue.hidden = true;
      document.documentElement.classList.add("op-full-open");
      marks(); tick();
    }
    function closeFull() {
      full.hidden = sheet.hidden = queue.hidden = true;
      document.documentElement.classList.remove("op-full-open");
      more.classList.remove("on"); queueBtn.classList.remove("on");
    }
    more.onclick = meta.onclick = cover.onclick = () => (phone() ? openFull() : toggleSheet());
    fullClose.onclick = closeFull;
    fullPlay.onclick = () => play.onclick();
    fullPrev.onclick = () => prev.onclick();
    fullNext.onclick = () => next.onclick();
    fullRepeat.onclick = () => repeatBtn.onclick();
    fullShare.onclick = () => item() && onShare(item());
    fullQueue.onclick = () => queueBtn.onclick();
    const panel = (which) => {
      if (!sheet.hidden && full.dataset.panel === which) sheet.hidden = true;
      else { part(which); sheet.hidden = false; queue.hidden = true; }
      marks(); draw();
    };
    fullComments.onclick = () => panel("comments");
    fullSettings.onclick = () => panel("settings");
    fullLyricsBtn.onclick = () => { lyricsOn = fullLyrics.hidden; showLyrics(lyricsOn); syncLyrics(); };
    stageBtn.onclick = () => (stage.hidden ? openStage() : closeStage());
    stageClose.onclick = closeStage;
    // Sur téléphone, les paroles s'ouvrent dans le plein écran : la scène se referme si la fenêtre devient étroite.
    addEventListener("resize", () => { if (!stage.hidden && phone()) closeStage(); });
    addEventListener("resize", () => { if (!full.hidden && !phone()) closeFull(); });
    // Glisser vers le bas (ailleurs que sur la forme d'onde ou un bouton) referme le plein écran.
    let swipe = null;
    full.addEventListener("pointerdown", (event) => {
      if (event.target === scrub || event.target.closest("button, input, a, .op-lyrics")) return;
      swipe = { y: event.clientY, id: event.pointerId };
    });
    full.addEventListener("pointermove", (event) => {
      if (swipe && swipe.id === event.pointerId) full.style.translate = `0 ${Math.max(0, event.clientY - swipe.y)}px`;
    });
    const endSwipe = (event) => {
      if (!swipe || swipe.id !== event.pointerId) return;
      const dy = event.clientY - swipe.y;
      swipe = null; full.style.translate = "";
      if (dy > 110) closeFull();
    };
    full.addEventListener("pointerup", endSwipe);
    full.addEventListener("pointercancel", endSwipe);
    // Glisser la forme d'onde : vers la gauche pour avancer, vers la droite pour reculer.
    let drag = null;
    scrub.addEventListener("pointerdown", (event) => { scrub.setPointerCapture(event.pointerId); drag = { x: event.clientX, t: audio.currentTime }; });
    scrub.addEventListener("pointermove", (event) => {
      const t = item(), d = duration();
      if (!drag || !d) return;
      const n = t.peaks && t.peaks.length ? t.peaks.length : 600;
      audio.currentTime = Math.max(0, Math.min(d - 0.05, drag.t - (event.clientX - drag.x) / STEP / n * d));
      tick();
    });
    scrub.addEventListener("pointerup", () => { drag = null; });
    scrub.addEventListener("pointercancel", () => { drag = null; });

    const seek = (canvas) => (event) => {
      const r = canvas.getBoundingClientRect(), d = duration();
      if (d) { audio.currentTime = Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)) * d; tick(); }
    };
    for (const c of [mini, wave]) {
      c.addEventListener("pointerdown", (event) => { seek(c)(event); c.setPointerCapture(event.pointerId); });
      c.addEventListener("pointermove", (event) => { if (event.buttons) seek(c)(event); });
    }
    function applySpeed() {
      audio.playbackRate = speed.value / 100;
      audio.preservesPitch = keepPitch.checked;
      speedText.textContent = speed.value + " %";
    }
    speed.oninput = applySpeed;
    keepPitch.onchange = applySpeed;
    function showLoop() { loopA.classList.toggle("on", !!loop); loopB.classList.toggle("on", !!(loop && loop.b != null)); loopOff.hidden = !loop; draw(); }
    loopA.onclick = () => { loop = { a: audio.currentTime, b: null }; showLoop(); };
    loopB.onclick = () => {
      if (!loop) loop = { a: 0, b: null };
      if (audio.currentTime > loop.a) loop.b = audio.currentTime;
      showLoop();
    };
    loopOff.onclick = () => { loop = null; showLoop(); };
    say.onsubmit = async (event) => {
      event.preventDefault();
      const t = item();
      if (!t || !text.value.trim()) return;
      send.disabled = true;
      try {
        const c = await onComment(t, audio.currentTime, text.value.trim(), name.value.trim());
        (t.comments ||= []).push(c);
        text.value = "";
        listComments(); draw();
      } catch (error) { alert(error.message); } finally { send.disabled = false; }
    };
    addEventListener("resize", draw);
    document.addEventListener("keydown", (event) => {
      if (document.querySelector("dialog[open]")) return;
      // Sur les paroles en grand, Entrée et Espace lancent ou mettent en pause, même si un bouton du lecteur a gardé le focus.
      const onStage = !stage.hidden && (event.key === "Enter" || event.code === "Space") && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
      if (onStage || (event.code === "Space" && item() && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName))) { event.preventDefault(); play.onclick(); }
      if (event.key === "Escape" && !stage.hidden) closeStage();
    });
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("previoustrack", () => prev.onclick());
      navigator.mediaSession.setActionHandler("nexttrack", () => next.onclick());
    }

    return {
      audio,
      get item() { return item(); },
      get playing() { return !audio.paused; },
      play(items, i = 0, autoplay = true) {
        const same = item() && items[i] && items[i].key === item().key && items[i].url === item().url;
        list = items.slice();
        if (same) { index = i; listQueue(); if (autoplay) audio.play(); return; }
        go(i, autoplay);
      },
      toggle() { play.onclick(); },
      enqueue(t) { upNext.push(t); if (index < 0) { list = []; insertNext(upNext.shift()); } listQueue(); },
      openDetails() { if (phone()) { openFull(); panel("comments"); } else if (sheet.hidden) toggleSheet(); },
      setAccent(color) {
        accent = color || "#E23444";
        for (const node of [pill, sheet, queue, stage]) node.style.setProperty("--op-accent", accent);
        draw();
      },
      redraw() { if (item()) { listComments(); draw(); } },
    };
  }

  /** La forme d'onde (600 valeurs entre 0 et 1) et la durée d'un fichier, lus dans le navigateur ; null si le format ne se décode pas. */
  async function peaksOf(file) {
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      context.close();
      const data = buffer.getChannelData(0), n = 600, size = Math.max(1, Math.floor(data.length / n)), peaks = [];
      for (let i = 0; i < n; i++) {
        let max = 0;
        for (let j = i * size, end = Math.min(data.length, j + size); j < end; j += 4) max = Math.max(max, Math.abs(data[j]));
        peaks.push(max);
      }
      const top = Math.max(...peaks) || 1;
      return { peaks: peaks.map((p) => Math.round(p / top * 1000) / 1000), duration: buffer.duration };
    } catch {
      return null;
    }
  }

  /** Les couleurs d'une pochette : la teinte dominante (pondérée par sa saturation), éclaircie pour l'accent, assombrie
   *  pour le fond. Une pochette en noir et blanc donne un thème gris. null si l'image ne se lit pas. */
  function tint(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = c.height = 40;
          const g = c.getContext("2d", { willReadFrequently: true });
          g.drawImage(img, 0, 0, 40, 40);
          const px = g.getImageData(0, 0, 40, 40).data;
          let x = 0, y = 0, weight = 0, sat = 0, n = 0;
          for (let i = 0; i < px.length; i += 4) {
            const [h, s, l] = hsl(px[i], px[i + 1], px[i + 2]);
            const w = s * (1 - Math.abs(l - 0.5) * 1.6);
            if (w > 0) { x += Math.cos(h * 2 * Math.PI) * w; y += Math.sin(h * 2 * Math.PI) * w; weight += w; }
            sat += s; n++;
          }
          const hue = Math.round(((Math.atan2(y, x) / (2 * Math.PI)) + 1) % 1 * 360);
          const grey = weight / n < 0.06 || sat / n < 0.1;
          resolve(grey
            ? { accent: "hsl(0 0% 82%)", glow: "hsla(0, 0%, 55%, .55)", deep: "hsla(0, 0%, 20%, .5)" }
            : { accent: `hsl(${hue} 78% 62%)`, glow: `hsla(${hue}, 80%, 40%, .8)`, deep: `hsla(${hue}, 90%, 18%, .5)` });
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url + "?w=160"; // 40 px lus : inutile de décoder la pochette entière
    });
  }
  function hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  // « [mm:ss.cc] texte » : une ligne synchronisée ; sans repère, la ligne s'affiche sans suivre la lecture.
  const parseLyrics = (text) => (text || "").split("\n").map((line) => {
    const m = line.match(/^\[(\d+):(\d{1,2}(?:\.\d+)?)\]\s?/);
    return { at: m ? Number(m[1]) * 60 + Number(m[2]) : null, text: m ? line.slice(m[0].length) : line };
  });
  const stageLabel = (s) => (s === "maquette" ? "Maquette" : s === "final" ? "Final" : /^v\d+$/.test(s || "") ? s.toUpperCase() : "");

  const releaseLabel = (day) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || "");
    if (!m) return "";
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), today = new Date();
    today.setHours(0, 0, 0, 0);
    const text = date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    return date > today ? `Date de sortie prévue : ${text}` : `Date de sortie : ${text}`;
  };

  window.OniriquePlayer = { create, peaksOf, time, icon, tint, stageLabel, releaseLabel, parseLyrics };
})();
