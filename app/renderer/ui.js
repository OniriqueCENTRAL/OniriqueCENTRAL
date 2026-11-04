// Petits outils d'interface : création d'éléments, formats, notifications, fenêtres modales.

/** h('div', { class: 'x', onclick }, enfants...) — le texte passe toujours par textContent. */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') Object.entries(value).forEach(([k, v]) => el.style.setProperty(k, v));
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  // Un <select> ne retient sa valeur qu'une fois ses options en place.
  if (tag === 'select' && props?.value !== undefined) el.value = props.value;
  return el;
}

/** L'avatar par défaut d'un compte sans photo, à la charte (le même dessin que sur le site : site/assets/account.js). */
export function defaultAvatar(user) {
  const seed = Number(user && user.id) || 0;
  const spark = (i) => {
    const a = (seed * 47 + i * 137) % 360 * Math.PI / 180, r = 27 + (seed * 7 + i * 5) % 9, s = 2.2 + (seed + i) % 3 * 0.7;
    const x = 48 + Math.cos(a) * r, y = 48 + Math.sin(a) * r;
    return `<path d="M${x} ${y - s}L${x + s * 0.2} ${y - s * 0.2}L${x + s} ${y}L${x + s * 0.2} ${y + s * 0.2}L${x} ${y + s}L${x - s * 0.2} ${y + s * 0.2}L${x - s} ${y}L${x - s * 0.2} ${y - s * 0.2}Z" fill="#ffd2d6" opacity=".8"/>`;
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<defs>
<radialGradient id="n" cx="50%" cy="12%" r="100%"><stop offset="0" stop-color="#9a0a1a"/><stop offset=".42" stop-color="#3a0509"/><stop offset="1" stop-color="#0d0809"/></radialGradient>
<radialGradient id="h" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ff5a68" stop-opacity=".9"/><stop offset=".55" stop-color="#e23444" stop-opacity=".35"/><stop offset="1" stop-color="#e23444" stop-opacity="0"/></radialGradient>
</defs>
<rect width="96" height="96" fill="url(#n)"/>
<circle cx="48" cy="48" r="34" fill="url(#h)"/>
<g fill="none" stroke="#ffd2d6" transform="rotate(${seed * 53 % 360} 48 48)">
<circle cx="48" cy="48" r="35" stroke-opacity=".34" stroke-width="1" stroke-dasharray="46 10 14 10 30 13"/>
<circle cx="48" cy="48" r="42" stroke-opacity=".2" stroke-width=".8" stroke-dasharray="1.5 6"/>
</g>
<path d="M48 16L51.6 44.4L80 48L51.6 51.6L48 80L44.4 51.6L16 48L44.4 44.4Z" fill="#e23444" opacity=".55" transform="translate(48 48) scale(1.28) translate(-48 -48)"/>
<path d="M48 16L51.6 44.4L80 48L51.6 51.6L48 80L44.4 51.6L16 48L44.4 44.4Z" fill="#f6eeee"/>
${spark(1)}${spark(2)}${spark(3)}
</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

/** Le potard « Étoile » de la charte : piste, arc braise, corps sombre, deux étoiles qui tournent avec la valeur (0 à 1). */
export function starKnob(value = 0.62, size = 150) {
  const svg = `<svg class="star-knob" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
<defs><radialGradient id="kb" cx="32%" cy="30%" r="80%"><stop offset="0" stop-color="#36161a"/><stop offset=".6" stop-color="#160a0c"/><stop offset="1" stop-color="#080405"/></radialGradient></defs>
<circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,236,238,.12)" stroke-width="3" stroke-dasharray="207.3 277" stroke-linecap="round" transform="rotate(135 50 50)"/>
<circle class="arc" cx="50" cy="50" r="44" fill="none" stroke="#E23444" stroke-width="3" stroke-dasharray="0 277" stroke-linecap="round" transform="rotate(135 50 50)"/>
<circle class="shade" cx="50" cy="52.5" r="32.6" fill="rgba(0,0,0,.7)"/>
<circle cx="50" cy="50" r="32.6" fill="url(#kb)" stroke="rgba(255,220,225,.08)" stroke-width=".5"/>
<g class="cap"><path d="M50 2 Q50.45 5.55 54 6 Q50.45 6.45 50 10 Q49.55 6.45 46 6 Q49.55 5.55 50 2Z" fill="#FFECEE"/>
<path d="M50 30.6 Q52.19 47.81 69.4 50 Q52.19 52.19 50 69.4 Q47.81 52.19 30.6 50 Q47.81 47.81 50 30.6Z" fill="#FFECEE"/></g></svg>`;
  const box = h('div', { class: 'hero' });
  box.innerHTML = svg; // dessin fixe, aucune donnée extérieure
  // Le potard monte à sa valeur à l'arrivée, comme un module qui s'allume.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    box.querySelector('.arc').setAttribute('stroke-dasharray', `${(207.3 * value).toFixed(1)} 277`);
    box.querySelector('.cap').style.transform = `rotate(${-135 + 270 * value}deg)`;
  }));
  return box;
}

/** Icônes au trait (24 × 24, trait rose) des rubriques. */
const ICONS = {
  plugins: 'M3 17a9 9 0 0 1 18 0M12 17l4.5-6.5',
  licenses: 'M15.5 8.5a3.5 3.5 0 1 1-7 0a3.5 3.5 0 0 1 7 0M12 12v9M12 17h3M12 20h2',
  subscription: 'M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4',
  support: 'M4 5h16v11H9l-5 4z',
  admin: 'M6 4v16M12 4v16M18 4v16M4 9h4M10 15h4M16 7h4',
  'support-admin': 'M4 14a8 8 0 0 1 16 0M4 14v5h3v-6H4M20 14v5h-3v-6h3',
  cut: 'M9 6a3 3 0 1 1-6 0a3 3 0 0 1 6 0M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0M8.2 7.8L20 18M8.2 16.2L20 6',
  cloud: 'M7 18a4.5 4.5 0 0 1-.6-9a6 6 0 0 1 11.4 1.5A3.8 3.8 0 0 1 17.5 18z',
  self: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
};
export function navIcon(name) {
  const box = h('span', { class: 'ico', 'aria-hidden': 'true' });
  box.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></svg>`;
  return box;
}

export const star = () => h('span', { class: 'star' });
export const eyebrow = (text) => h('div', { class: 'eyebrow' }, star(), text);
export const led = (on) => h('span', { class: `led${on ? ' on' : ''}` });
export const pill = (text, kind = '', withLed = null) =>
  h('span', { class: `pill ${kind}` }, withLed === null ? null : led(withLed), text);

/** "ONIRIQUE TUNER" → ONIRIQUE en capitales larges, Tuner en gothique, comme sur les plugins. */
export function productName(name, big = false) {
  const [first, ...rest] = name.trim().split(/\s+/);
  const tail = rest.join(' ').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  return h('div', { class: `product-name${big ? ' big' : ''}` }, h('b', null, first), tail && h('i', null, tail));
}

export function field(label, control) {
  return h('label', { class: 'field' }, h('span', null, label), control);
}

export function button(label, onclick, kind = '', props = {}) {
  return h('button', { class: `btn ${kind}`, type: 'button', onclick, ...props }, label);
}

//------------------------------------------------------------------------------
export const euros = (cents) => (cents === 0 ? 'Gratuit'
  : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100));
export const date = (ms) => (ms ? new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} Mo`;
export const dateInputValue = (ms) => (ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '');
/** Fin de la journée choisie, heure locale. */
export const dateInputToMs = (value) => (value ? new Date(`${value}T23:59:59`).getTime() : null);

export function compareVersions(a, b) {
  const pa = String(a).split(/[.\-+]/), pb = String(b).split(/[.\-+]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0', y = pb[i] ?? '0';
    const diff = Number.isNaN(Number(x)) || Number.isNaN(Number(y)) ? x.localeCompare(y) : Number(x) - Number(y);
    if (diff) return diff;
  }
  return 0;
}

export const LICENSE_TYPES = { perpetual: 'Perpétuelle', timed: 'Durée limitée', trial: 'Essai', nfr: 'NFR', subscription: 'Abonnement', vip: 'Offert' };

/** Les rôles d'un compte, tels qu'ils s'affichent. */
export const ROLES = { user: 'Utilisateur', vip: 'ONIRIQUE', abrasion: 'Abrasion', relic: 'Relic', admin: 'Admin', founder: 'Fondateur' };
export const isStaff = (user) => user.role === 'admin' || user.role === 'founder';
/** Qui ouvre le panel admin : l'équipe, en entier ; un partenaire, pour ses propres plugins. */
export const hasPanel = (user) => isStaff(user) || (user.role !== 'onirique' && user.role in CREATORS);
/** Les créateurs des plugins : ONIRIQUE, ou un partenaire (dont le rôle porte le même nom). */
export const CREATORS = { onirique: 'ONIRIQUE', abrasion: 'ABRASION', relic: 'RELIC' };
/** Le nom d'un rôle ; un rôle que cette version ne connaît pas encore s'écrit au moins avec sa majuscule. */
export const roleName = (role) => ROLES[role] ?? String(role).charAt(0).toUpperCase() + String(role).slice(1);

//------------------------------------------------------------------------------
export function toast(message, isError = false) {
  const el = h('div', { class: `toast${isError ? ' error' : ''}` }, led(true), message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), isError ? 7000 : 3500);
}

/** Exécute une action ; en cas d'échec, affiche le message et renvoie undefined. */
export async function attempt(action, success) {
  try {
    const result = await action();
    if (success) toast(success);
    return result ?? true;
  } catch (error) {
    toast(error.message, true);
    return undefined;
  }
}

const overlay = () => document.getElementById('overlay');
export function closeModal() {
  overlay().replaceChildren();
}

/** Ouvre une fenêtre modale. `actions` : [{ label, kind, run }] — run renvoie false pour la laisser ouverte. */
export function modal(title, body, actions = [], label = 'Confirmation') {
  const buttons = h('div', { class: 'buttons' },
    button('Annuler', closeModal, 'quiet'),
    actions.map(({ label: text, kind = 'primary', run }) => {
      const b = button(text, async () => {
        b.disabled = true;
        const keepOpen = (await run()) === false;
        b.disabled = false;
        if (!keepOpen) closeModal();
      }, kind);
      return b;
    }));
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, eyebrow(label), h('h2', null, title), body, buttons);
  overlay().replaceChildren(box);
  (box.querySelector('input, select, textarea') || box.querySelector('.btn.primary'))?.focus();
}

export function confirm(title, text, label, run, kind = 'primary') {
  modal(title, h('p', { class: 'muted' }, text), [{ label, kind, run }]);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});
overlay().addEventListener('mousedown', (event) => {
  if (event.target === overlay()) closeModal();
});
