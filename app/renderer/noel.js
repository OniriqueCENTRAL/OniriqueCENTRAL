// NOËL : l'animation du cadeau (VOCAL MINI offert du 25 au 31 décembre, server/src/noel.js), une fois par compte sur ce
// PC, à l'ouverture de l'application. Le plugin apparaît, son prix descend jusqu'à zéro, le tampon OFFERT tombe, JOYEUX
// NOËL s'allume et les confettis partent. Tout est dessiné ici (pas d'image à télécharger, à part la vignette du plugin).
import { h } from './ui.js';

const euros = (cents) => (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

/** Neige lente en fond, et confettis en rafales (burst) : un seul canvas plein écran. */
function sky(canvas) {
  const x = canvas.getContext('2d');
  const COLORS = ['#e5384a', '#ff8e9a', '#f2c14e', '#ffe7a3', '#2fbf71', '#9be8bf', '#ffffff'];
  const flakes = [], bits = [];
  let w = 0, hgt = 0, dpr = 1, last = performance.now(), frame = 0, alive = true;
  const size = () => {
    dpr = Math.min(2, devicePixelRatio || 1);
    w = canvas.clientWidth; hgt = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
  };
  size();
  addEventListener('resize', size);
  for (let i = 0; i < 90; ++i) flakes.push({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 2.2, v: 12 + Math.random() * 26, s: Math.random() * 6.28 });
  const burst = (n, fromX, fromY, spread = 1, aim = -Math.PI / 2, power = 1) => {
    for (let i = 0; i < n; ++i) {
      const a = aim + (Math.random() - 0.5) * 1.9 * spread, speed = (420 + Math.random() * 640) * power;
      bits.push({ x: fromX * w, y: fromY * hgt, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14,
        wob: Math.random() * 6.28, sz: 5 + Math.random() * 7, color: COLORS[(Math.random() * COLORS.length) | 0], shape: Math.random() < 0.18 ? 'star' : Math.random() < 0.5 ? 'rect' : 'ribbon', life: 0 });
    }
  };
  const star = (r) => {
    x.beginPath();
    for (let k = 0; k < 8; ++k) { const rr = k % 2 ? r * 0.28 : r, t = k * Math.PI / 4; x.lineTo(Math.cos(t) * rr, Math.sin(t) * rr); }
    x.closePath(); x.fill();
  };
  const tick = (t) => {
    if (!alive) return;
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, w, hgt);
    x.fillStyle = 'rgba(255, 244, 246, .55)';
    for (const f of flakes) {
      f.y += f.v * dt / hgt; f.s += dt;
      if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
      x.beginPath(); x.arc((f.x + Math.sin(f.s) * 0.006) * w, f.y * hgt, f.r, 0, 6.28); x.fill();
    }
    for (let i = bits.length - 1; i >= 0; --i) {
      const b = bits[i];
      b.life += dt; b.vy += 900 * dt; b.vx *= 1 - 1.6 * dt; b.vy *= 1 - 1.1 * dt; b.wob += dt * 9; b.rot += b.vr * dt;
      b.x += (b.vx + Math.sin(b.wob) * 40) * dt; b.y += b.vy * dt;
      if (b.y > hgt + 40 || b.life > 7) { bits.splice(i, 1); continue; }
      x.save(); x.translate(b.x, b.y); x.rotate(b.rot); x.fillStyle = b.color;
      x.globalAlpha = Math.min(1, (7 - b.life) / 1.5);
      if (b.shape === 'star') star(b.sz * 0.9);
      else if (b.shape === 'rect') { x.scale(1, Math.cos(b.wob)); x.fillRect(-b.sz / 2, -b.sz / 3, b.sz, b.sz * 0.66); }
      else { x.scale(Math.cos(b.wob), 1); x.fillRect(-b.sz * 0.15, -b.sz, b.sz * 0.3, b.sz * 2); }
      x.restore();
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return { burst, stop: () => { alive = false; cancelAnimationFrame(frame); removeEventListener('resize', size); } };
}

/**
 * L'animation, si ce compte a reçu le cadeau et ne l'a pas encore vue sur ce PC. gift : state.data.me.noel ; userId : le
 * compte ; media(path) → l'image (data:) ; open(productId) : la fiche du plugin. Rend true si l'animation est lancée.
 */
export function showNoel(gift, userId, { media, open }) {
  if (!gift || document.querySelector('.noel')) return false;
  const seenKey = 'onirique.noel.seen', seenValue = `${gift.id}:${userId}`;
  try {
    if (localStorage.getItem(seenKey) === seenValue) return false;
    localStorage.setItem(seenKey, seenValue);
  } catch { return false; }

  const canvas = h('canvas', { class: 'noel-sky', 'aria-hidden': 'true' });
  const shot = h('div', { class: 'noel-shot' }, h('span', { class: 'noel-shot-name', 'data-no-translate': '' }, gift.name.replace(/^ONIRIQUE\s+/i, '')));
  const price = h('span', { class: 'noel-price', 'data-no-translate': '' }, euros(gift.priceCents));
  const was = h('s', { class: 'noel-was', 'data-no-translate': '' }, euros(gift.priceCents));
  const stamp = h('span', { class: 'noel-stamp' }, 'OFFERT');
  // Lettre par lettre pour l’entrée, mot par mot pour le retour à la ligne (jamais au milieu de NOËL).
  const words = ['JOYEUX', 'NOËL'].map((w) => h('span', { class: 'noel-word' }, ...[...w].map((c) => h('span', null, c))));
  const letters = words.flatMap((w) => [...w.children]);
  const title = h('h2', { class: 'noel-title', 'aria-label': 'Joyeux Noël' }, ...words);
  const kicker = h('p', { class: 'noel-kicker' }, 'Cadeau de Noël');
  const text = h('p', { class: 'noel-text' }, `${gift.name} est à toi, pour toujours : un cadeau de toute l’équipe ONIRIQUE. Il t’attend dans tes plugins, prêt à installer.`);
  const timers = [];
  let fx = null, closed = false;
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const close = () => {
    if (closed) return;
    closed = true;
    timers.forEach(clearTimeout);
    removeEventListener('keydown', onKey);
    // Les clics passent tout de suite à l’application ; le calque part à la fin du fondu, quoi qu’il arrive.
    root.style.pointerEvents = 'none';
    root.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(1.02)' }], { duration: 400, easing: 'ease', fill: 'forwards' });
    setTimeout(() => { fx?.stop(); root.remove(); }, 420);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const install = h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); open(gift.productId); } }, `Installer ${gift.name.replace(/^ONIRIQUE\s+/i, '')}`);
  const thanks = h('button', { class: 'btn quiet', type: 'button', onclick: close }, 'Merci !');
  const actions = h('div', { class: 'noel-actions' }, thanks, install);
  const card = h('div', { class: 'noel-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cadeau de Noël' },
    kicker, shot, h('div', { class: 'noel-prices' }, price, was, stamp), title, text, actions);
  const root = h('div', { class: 'noel' }, canvas, card);
  document.body.append(root);
  addEventListener('keydown', onKey);
  if (gift.image) media(gift.image).then((src) => shot.prepend(h('img', { src, alt: '' }))).catch(() => {});
  fx = sky(canvas);

  // La mise en scène, par l'API Web Animations : elle joue aussi quand Windows a coupé les animations (la règle « réduire
  // les animations » de styles.css ne touche que les animations CSS). Chaque élément reste caché jusqu'à son entrée.
  const SPRING = 'cubic-bezier(.2, 1.4, .3, 1)', SMOOTH = 'cubic-bezier(.2, .8, .2, 1)';
  const play = (el, frames, delay, duration, easing = SMOOTH, extra = {}) => el.animate(frames, { delay, duration, easing, fill: 'both', ...extra });
  const rise = (el, delay, duration = 600) => play(el, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], delay, duration);
  play(root, [{ opacity: 0 }, { opacity: 1 }], 0, 500);
  rise(kicker, 300);
  play(shot, [{ opacity: 0, transform: 'scale(.6) translateY(30px) rotate(-3deg)', filter: 'blur(10px)' }, { opacity: 1, transform: 'none', filter: 'none' }], 350, 1000, SPRING);
  play(shot, [{ transform: 'translateX(-120%)' }, { transform: 'translateX(120%)' }], 850, 1600, 'ease', { pseudoElement: '::after' });
  rise(price, 1450, 500);
  play(was, [{ opacity: 0 }, { opacity: 0.9 }], 1450, 500);
  const COUNT_AT = 1950, COUNT = 1900, STAMP_AT = COUNT_AT + COUNT;
  later(COUNT_AT, () => {
    const t0 = performance.now(), from = gift.priceCents;
    const step = (t) => {
      if (closed) return;
      const k = Math.min(1, (t - t0) / COUNT), e = 1 - Math.pow(1 - k, 3);
      price.textContent = euros(Math.round(from * (1 - e)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  play(price, [{ color: '#F4ECEC' }, { color: 'rgba(244, 236, 236, .35)' }], STAMP_AT, 400, 'ease');
  play(stamp, [{ opacity: 0, transform: 'scale(2.6) rotate(-14deg)' }, { opacity: 1, transform: 'scale(.92) rotate(-7deg)', offset: 0.6 }, { opacity: 1, transform: 'scale(1) rotate(-7deg)' }],
    STAMP_AT, 550, 'cubic-bezier(.2, 1.5, .4, 1)');
  later(STAMP_AT, () => fx.burst(140, 0.5, 0.62, 1.2));
  later(STAMP_AT + 260, () => { fx.burst(90, 0.06, 1.02, 0.45, -1.15, 1.7); fx.burst(90, 0.94, 1.02, 0.45, -Math.PI + 1.15, 1.7); });
  const TITLE_AT = STAMP_AT + 500;
  letters.forEach((l, i) => {
    play(l, [{ opacity: 0, transform: 'translateY(26px) scale(.6) rotate(-8deg)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'none' }], TITLE_AT + i * 55, 700, SPRING);
    play(l, [{ textShadow: '0 0 18px rgba(229, 56, 74, .9), 0 0 42px rgba(242, 193, 78, .45)' }, { textShadow: '0 0 26px rgba(242, 193, 78, .95), 0 0 60px rgba(229, 56, 74, .6)' }],
      TITLE_AT + 1200 + i * 55, 2400, 'ease-in-out', { iterations: Infinity, direction: 'alternate', fill: 'none' });
  });
  rise(text, TITLE_AT + 900);
  rise(actions, TITLE_AT + 1050);
  later(TITLE_AT + 1100, () => install.focus());
  later(TITLE_AT + 2500, () => fx.burst(70, 0.2, 1.02, 0.5, -1.3, 1.6));
  later(TITLE_AT + 3200, () => fx.burst(70, 0.8, 1.02, 0.5, -Math.PI + 1.3, 1.6));
  return true;
}
