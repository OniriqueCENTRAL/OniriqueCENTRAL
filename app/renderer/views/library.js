import {
  h, eyebrow, pill, led, productName, button, euros, date, megabytes, compareVersions, toast, attempt, modal, confirm, LICENSE_TYPES, CREATORS,
} from '../ui.js';
import { state, call, refresh, render, go } from '../app.js';

/** Où en est ce plugin pour ce compte et ce PC. */
export function status(product) {
  const { me, installs } = state.data;
  const right = me.entitlements[product.id] || null;
  const install = installs[product.id];
  const update = !!(install.version && product.latest && compareVersions(install.version, product.latest.version) < 0);
  return { right, install, update, busy: state.busy[product.id] || null };
}

const images = new Map();
function cover(product, badge) {
  const framed = product.imageManual ? 'shot framed' : 'shot'; // une image cadrée par un admin se montre centrée
  // Sans capture d'écran, la couverture est le sigil sur la couleur du plugin.
  const mark = h('img', { class: 'mark', src: 'assets/sigil.png', alt: '' });
  const el = h('div', { class: 'cover' }, mark, badge);
  if (product.image) {
    const show = (src) => mark.replaceWith(h('img', { class: framed, src, alt: `Interface de ${product.name}` }));
    if (images.has(product.image)) show(images.get(product.image));
    else call('media', product.image).then((src) => { images.set(product.image, src); show(src); }).catch(() => {});
  }
  return el;
}

/** Nombre de jours entiers restants avant l'expiration d'un droit (essai, licence à durée). */
const daysLeft = (right) => Math.max(0, Math.ceil((right.expiresAt - Date.now()) / 86400_000));
const trialAvailable = (product) => product.priceCents > 0 && !state.data.me.entitlements[product.id] && !state.data.me.trialsUsed.includes(product.id);

function badge(product) {
  const { right, install, update } = status(product);
  if (right?.type === 'trial') return pill(`Essai · ${daysLeft(right)} j`, 'warn', true);
  if (update) return pill('Mise à jour', 'hot', true);
  if (right && install.version) return pill('Installé', '', true);
  if (right) return pill(right.via === 'subscription' ? 'Abonnement' : right.via === 'vip' ? 'Offert' : 'Possédé', '', true);
  return pill(euros(product.priceCents));
}

/** Démarre l'essai gratuit de 7 jours (un seul par compte et par plugin). */
function startTrial(product) {
  confirm(`Essayer ${product.name} gratuitement ?`,
    "Pendant 7 jours, le plugin s'utilise librement en temps réel dans votre DAW. Tout export reste remplacé par un bruit blanc tant que le plugin n'est pas acheté. Un seul essai par plugin.",
    'Démarrer l\'essai', async () => {
      if (!(await attempt(() => call('api', 'POST', '/api/licenses/trial', { productId: product.id, machineId: state.data.machineId }), `Essai de ${product.name} démarré pour 7 jours. Installez-le : il s'active sur ce PC.`))) return;
      await refresh();
    });
}

// Formats de plugin. L'Audio Unit n'existe que sur Mac : il n'est pas proposé ailleurs. Ceux qui ne sont pas encore
// distribués sont affichés, pas sélectionnables.
const FORMATS = [['VST3', /\.(vst3|zip)$/i], ['AAX', /\.aaxplugin$/i], ['AU', /\.component$/i]]
  .filter(([name]) => name !== 'AU' || window.central.platform === 'darwin');
const isApplication = (product) => /\.(exe|msi)$/i.test(product.latest?.filename || '');

function formatPicker(product) {
  // Pour un .zip Mac, le serveur dit ce qu'il contient (VST3 et Audio Unit s'installent alors ensemble).
  const available = product.latest.formats ?? FORMATS.filter(([, pattern]) => pattern.test(product.latest.filename)).map(([name]) => name);
  const together = available.length > 1;
  return h('div', { style: { 'margin-top': '18px' } },
    h('div', { class: 'eyebrow', style: { 'margin-bottom': '8px' } }, together ? 'Formats installés ensemble' : 'Format à installer'),
    h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Format du plugin' },
      FORMATS.map(([name]) => {
        const ok = available.includes(name);
        return h('button', {
          type: 'button', role: 'radio', class: ok && (together || name === available[0]) ? 'active' : '', disabled: !ok,
          'aria-checked': String(ok && (together || name === available[0])), title: ok ? `${name} : disponible` : `${name} : bientôt disponible`,
          style: ok ? {} : { opacity: '0.45', cursor: 'not-allowed' },
        }, ok ? name : `${name} · bientôt`);
      })));
}

/** L'image choisie par un admin, en entier. */
function wholeImage(product) {
  const box = h('div', { class: 'whole' });
  const show = (src) => box.replaceChildren(h('img', { src, alt: `Interface de ${product.name}` }));
  if (images.has(product.image)) show(images.get(product.image));
  else call('media', product.image).then((src) => { images.set(product.image, src); show(src); }).catch(() => box.replaceWith(cover(product, null)));
  return box;
}

/** L'interface réelle du plugin, manipulable : la même démo que dans la boutique du site. */
function demoView(product) {
  const box = h('div', { class: 'demo' }, h('div', { class: 'demo-wait' }, "Chargement de l'interface…"));
  call('demo', product.demo)
    .then((demo) => window.OniriqueDemo.render(box, demo, "Interface réelle du plugin : glissez sur un bouton, cliquez un interrupteur. Aucun son n'est traité ici."))
    .catch(() => box.replaceChildren(cover(product, null)));
  return box;
}

//------------------------------------------------------------------------------
async function install(product) {
  state.busy[product.id] = { phase: 'download', ratio: 0 };
  render();
  try {
    await call('plugin:install', product.id);
    toast(`${product.name} ${product.latest.version} est installé.`);
  } catch (error) {
    toast(error.message, true);
  }
  delete state.busy[product.id];
  await refresh();
}

export function buy(kind, item) {
  const mode = state.data.catalog.paymentsMode;
  const free = kind === 'product' && item.priceCents === 0;
  // Chaque créateur vend sur son propre compte : tant que le sien n'est pas branché, ses plugins ne sont pas encore en vente.
  const sellers = state.data.catalog.sellers;
  const unsold = kind === 'product' && sellers && !sellers.includes(item.creator);
  if ((mode === 'off' || unsold) && !free) {
    return modal(unsold ? 'Bientôt en vente' : 'Achats bientôt ouverts',
      h('p', { class: 'muted' }, unsold ? 'Ce plugin n\'est pas encore en vente. Si vous avez reçu une clé de licence, entrez-la dans l\'onglet Licences.'
        : 'La boutique n\'est pas encore ouverte. Si vous avez reçu une clé de licence, entrez-la dans l\'onglet Licences.'),
      [{ label: 'Entrer une clé', run: () => go('licenses') }], 'Boutique');
  }
  // Un abonnement : une formule à tout le catalogue ("plan") ou une sélection de plugins à la carte ("pick").
  const recurring = kind === 'plan' || kind === 'pick';
  const price = recurring ? `${euros(item.priceCents)} / ${item.interval === 'year' ? 'an' : 'mois'}` : euros(item.priceCents);
  const text = free ? 'Ce plugin est gratuit : il sera ajouté à votre compte.'
    : mode === 'demo' ? 'Mode démo : aucun paiement n\'est effectué, l\'achat est accordé tout de suite.'
      : 'Le paiement sécurisé s\'ouvre dans votre navigateur. Revenez ici une fois terminé : votre compte se met à jour tout seul.';
  // Code promo et remise de parrainage (plugins seulement) : le serveur donne le prix pour ce compte, et le recalcule au paiement.
  const priceBox = h('div', { class: 'price' }, price);
  const promoNote = h('div', { class: 'muted', style: { 'font-size': '13px' } });
  let promo = null;
  const showQuote = (q) => {
    priceBox.replaceChildren(...(q.discountCents > 0
      ? [h('s', { class: 'muted', style: { 'font-size': '.55em', 'margin-right': '10px' } }, euros(q.priceCents)), euros(q.finalCents)] : [euros(q.priceCents)]));
    promoNote.textContent = q.note || (q.discountCents > 0 ? (q.source === 'welcome' ? `${q.label} : votre cadeau de parrainage.` : `Code ${q.code} appliqué : ${q.label}.`) : '');
  };
  const quote = (code) => call('api', 'POST', '/api/promo/quote', { productId: item.id, code });
  const code = h('input', { class: 'mono grow', maxLength: 24, placeholder: 'CODE PROMO', style: { 'text-transform': 'uppercase' } });
  const promoRow = kind === 'product' && !free ? h('div', { class: 'stack', style: { gap: '6px' } },
    h('div', { class: 'row' }, code, button('Appliquer', async () => {
      if (!code.value.trim()) return;
      try { const q = await quote(code.value.trim()); promo = q.code ? code.value.trim() : null; showQuote(q); } catch (error) { promo = null; promoNote.textContent = error.message; }
    }, 'small')), promoNote) : null;
  if (promoRow) quote().then((q) => q.discountCents && showQuote(q)).catch(() => {});
  modal(item.name, h('div', { class: 'stack' }, priceBox, h('p', { class: 'muted' }, text), promoRow), [{
    label: free ? 'Obtenir' : mode === 'demo' ? 'Confirmer' : 'Payer',
    run: async () => {
      const result = await attempt(() => call('checkout', kind, item.id, item.productIds, promo));
      if (!result) return false;
      if (result.mode === 'stripe' || result.mode === 'lemon') toast('Paiement ouvert dans votre navigateur.');
      else { toast(recurring ? 'Abonnement activé.' : `${item.name} est à vous.`); await refresh(); }
    },
  }], recurring ? 'Abonnement' : 'Achat');
}

/** Retire le plugin de ce PC (la licence reste sur le compte). */
function removePlugin(product) {
  confirm(`Désinstaller ${product.name} ?`, 'Le fichier est retiré de ce PC. Votre licence reste sur votre compte : vous pourrez le réinstaller quand vous voulez.',
    'Désinstaller', async () => { await attempt(() => call('plugin:uninstall', product.id), `${product.name} est désinstallé.`); await refresh(); }, 'danger');
}

/** Le bouton principal d'un plugin, selon son état. */
function mainAction(product) {
  const { right, install: inst, update, busy } = status(product);
  if (busy) {
    return h('div', { class: 'grow stack', style: { gap: '6px' } },
      h('div', { class: 'version', 'data-phase': product.id }, busy.phase === 'install' ? 'Installation…' : `Téléchargement ${Math.round(busy.ratio * 100)} %`),
      h('div', { class: 'progress', 'data-progress': product.id }, h('i', { style: { width: `${Math.round(busy.ratio * 100)}%` } })));
  }
  const act = (label, run, kind = 'primary') => button(label, (event) => { event.stopPropagation(); run(); }, kind);
  if (!right) return act(product.priceCents ? `Acheter · ${euros(product.priceCents)}` : 'Obtenir', () => buy('product', product));
  if (!product.latest) return button(window.central.platform === 'darwin' ? 'Bientôt sur Mac' : 'Bientôt disponible', null, '', { disabled: true });
  if (update) return act(`Mettre à jour · ${product.latest.version}`, () => install(product));
  if (inst.version && inst.launch) return act('Ouvrir', () => attempt(() => call('plugin:open', product.id)));
  if (inst.version) return act('Réinstaller', () => install(product), 'small');
  return act('Installer', () => install(product));
}

const creatorOf = (product) => CREATORS[product.creator] ?? CREATORS.onirique;

/** Ce que la bibliothèque montre : un créateur ou tous, dans l'ordre du catalogue ou par prix. */
const shown = { creator: 'all', sort: 'none', category: 'all', os: window.central.platform === 'darwin' ? 'mac' : 'win' };
const SORTS = { none: 'Tri : par défaut', up: 'Prix croissant', down: 'Prix décroissant' };

//------------------------------------------------------------------------------
export function libraryView() {
  const { catalog, me } = state.data;
  const owned = catalog.products.filter((p) => me.entitlements[p.id]).length;
  const categories = catalog.categories ?? [];
  const products = catalog.products.filter((p) => (shown.creator === 'all' || (p.creator ?? 'onirique') === shown.creator)
    && (shown.category === 'all' || (p.categories ?? []).includes(shown.category)));
  if (shown.sort !== 'none') products.sort((a, b) => (shown.sort === 'up' ? a.priceCents - b.priceCents : b.priceCents - a.priceCents));

  const filters = h('div', { class: 'row between wrap', style: { 'margin-bottom': '20px' } },
    h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Créateur des plugins' },
      [['all', 'Tous'], ...Object.entries(CREATORS)].map(([id, label]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(shown.creator === id), class: shown.creator === id ? 'active' : '',
        onclick: () => { shown.creator = id; render(); },
      }, label))),
    // Un seul bouton : chaque clic passe au tri suivant.
    button(SORTS[shown.sort], () => { shown.sort = { none: 'up', up: 'down', down: 'none' }[shown.sort]; render(); }, 'small'));
  // Trier par usage : beatmaking, voix, mix, mastering, mesure, applications.
  const categoryRow = categories.length ? h('div', { class: 'row wrap', style: { 'margin': '-8px 0 20px', gap: '10px' } },
    h('span', { class: 'muted mono', style: { 'font-size': '11px', 'letter-spacing': '.14em', 'text-transform': 'uppercase' } }, 'Trier par'),
    h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Catégorie des plugins' },
      [['all', 'Tout'], ...categories.map((c) => [c.id, c.label])].map(([id, label]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(shown.category === id), class: shown.category === id ? 'active' : '',
        onclick: () => { shown.category = id; render(); },
      }, label)))) : null;

  const card = (product) => h('div', {
    class: 'card', role: 'button', tabIndex: 0, style: { '--accent': product.accent },
    onclick: () => go('plugins', product.id),
    onkeydown: (event) => { if (event.key === 'Enter' && event.target === event.currentTarget) go('plugins', product.id); },
  },
    cover(product, badge(product)),
    h('div', { class: 'card-body' },
      h('div', { class: 'creator' }, creatorOf(product)),
      productName(product.name),
      h('div', { class: 'muted' }, product.tagline),
      h('div', { class: 'card-foot' },
        h('span', { class: 'version' }, product.latest ? `v${status(product).install.version || product.latest.version}` : '—'),
        h('div', { class: 'row', style: { gap: '8px' } },
          status(product).install.version && status(product).install.removable && !status(product).busy
            ? button('Désinstaller', (event) => { event.stopPropagation(); removePlugin(product); }, 'small quiet danger') : null,
          mainAction(product)))));

  return [
    eyebrow('Bibliothèque'),
    h('h1', null, 'Vos ', h('em', null, 'plugins')),
    h('p', { class: 'lede' }, catalog.products.length
      ? `${owned} sur ${catalog.products.length} dans votre collection. Installation et mises à jour en un clic, licence activée sur ce PC au passage.`
      : 'Aucun plugin publié pour le moment.'),
    catalog.products.length ? filters : null,
    catalog.products.length ? categoryRow : null,
    products.length || !catalog.products.length ? h('div', { class: 'cards' }, products.map(card))
      : h('div', { class: 'panel soon' }, eyebrow(shown.creator !== 'all' ? CREATORS[shown.creator] : categories.find((c) => c.id === shown.category)?.label ?? ''),
        h('h2', null, 'Bientôt ', h('em', null, 'disponible')),
        h('p', { class: 'muted' }, shown.creator !== 'all' && shown.category === 'all' ? `Les plugins ${CREATORS[shown.creator]} arrivent. Ils apparaîtront ici dès leur sortie.`
          : 'Aucun plugin ne correspond encore à ce choix. Il apparaîtra ici dès sa sortie.')),
  ];
}

//------------------------------------------------------------------------------
export function detailView(id) {
  const product = state.data.catalog.products.find((p) => p.id === id);
  if (!product) return libraryView();
  const { right, install: inst, update, busy } = status(product);
  const { machineId, me } = state.data;
  // L'historique des versions se lit pour un système : celui de cet ordinateur d'abord, s'il existe pour ce plugin.
  const systems = [['win', 'Windows'], ['mac', 'Mac']].filter(([id]) => product.versions.some((v) => v.platform === id));
  const os = systems.some(([id]) => id === shown.os) ? shown.os : systems[0]?.[0];
  const activeHere = me.activations.some((a) => a.productId === product.id && a.machineId === machineId);
  const used = me.activations.filter((a) => a.productId === product.id).length;

  const licenseBlock = right ? h('div', { class: 'panel' },
    eyebrow(right.type === 'trial' ? 'Essai' : 'Licence'),
    right.type === 'trial' ? h('p', { class: 'row', style: { margin: '0 0 14px' } },
      pill(`${daysLeft(right)} jour(s) restant(s)`, 'warn', true),
      button(product.priceCents ? `Acheter · ${euros(product.priceCents)}` : 'Obtenir', () => buy('product', product), 'small primary')) : null,
    h('dl', { class: 'kv' },
      h('dt', null, 'Type'), h('dd', null, LICENSE_TYPES[right.type] || right.type),
      h('dt', null, 'Valable'), h('dd', null, right.via === 'subscription' ? 'tant que l\'abonnement court'
        : right.via === 'vip' ? 'offert avec votre rôle' : right.expiresAt ? `jusqu'au ${date(right.expiresAt)}` : 'sans limite'),
      h('dt', null, 'Machines'), h('dd', null, `${used} sur ${right.maxActivations}`)),
    h('div', { class: 'row between', style: { 'margin-top': '16px' } },
      h('div', { class: 'row' }, led(activeHere), activeHere ? 'Activée sur ce PC' : 'Pas activée sur ce PC'),
      activeHere
        ? button('Désactiver', () => confirm('Désactiver sur ce PC ?', `${product.name} ne s'ouvrira plus ici tant que vous ne l'aurez pas réactivé. La place est rendue à une autre machine.`,
          'Désactiver', async () => { await attempt(() => call('license:deactivate', product.id), 'Licence désactivée sur ce PC.'); await refresh(); }), 'small danger')
        : button('Activer ici', async () => { await attempt(() => call('license:activate', product.id), 'Licence activée sur ce PC.'); await refresh(); }, 'small')))
    : null;

  const installBlock = h('div', { class: 'panel', style: { '--accent': product.accent } },
    productName(product.name, true),
    h('p', { class: 'muted', style: { margin: '8px 0 18px' } }, product.tagline),
    h('div', { class: 'row between' }, right ? badge(product) : h('div', { class: 'price' }, euros(product.priceCents)),
      mainAction(product)),
    trialAvailable(product) ? h('div', { style: { 'margin-top': '14px' } },
      button('Essai gratuit · 7 jours', () => startTrial(product), 'small'),
      h('span', { class: 'muted', style: { 'margin-left': '12px', 'font-size': '12.5px' } }, "7 jours en temps réel. Export en bruit blanc jusqu'à l'achat.")) : null,
    !right && state.data.catalog.plans.length ? h('p', { class: 'muted', style: { margin: '14px 0 0', 'font-size': '13px' } },
      'Aussi disponible par abonnement, seul ou avec toute la collection. ',
      h('a', { href: '#', style: { color: 'var(--ember-hot)' }, onclick: (e) => { e.preventDefault(); go('subscription'); } }, 'Voir les formules')) : null,
    product.latest ? h('dl', { class: 'kv', style: { 'margin-top': '20px' } },
      h('dt', null, 'Créateur'), h('dd', null, creatorOf(product)),
      h('dt', null, 'Dernière version'), h('dd', { class: 'mono' }, `${product.latest.version} · ${date(product.latest.createdAt)}`),
      h('dt', null, 'Sur ce PC'), h('dd', { class: 'mono' }, inst.version || (inst.present ? 'présent, version inconnue' : 'non installé')),
      h('dt', null, 'Taille'), h('dd', { class: 'mono' }, megabytes(product.latest.size)),
      h('dt', null, 'Fichier'), h('dd', { class: 'mono', title: inst.path || '' }, product.latest.filename),
      isApplication(product) ? [h('dt', null, 'Type'), h('dd', null, 'Application Windows')] : null,
      inst.launch ? [h('dt', null, 'Emplacement'), h('dd', { class: 'mono selectable', title: inst.launch }, inst.launch)] : null) : null,
    product.latest && !isApplication(product) ? formatPicker(product) : null,
    right && product.latest && !busy ? h('div', { class: 'row wrap', style: { 'margin-top': '18px' } },
      inst.launch && update ? button('Ouvrir', () => attempt(() => call('plugin:open', product.id)), 'small') : null,
      inst.present ? button('Ouvrir le dossier', () => call('plugin:reveal', product.id), 'small') : null,
      inst.version && inst.removable ? button('Désinstaller', () => removePlugin(product), 'small quiet danger') : null) : null);

  return [
    button('← Tous les plugins', () => go('plugins'), 'small quiet'),
    h('div', { class: 'detail', style: { 'margin-top': '14px', '--accent': product.accent } },
      h('div', null,
        // Une image choisie par un admin passe avant la démo fabriquée automatiquement.
        product.image && product.imageManual ? wholeImage(product) : product.demo ? demoView(product) : cover(product, null),
        h('div', { class: 'panel', style: { 'margin-top': '16px' } }, eyebrow('Le plugin'),
          h('div', { class: 'desc' }, (product.description || product.tagline).split(/\n{2,}/).map((text) => h('p', null, text)))),
        product.versions.length ? h('div', { class: 'panel' },
          h('div', { class: 'row between', style: { 'margin-bottom': '14px' } }, eyebrow('Historique des versions'),
            // Un historique par système : les notes d'une même version ne sont pas répétées pour Windows et pour Mac.
            systems.length > 1 ? h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Système' }, systems.map(([id, label]) => h('button', {
              type: 'button', role: 'radio', 'aria-checked': String(os === id), class: os === id ? 'active' : '',
              onclick: () => { shown.os = id; render(); },
            }, label))) : null),
          h('ul', { class: 'changelog' }, product.versions.filter((v) => v.platform === os).map((v) => h('li', null,
            h('div', { class: 'row' }, h('span', { class: 'mono' }, `v${v.version}`), h('span', { class: 'muted mono', style: { 'font-size': '11px' } }, date(v.createdAt))),
            v.notes ? h('p', null, v.notes) : null)))) : null),
      h('div', null, installBlock, licenseBlock)),
  ];
}
