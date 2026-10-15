import { h, star, toast, eyebrow, button, attempt, ROLES, isStaff, hasPanel, defaultAvatar } from './ui.js';
import { authView, offlineView } from './views/auth.js';
import { libraryView, detailView, status } from './views/library.js';
import { licensesView } from './views/licenses.js';
import { subscriptionView } from './views/subscription.js';
import { accountView } from './views/account.js';
import { adminView, fillMissingDemos } from './views/admin.js';
import { supportView } from './views/support.js';
import { supportAdminView } from './views/support-admin.js';

const central = window.central;

/** État de l'application : `data` est la dernière réponse de `load`, `route` l'écran affiché. */
export const state = {
  data: null,
  offline: null,
  route: { name: 'plugins', id: null },
  busy: {},          // productId → { phase, ratio } pendant une installation
  adminTab: 'overview',
  update: null,      // version téléchargée, installée à la prochaine fermeture
};

export const call = (channel, ...args) => central.call(channel, ...args);

export function go(name, id = null) {
  state.route = { name, id };
  render();
  document.querySelector('.main')?.scrollTo(0, 0);
}

let lastLoad = 0;
export async function refresh() {
  try {
    state.data = await call('load');
    state.offline = null;
  } catch (error) {
    state.offline = error.message;
  }
  lastLoad = Date.now();
  render();
  fillMissingDemos();
}

//------------------------------------------------------------------------------
const icon = (path) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 10 10');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
};

/** Le globe de la langue, dessiné (une icône d'emoji ferait générique). */
export function globe(size = 13) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'lang-globe');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z' }]]) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries({ ...attrs, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7 })) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

/** FR | EN : français par défaut, anglais au choix (i18n.js, le même moteur que le site). La pastille ne se traduit pas. */
function langSwitch() {
  const i18n = window.OniriqueI18n;
  const current = i18n?.lang || 'fr';
  return h('div', { class: 'lang-switch', role: 'group', 'aria-label': 'Langue / Language', 'data-no-translate': '' },
    globe(),
    ...[['fr', 'FR', 'Français'], ['en', 'EN', 'English']].map(([code, label, title]) => h('button', {
      lang: code, title, 'aria-pressed': String(current === code),
      onclick: () => { if (i18n && current !== code) i18n.set(code); },
    }, label)));
}

function titlebar() {
  const mac = central.platform === 'darwin'; // macOS dessine ses propres boutons, à gauche
  return h('header', { class: `titlebar${mac ? ' mac' : ''}` },
    h('img', { class: 'sigil', src: 'assets/sigil.png', alt: '' }),
    h('div', { class: 'wordmark' }, h('b', null, 'ONIRIQUE'), h('i', null, 'Central')),
    h('div', { class: 'spacer' }),
    langSwitch(),
    state.update ? h('button', { class: 'update-pill', title: 'Fermer et rouvrir l\'application pour installer la mise à jour', onclick: () => central.installUpdate() },
      h('span', { class: 'led on' }), `Version ${state.update} prête · Redémarrer`) : null,
    mac ? null : h('div', { class: 'win-controls' },
      h('button', { 'aria-label': 'Réduire', onclick: () => central.window('minimize') }, icon('M0 5h10')),
      h('button', { 'aria-label': 'Agrandir', onclick: () => central.window('maximize') }, icon('M0.5 0.5h9v9h-9z')),
      h('button', { class: 'close', 'aria-label': 'Fermer', onclick: () => central.window('close') }, icon('M0 0l10 10M10 0L0 10'))));
}

/** Nombre de plugins possédés dont une version plus récente attend. */
function pendingUpdates({ catalog }) {
  return catalog.products.filter((p) => status(p).right && status(p).update).length;
}

/** La photo de profil d'un compte ; en attendant qu'elle arrive, ou s'il n'en a pas, l'avatar par défaut. */
export function avatar(user, big = false) {
  const image = h('img', { class: `avatar${big ? ' big' : ''}`, alt: '', src: defaultAvatar(user) });
  if (user.avatar) call('media', user.avatar).then((src) => { image.src = src; }).catch(() => {});
  return image;
}

function sidebar() {
  const { me } = state.data;
  const item = (name, label, count) => h('button', {
    class: `nav-item${state.route.name === name ? ' active' : ''}`, onclick: () => go(name),
  }, star(), label, count ? h('span', { class: 'count' }, String(count)) : null);

  const subscribed = me.subscription?.status === 'active' && (me.subscription.kind === 'pick' ? 'À la carte' : 'All Access');
  // Le rôle du compte reste visible, à côté de l'abonnement s'il y en a un.
  const plan = [me.user.role !== 'user' ? ROLES[me.user.role] : null, subscribed].filter(Boolean).join(' · ') || 'Compte';
  return h('nav', { class: 'sidebar' },
    item('plugins', 'Plugins', pendingUpdates(state.data)),
    item('licenses', 'Licences'),
    item('subscription', 'Abonnement'),
    item('support', 'Support'),
    hasPanel(me.user) ? [h('div', { class: 'eyebrow nav-label' }, 'Studio'), item('admin', 'Panel admin'),
      isStaff(me.user) ? item('support-admin', 'Panel support') : null,
      // L'équipe et les partenaires s'accordent tous les plugins, ou y renoncent pour voir l'application comme un client.
      h('button', {
        class: 'nav-item', 'aria-pressed': String(!!me.user.selfLicenses),
        title: me.user.selfLicenses ? 'Tous les plugins sont offerts à ce compte. Cliquer pour couper.' : 'Ce compte n\'a que les licences qu\'il possède. Cliquer pour s\'accorder tous les plugins.',
        onclick: async () => {
          const enabled = !me.user.selfLicenses;
          if (await attempt(() => call('api', 'POST', '/api/me/self-licenses', { enabled }),
            enabled ? 'Vos licences sont activées : tous les plugins sont offerts à ce compte.' : 'Vos licences sont désactivées : vous voyez l\'application comme un client.')) await refresh();
        },
      }, h('span', { class: `led${me.user.selfLicenses ? ' on' : ''}` }), me.user.selfLicenses ? 'Mes licences : activées' : 'Mes licences : désactivées')] : null,
    h('div', { class: 'spacer' }),
    // Le site ONIRIQUE, juste au-dessus du compte.
    h('button', { class: 'site-link', title: 'Ouvrir onirique.store dans le navigateur', onclick: () => call('open:site', '') },
      h('img', { src: 'assets/sigil.png', alt: '' }),
      h('span', null, h('b', null, 'Le site ONIRIQUE'), h('small', null, 'onirique.store')),
      h('i', { 'aria-hidden': 'true' }, '↗')),
    h('button', { class: 'user-chip', onclick: () => go('account') },
      avatar(me.user),
      h('div', { class: 'who' },
        h('div', { class: 'email' }, me.user.name || me.user.email),
        h('div', { class: 'plan' }, plan))));
}

const VIEWS = {
  plugins: () => (state.route.id ? detailView(state.route.id) : libraryView()),
  licenses: licensesView,
  subscription: subscriptionView,
  support: supportView,
  account: accountView,
  admin: adminView,
  'support-admin': supportAdminView,
};

/** Les écrans réservés : le panel admin (équipe et partenaires), le panel support (équipe seulement). */
const ADMIN_ROUTES = ['admin', 'support-admin'];
const allowed = (route, user) => (route === 'admin' ? hasPanel(user) : route === 'support-admin' ? isStaff(user) : true);

/** Tant que l'adresse e-mail du compte n'est pas validée : le rappel, et de quoi redemander le lien. */
function verifyBanner() {
  const { user } = state.data.me;
  if (user.emailVerified !== false) return null;
  return h('div', { class: 'panel', style: { 'margin-top': 0, 'margin-bottom': '22px', 'border-color': 'rgba(255, 170, 90, 0.4)' } },
    eyebrow('Adresse e-mail à valider'),
    h('div', { class: 'row between wrap' },
      h('p', { class: 'muted', style: { margin: 0, 'max-width': '62ch' } },
        `Un lien de validation a été envoyé à ${user.email}. Ouvrez-le pour activer votre compte : d'ici là, les essais gratuits, les achats et l'activation des plugins restent fermés. Pensez à regarder dans les indésirables.`),
      h('div', { class: 'row' },
        button('Renvoyer le lien', () => attempt(() => call('api', 'POST', '/api/auth/verify/resend'), 'Lien renvoyé. Il est valable 48 heures.'), 'small'),
        button('C\'est fait', refresh, 'small quiet'))));
}

/** Tant que l'adresse e-mail n'est pas validée, l'application est fermée : installations, essais et licences attendent le lien. */
function verifyGate() {
  const { user } = state.data.me;
  return h('div', { class: 'auth-box verify-gate' },
    h('img', { class: 'hero', src: 'assets/sigil.png', alt: '' }),
    h('div', { class: 'wordmark' }, h('b', null, 'ONIRIQUE'), h('i', null, 'Central')),
    h('div', { class: 'panel stack', style: { 'text-align': 'left' } },
      eyebrow('Une dernière étape'),
      h('h2', { style: { margin: 0 } }, 'Validez votre adresse e-mail'),
      h('p', { class: 'muted', style: { margin: 0 } },
        `Un lien a été envoyé à ${user.email}. Ouvrez-le pour activer votre compte : ONIRIQUE CENTRAL s'ouvre ensuite, avec l'installation des plugins, les essais gratuits et vos licences. Pensez à regarder dans les indésirables.`),
      h('div', { class: 'row wrap' },
        button('J\'ai validé mon adresse', refresh, 'primary'),
        button('Renvoyer le lien', () => attempt(() => call('api', 'POST', '/api/auth/verify/resend'), 'Lien renvoyé. Il est valable 48 heures.'), 'quiet')),
      h('button', { class: 'btn small quiet', type: 'button', onclick: async () => { await call('auth:logout'); await refresh(); } }, 'Utiliser un autre compte')));
}

export function render() {
  const root = document.getElementById('app');
  let content;
  if (state.offline) content = h('div', { class: 'auth' }, offlineView());
  else if (!state.data) content = h('div', { class: 'auth' }, h('div', { class: 'muted mono' }, 'Connexion au serveur…'));
  else if (!state.data.me) content = h('div', { class: 'auth' }, authView());
  else if (state.data.me.user.emailVerified === false) content = h('div', { class: 'auth' }, verifyGate());
  else {
    if (!allowed(state.route.name, state.data.me.user)) state.route = { name: 'plugins', id: null };
    content = h('div', { class: 'shell' }, sidebar(),
      h('main', { class: 'main' }, h('div', { class: 'inner' }, verifyBanner(), VIEWS[state.route.name]())));
  }
  const scroll = document.querySelector('.main')?.scrollTop ?? 0;
  root.replaceChildren(titlebar(), content);
  const main = document.querySelector('.main');
  if (main) main.scrollTop = scroll;
}

central.onProgress(({ id, phase, ratio }) => {
  if (state.busy[id]) Object.assign(state.busy[id], { phase, ratio });
  document.querySelectorAll(`[data-progress="${CSS.escape(String(id))}"]`).forEach((el) => {
    el.querySelector('i').style.width = `${Math.round(ratio * 100)}%`;
  });
  document.querySelectorAll(`[data-phase="${CSS.escape(String(id))}"]`).forEach((el) => {
    const percent = `${Math.round(ratio * 100)} %`;
    el.textContent = { install: 'Installation…', upload: `Envoi du fichier ${percent}`, demo: `Création de la démo interactive ${percent} (l'interface du plugin s'ouvre à l'écran, ne la fermez pas)`,
      'demo-upload': `Envoi de la démo ${percent}` }[phase] ?? `Téléchargement ${percent}`;
  });
});

// Au retour dans la fenêtre (par exemple après un paiement dans le navigateur), l'état est relu.
window.addEventListener('focus', () => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  const idle = !Object.keys(state.busy).length && !document.getElementById('overlay').hasChildNodes();
  if (state.data?.me && idle && !typing && !ADMIN_ROUTES.includes(state.route.name) && Date.now() - lastLoad > 20_000) refresh();
});
// La boutique ouverte suit le catalogue : une fiche, une image ou une version changée sur le serveur (depuis le site,
// le panel d'un autre administrateur ou une publication) apparaît ici dans la minute, sans redémarrer. L'écran n'est
// redessiné que si le catalogue a vraiment changé, pour ne rien interrompre.
setInterval(async () => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  const idle = !Object.keys(state.busy).length && !document.getElementById('overlay').hasChildNodes();
  if (!state.data || !idle || typing || ADMIN_ROUTES.includes(state.route.name)) return;
  try {
    const data = await call('load');
    if (JSON.stringify(data.catalog) === JSON.stringify(state.data.catalog)) return;
    state.data = data;
    state.offline = null;
    lastLoad = Date.now();
    render();
  } catch { /* hors ligne : le prochain passage réessaiera */ }
}, 60_000);
window.addEventListener('unhandledrejection', (event) => toast(event.reason?.message || 'Erreur inattendue.', true));

central.onUpdateReady((version) => {
  state.update = version;
  toast(`La version ${version} est téléchargée : elle s'installera à la fermeture de l'application.`);
  render();
});
central.updateReady().then((version) => { if (version) { state.update = version; render(); } });

render();
refresh();
