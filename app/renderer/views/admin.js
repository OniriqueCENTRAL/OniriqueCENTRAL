import {
  h, eyebrow, pill, led, field, button, euros, date, megabytes, dateInputValue, dateInputToMs,
  toast, attempt, modal, confirm, closeModal, LICENSE_TYPES, ROLES, roleName, CREATORS, isStaff,
} from '../ui.js';
import { state, call, refresh, render, go } from '../app.js';

const api = (method, route, body) => call('api', method, `/api/admin${route}`, body);

/** Données du panel, chargées onglet par onglet. */
const data = { overview: null, plans: null, pick: null, credits: null, products: null, licenses: null, users: null, payments: null, promos: null, referral: null, mailings: null };
const ui = { licenseQuery: '', userQuery: '', generated: null, loading: false, error: null };

const LOADERS = {
  overview: async () => { [data.overview, data.plans, data.pick] = await Promise.all([api('GET', '/overview'), api('GET', '/plans'), api('GET', '/pick')]); },
  products: async () => { data.products = await api('GET', '/products'); },
  licenses: async () => {
    [data.licenses, data.products] = await Promise.all([
      api('GET', `/licenses?q=${encodeURIComponent(ui.licenseQuery)}`), data.products ?? api('GET', '/products')]);
  },
  users: async () => { data.users = await api('GET', `/users?q=${encodeURIComponent(ui.userQuery)}`); },
  credits: async () => { [data.credits, data.products] = await Promise.all([api('GET', '/credits'), data.products ?? api('GET', '/products')]); },
  payments: async () => { data.payments = await api('GET', '/payments'); },
  promos: async () => { [data.promos, data.products] = await Promise.all([api('GET', '/promos'), data.products ?? api('GET', '/products')]); },
  referral: async () => { data.referral = await api('GET', '/referral'); },
  mailings: async () => { [data.mailings, data.products] = await Promise.all([api('GET', '/mailings'), data.products ?? api('GET', '/products')]); },
};
const READY = {
  overview: () => data.overview && data.plans && data.pick,
  products: () => data.products,
  licenses: () => data.licenses && data.products,
  users: () => data.users,
  credits: () => data.credits && data.products,
  payments: () => data.payments,
  promos: () => data.promos && data.products,
  referral: () => data.referral,
  mailings: () => data.mailings && data.products,
};

async function reload(tab = state.adminTab) {
  ui.loading = true;
  ui.error = null;
  try {
    await LOADERS[tab]();
  } catch (error) {
    ui.error = error.message;
  }
  ui.loading = false;
  render();
}

/** Après une modification : l'onglet est relu, et le catalogue aussi s'il a pu changer. */
async function changed(action, success, catalogToo = false) {
  if (!(await attempt(action, success))) return false;
  if (catalogToo) { data.products = null; await refresh(); }
  await reload();
  return true;
}

const toCents = (input) => Math.round(Number(String(input.value).replace(',', '.')) * 100);
const priceInput = (cents) => h('input', { type: 'number', min: 0, step: 0.01, value: (cents / 100).toFixed(2) });
const table = (heads, rows, empty) => (rows.length
  ? h('div', { class: 'table-scroll' }, h('table', null, h('thead', null, h('tr', null, heads.map((t) => h('th', null, t)))), h('tbody', null, rows)))
  : h('div', { class: 'empty' }, empty));

//==============================================================================
//  Vue d'ensemble
//==============================================================================
function overviewTab() {
  const o = data.overview;
  const tile = (label, value) => h('div', { class: 'panel tile', style: { 'margin-top': 0 } }, eyebrow(label), h('div', { class: 'value' }, String(value)));

  const planRow = (p) => {
    const name = h('input', { value: p.name, maxLength: 60 });
    const price = priceInput(p.priceCents);
    const active = h('input', { type: 'checkbox', checked: p.active });
    return h('tr', null,
      h('td', null, name),
      h('td', { style: { width: '140px' } }, price),
      h('td', { class: 'muted' }, p.interval === 'year' ? 'par an' : 'par mois'),
      h('td', null, h('label', { class: 'check' }, active, 'Proposée')),
      h('td', { class: 'actions' }, button('Enregistrer', () => changed(
        () => api('PATCH', `/plans/${p.id}`, { name: name.value, priceCents: toCents(price), active: active.checked }), 'Formule enregistrée.', true), 'small')));
  };

  // À la carte : le prix du premier plugin, puis celui de chaque plugin ajouté.
  const pickBase = priceInput(data.pick.baseCents), pickExtra = priceInput(data.pick.extraCents);

  return [
    !['stripe', 'lemon'].includes(o.paymentsMode) ? h('p', null, pill(o.paymentsMode === 'demo'
      ? 'Paiements en mode démo : les achats sont accordés sans paiement' : 'Paiements fermés : seules les clés de licence donnent accès', 'warn')) : null,
    h('div', { class: 'grid3' },
      tile('Comptes', o.users), tile('Licences actives', o.licenses), tile('Clés en attente', o.unclaimed),
      tile('Abonnés', o.subscribers), tile('Machines activées', o.activations), tile('Ventes', euros(o.revenueCents).replace('Gratuit', '0 €'))),
    h('div', { class: 'panel', style: { 'margin-top': '16px' } }, eyebrow('Formules d\'abonnement'),
      table(['Nom', 'Prix (€)', '', '', ''], data.plans.filter((p) => p.kind !== 'pick').map(planRow), 'Aucune formule.'),
      h('div', { class: 'row wrap', style: { 'margin-top': '16px', 'align-items': 'flex-end' } },
        field('À la carte : premier plugin (€ par mois)', pickBase), field('Chaque plugin ajouté (€ par mois)', pickExtra),
        button('Enregistrer', () => changed(
          () => api('PATCH', '/pick', { baseCents: toCents(pickBase), extraCents: toCents(pickExtra) }), 'Abonnement à la carte enregistré.', true), 'small'))),
    h('div', { class: 'panel' }, h('div', { class: 'row between wrap' },
      h('div', { class: 'row' }, eyebrow('Support'), pill(`${o.supportMessages} demande(s)`, o.supportMessages ? 'hot' : '')),
      button('Ouvrir le panel support', () => go('support-admin'), 'small'))),
  ];
}

//==============================================================================
//  Plugins et versions
//==============================================================================
function productForm(product) {
  const f = {
    name: h('input', { value: product?.name ?? 'ONIRIQUE ', maxLength: 60, required: true }),
    tagline: h('input', { value: product?.tagline ?? '', maxLength: 140 }),
    description: h('textarea', { value: product?.description ?? '', maxLength: 4000, rows: 6 }),
    price: priceInput(product?.priceCents ?? 0),
    accent: h('input', { type: 'color', value: product?.accent ?? '#e23444' }),
    published: h('input', { type: 'checkbox', checked: product?.published ?? true }),
    creator: h('select', null, Object.entries(CREATORS).map(([id, label]) => h('option', { value: id }, label))),
  };
  // Catégorie de la boutique : une seule par plugin ; « Automatique » la devine à partir du nom et du texte.
  const cats = state.data.catalog.categories ?? [];
  const category = h('select', { value: product?.categories?.[0] ?? '' }, h('option', { value: '' }, 'Automatique'), cats.map((c) => h('option', { value: c.id }, c.label)));
  // Un <select> ne prend sa valeur qu'une fois ses options en place.
  f.creator.value = product?.creator ?? 'onirique';
  // Le créateur ne se choisit que par l'équipe : les plugins d'un partenaire portent toujours son nom.
  const staff = isStaff(state.data.me.user);
  const body = h('div', { class: 'stack' },
    field('Nom', f.name), field('Accroche', f.tagline),
    staff ? field('Créateur', f.creator) : null,
    field('Description (une ligne vide entre les paragraphes)', f.description),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Prix (€) — 0 pour gratuit', f.price)), field('Couleur', f.accent)),
    cats.length ? field('Catégorie', category) : null,
    h('label', { class: 'check' }, f.published, 'Visible dans la bibliothèque'));
  modal(product ? `Modifier ${product.name}` : 'Nouveau plugin', body, [{
    label: product ? 'Enregistrer' : 'Créer',
    run: async () => {
      const payload = { name: f.name.value, tagline: f.tagline.value, description: f.description.value,
        priceCents: toCents(f.price), accent: f.accent.value, published: f.published.checked, ...(staff ? { creator: f.creator.value } : {}),
        ...(cats.length ? { category: category.value } : {}) };
      const ok = await changed(() => (product ? api('PATCH', `/products/${product.id}`, payload) : api('POST', '/products', payload)),
        product ? 'Plugin enregistré.' : 'Plugin créé.', true);
      return ok ? undefined : false;
    },
  }], 'Plugin');
}

/** Propose la version suivante : 1.2.3 → 1.2.4. */
const nextVersion = (latest) => (latest ? latest.version.replace(/(\d+)(?!.*\d)/, (n) => String(Number(n) + 1)) : '1.0.0');

function versionForm(product) {
  let file = null;
  const version = h('input', { class: 'mono', value: nextVersion(product.latest), required: true, maxLength: 30 });
  const notes = h('textarea', { placeholder: 'Nouveautés et corrections, visibles par les utilisateurs.', maxLength: 4000, rows: 5 });
  const fileLabel = h('span', { class: 'muted grow' }, 'Aucun fichier choisi');
  const platform = h('select', null, h('option', { value: 'win' }, 'Windows (.vst3, .zip, .exe ou .msi)'), h('option', { value: 'mac' }, 'Mac (.zip contenant le .vst3, ou .pkg)'));
  const bar = h('div', { class: 'progress', 'data-progress': `upload:${product.id}`, style: { display: 'none' } }, h('i'));
  const phase = h('div', { class: 'muted mono', 'data-phase': `upload:${product.id}`, style: { 'font-size': '11px' } });
  const pick = button('Choisir le fichier', async () => {
    const chosen = await attempt(() => call('admin:pick', 'binary'));
    if (chosen && chosen !== true) {
      file = chosen;
      fileLabel.textContent = `${file.name} · ${megabytes(file.size)}`;
    }
  });
  const body = h('div', { class: 'stack' },
    h('div', { class: 'grid2' }, field('Numéro de version', version), field('Système', platform)),
    field('Notes de version', notes),
    h('div', { class: 'row' }, pick, fileLabel), bar, phase,
    h('p', { class: 'muted', style: { margin: 0, 'font-size': '12.5px' } },
      "Pour un .vst3 Windows, la démo interactive de la boutique et l'image du plugin sont fabriquées automatiquement après l'envoi : le plugin s'ouvre à l'écran une à trois minutes. Pour Mac, zippez le dossier « NOM.vst3 » en « NOM.vst3.zip »."));
  modal(`Nouvelle version de ${product.name}`, body, [{
    label: 'Publier',
    run: async () => {
      if (!file) { toast('Choisissez d\'abord le fichier du plugin.', true); return false; }
      bar.style.display = '';
      let result;
      const ok = await changed(async () => { result = await call('admin:uploadVersion', { productId: product.id, version: version.value.trim(), notes: notes.value, filePath: file.path, platform: platform.value }); },
        `${product.name} ${version.value.trim()} est en ligne.`, true);
      bar.style.display = 'none';
      phase.textContent = '';
      if (result?.demo?.ok) toast('Démo interactive et image mises à jour sur la boutique.');
      else if (result?.demo) toast(`Version publiée, mais la démo interactive n'a pas pu être créée : ${result.demo.message}`, true);
      return ok ? undefined : false;
    },
  }], 'Mise à jour');
}

/** Une image choisie sur ce PC devient l'image du plugin : l'aperçu automatique ne la remplace plus. */
async function chooseImage(p) {
  const file = await call('admin:pick', 'image');
  if (!file) return;
  await cropImage(p, await attempt(() => call('admin:imageData', file.path)));
}

/** Le cadrage : on place et on zoome l'image dans un cadre aux proportions de la boutique, puis elle est envoyée rognée. */
async function cropImage(p, source) {
  if (!source) return;
  const cut = await window.OniriqueCropper.open(source).catch((error) => { toast(error.message, true); return null; });
  if (!cut) return;
  await changed(() => call('admin:uploadImageData', { productId: p.id, dataUrl: cut.dataUrl }), 'Image enregistrée : elle ne sera plus remplacée par l\'aperçu automatique.', true);
}

/** Refabrique la démo interactive et l'image à partir du .vst3 de la version en ligne (publiée d'ici ou depuis le site). */
function refreshDemo(p) {
  const phase = h('div', { class: 'muted mono', 'data-phase': `upload:${p.id}`, style: { 'font-size': '11px', 'min-height': '16px' } });
  const bar = h('div', { class: 'progress', 'data-progress': `upload:${p.id}` }, h('i'));
  modal(`Actualiser la démo de ${p.name}`, h('div', { class: 'stack' },
    h('p', { class: 'muted', style: { margin: 0 } }, `Le fichier de la version ${p.latest.version} est téléchargé puis chargé sur ce PC : l'interface du plugin s'ouvre à l'écran une à trois minutes, ne la fermez pas. L'image et la démo de la boutique sont ensuite remplacées.`),
    bar, phase), [{
    label: 'Lancer',
    run: async () => ((await changed(() => call('admin:refreshDemo', p.id), 'Démo interactive et image mises à jour.', true)) ? undefined : false),
  }], 'Démo');
}

/** Le plugin vérifie-t-il sa licence ? D'après le fichier de la version : oui, non, ou illisible (installateur). */
const licensePill = (licensed, label, required = true) => (licensed === true ? pill(`Licence ${label}`.trim(), '', true)
  : licensed === false ? pill(`Sans licence ${label}`.trim(), required ? 'warn' : '')
    : pill(`Licence ${label} : illisible`.trim(), required ? 'warn' : ''));
const SYSTEMS = [['win', 'Windows'], ['mac', 'Mac']];
/** Les systèmes pour lesquels la version actuelle d'un plugin payant ne vérifie pas sa licence. */
const unlicensedSystems = (p) => (p.priceCents > 0 ? SYSTEMS.filter(([key]) => p.licensed?.[key] === false).map(([, label]) => label) : []);

function productsTab() {
  const versionRow = (product) => (v) => h('tr', null,
    h('td', { class: 'mono' }, `v${v.version}`, h('span', { style: { 'margin-left': '10px' } }, pill(v.platform === 'mac' ? 'Mac' : 'Windows')),
      v.id === product.latest?.id ? h('span', { style: { 'margin-left': '6px' } }, pill('Actuelle', 'hot')) : null,
      h('span', { style: { 'margin-left': '6px' } }, licensePill(v.licensed, '', product.priceCents > 0))),
    h('td', { class: 'muted' }, date(v.createdAt)),
    h('td', { class: 'mono muted' }, `${v.filename} · ${megabytes(v.size)}`),
    h('td', { class: 'muted', style: { 'max-width': '260px', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }, title: v.notes }, v.notes || '—'),
    h('td', { class: 'actions' },
      button('Notes', () => {
        const notes = h('textarea', { value: v.notes, maxLength: 4000, rows: 6 });
        modal(`Notes de la version ${v.version}`, notes, [{
          label: 'Enregistrer', run: async () => ((await changed(() => api('PATCH', `/versions/${v.id}`, { notes: notes.value }), 'Notes enregistrées.', true)) ? undefined : false),
        }], product.name);
      }, 'small quiet'),
      button('Retirer', () => confirm(`Retirer la version ${v.version} ?`,
        `Le fichier est supprimé du serveur et ne pourra plus être téléchargé. Les installations existantes de ${product.name} ne sont pas touchées.`,
        'Retirer', () => changed(() => api('DELETE', `/versions/${v.id}`), 'Version retirée.', true), 'danger'), 'small quiet danger')));

  const panel = (p) => h('div', { class: 'panel', style: { '--accent': p.accent } },
    h('div', { class: 'row between wrap' },
      h('div', { class: 'row' },
        h('span', { class: 'led on', style: { background: p.accent, 'box-shadow': `0 0 10px ${p.accent}` } }),
        h('h2', null, p.name),
        pill(CREATORS[p.creator] ?? CREATORS.onirique),
        pill(p.published ? 'Publié' : 'Masqué', p.published ? '' : 'warn'),
        pill(euros(p.priceCents)), p.demo ? pill('Démo en ligne', '', true) : pill('Pas de démo', 'warn'),
        ...SYSTEMS.filter(([key]) => p.licensed?.[key] !== undefined).map(([key, label]) => licensePill(p.licensed[key], label, p.priceCents > 0))),
      h('div', { class: 'row' },
        button(p.imageManual ? 'Changer l\'image' : 'Choisir une image', () => chooseImage(p), 'small'),
        p.image ? button('Rogner l\'image', async () => cropImage(p, await attempt(() => call('media', p.image))), 'small quiet') : null,
        p.imageManual ? button('Retirer l\'image', () => confirm(`Retirer l'image de ${p.name} ?`,
          'L\'image choisie à la main est retirée. L\'aperçu automatique pourra de nouveau en fournir une.',
          'Retirer', () => changed(() => api('DELETE', `/products/${p.id}/image`), 'Image retirée.', true), 'danger'), 'small quiet') : null,
        p.demo ? button('Retirer la démo', () => confirm(`Retirer la démo de ${p.name} ?`,
          'La boutique et l\'application montreront l\'image du plugin à la place. La démo n\'est pas refabriquée toute seule : « Actualiser la démo » la remet.',
          'Retirer', () => changed(() => api('DELETE', `/products/${p.id}/demo`), 'Démo retirée.', true), 'danger'), 'small quiet') : null,
        p.latest && /\.vst3$/i.test(p.latest.filename) ? button('Actualiser la démo', () => refreshDemo(p), 'small') : null,
        button('Modifier', () => productForm(p), 'small'),
        button('Nouvelle version', () => versionForm(p), 'small primary'))),
    h('p', { class: 'muted', style: { margin: '8px 0 16px' } }, p.tagline || 'Pas d\'accroche.'),
    table(['Version', 'Publiée le', 'Fichier', 'Notes', ''], p.versions.map(versionRow(p)), 'Aucune version en ligne : publiez-en une pour rendre le plugin installable.'));

  return [
    h('div', { class: 'row between', style: { 'margin-bottom': '16px' } },
      h('span', { class: 'muted' }, (() => {
        const missing = data.products.map((p) => [p, unlicensedSystems(p)]).filter(([, systems]) => systems.length);
        return `${data.products.length} plugin(s)` + (missing.length
          ? ` · sans système de licence : ${missing.map(([p, systems]) => `${p.name} (${systems.join(', ')})`).join(' ; ')}`
          : ' · tous les plugins payants vérifient leur licence');
      })()),
      button('Nouveau plugin', () => productForm(null))),
    data.products.map(panel),
  ];
}

//==============================================================================
//  Licences
//==============================================================================
function licenseForm(l) {
  const f = {
    type: h('select', { value: l.type }, Object.entries(LICENSE_TYPES).filter(([id]) => id !== 'subscription').map(([id, label]) => h('option', { value: id }, label))),
    expires: h('input', { type: 'date', value: dateInputValue(l.expiresAt) }),
    max: h('input', { type: 'number', min: 1, max: 50, value: l.maxActivations }),
    email: h('input', { type: 'email', value: l.email ?? '', placeholder: 'Laisser vide : clé libre' }),
    note: h('input', { value: l.note, maxLength: 200 }),
  };
  modal('Mettre à jour la licence', h('div', { class: 'stack' },
    h('div', { class: 'key' }, l.key),
    h('div', { class: 'grid2' }, field('Type', f.type), field('Machines autorisées', f.max)),
    field('Expire le (vide : jamais)', f.expires),
    field('Titulaire (e-mail)', f.email),
    field('Note interne', f.note)), [{
    label: 'Enregistrer',
    run: async () => ((await changed(() => api('PATCH', `/licenses/${l.id}`, {
      type: f.type.value, expiresAt: dateInputToMs(f.expires.value), maxActivations: Number(f.max.value),
      note: f.note.value, ...(f.email.value.trim().toLowerCase() !== (l.email ?? '') ? { email: f.email.value.trim() } : {}),
    }), 'Licence mise à jour.')) ? undefined : false),
  }], l.productName);
}

function licensesTab() {
  const g = {
    product: h('select', null, data.products.map((p) => h('option', { value: p.id }, p.name)),
      h('option', { value: 'all' }, `ALL LICENCE — les ${data.products.length} plugins, une seule clé`)),
    type: h('select', null, Object.entries(LICENSE_TYPES).filter(([id]) => id !== 'subscription').map(([id, label]) => h('option', { value: id }, label))),
    count: h('input', { type: 'number', min: 1, max: 200, value: 1 }),
    max: h('input', { type: 'number', min: 1, max: 50, value: 2 }),
    expires: h('input', { type: 'date' }),
    email: h('input', { type: 'email', placeholder: 'Facultatif' }),
    note: h('input', { maxLength: 200, placeholder: 'Ex. : beta-testeurs, partenaire…' }),
  };
  const generate = h('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      const created = await attempt(() => api('POST', '/licenses', {
        productId: g.product.value === 'all' ? 'all' : Number(g.product.value), type: g.type.value, count: Number(g.count.value), maxActivations: Number(g.max.value),
        expiresAt: dateInputToMs(g.expires.value), email: g.email.value.trim(), note: g.note.value,
      }));
      if (!created) return;
      ui.generated = created;
      toast(`${created.length} licence(s) générée(s).`);
      await reload();
    },
  },
    h('div', { class: 'grid3' }, field('Plugin', g.product), field('Type', g.type), field('Nombre de clés', g.count)),
    h('div', { class: 'grid3' }, field('Machines par clé', g.max), field('Expire le (vide : jamais)', g.expires), field('Réserver à (e-mail)', g.email)),
    field('Note interne', g.note),
    h('div', null, h('button', { class: 'btn primary', type: 'submit', disabled: !data.products.length }, 'Générer')));

  const generated = ui.generated ? h('div', { class: 'panel' },
    h('div', { class: 'row between' }, eyebrow(`${ui.generated.length} clé(s) pour ${ui.generated[0].productName}`),
      h('div', { class: 'row' },
        button('Copier tout', () => attempt(() => call('clipboard', ui.generated.map((l) => l.key).join('\r\n')), 'Clés copiées.'), 'small'),
        button('Fermer', () => { ui.generated = null; render(); }, 'small quiet'))),
    h('div', { class: 'stack', style: { gap: '4px', 'max-height': '180px', 'overflow-y': 'auto' } }, ui.generated.map((l) => h('div', { class: 'key' }, l.key)))) : null;

  const search = h('input', { type: 'search', placeholder: 'Chercher une clé, un e-mail, une note…', value: ui.licenseQuery });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { ui.licenseQuery = search.value; reload(); }
  });

  const expired = (l) => l.expiresAt && l.expiresAt < Date.now();
  const row = (l) => h('tr', { class: l.status !== 'active' || expired(l) ? 'off' : '' },
    h('td', null, h('button', { class: 'key copy', type: 'button', title: 'Copier la clé', onclick: () => attempt(() => call('clipboard', l.key), 'Clé copiée.') }, l.key),
      l.bundle ? h('div', { class: 'muted selectable mono', style: { 'font-size': '11px' }, title: 'Clé du pack ALL LICENCE dont cette licence fait partie' }, `ALL LICENCE · ${l.bundle}`) : null,
      l.note ? h('div', { class: 'muted', style: { 'font-size': '12px' } }, l.note) : null),
    h('td', null, l.productName),
    h('td', null, l.email ? h('span', { class: 'selectable' }, l.email) : h('span', { class: 'muted' }, 'Libre'), l.email && !l.claimed ? h('div', { class: 'muted', style: { 'font-size': '12px' } }, 'réservée') : null),
    h('td', null, LICENSE_TYPES[l.type] || l.type, h('div', { class: 'muted', style: { 'font-size': '12px' } }, l.expiresAt ? `${expired(l) ? 'expirée le' : 'jusqu\'au'} ${date(l.expiresAt)}` : 'sans limite')),
    h('td', { class: 'mono' }, `${l.activations ?? 0}/${l.maxActivations}`),
    h('td', null, l.status === 'active' ? h('div', { class: 'row' }, led(!expired(l)), expired(l) ? 'Expirée' : 'Active') : pill('Révoquée', 'warn')),
    h('td', { class: 'actions' },
      button('Modifier', () => licenseForm(l), 'small quiet'),
      l.activations ? button('Libérer', () => confirm('Libérer les machines ?', `Les ${l.activations} machine(s) activée(s) avec cette licence devront être réactivées.`,
        'Libérer', () => changed(() => api('POST', `/licenses/${l.id}/reset`), 'Machines libérées.')), 'small quiet') : null,
      l.status === 'active'
        ? button('Révoquer', () => confirm('Révoquer cette licence ?', `${l.key} ne permettra plus ni activation ni téléchargement. Vous pourrez la rétablir.`,
          'Révoquer', () => changed(() => api('PATCH', `/licenses/${l.id}`, { status: 'revoked' }), 'Licence révoquée.'), 'danger'), 'small quiet danger')
        : button('Rétablir', () => changed(() => api('PATCH', `/licenses/${l.id}`, { status: 'active' }), 'Licence rétablie.'), 'small quiet'),
      l.claimed ? null : button('Supprimer', () => confirm('Supprimer cette clé ?', `${l.key} n'a jamais été utilisée et disparaîtra définitivement.`,
        'Supprimer', () => changed(() => api('DELETE', `/licenses/${l.id}`), 'Clé supprimée.'), 'danger'), 'small quiet danger')));

  return [
    h('div', { class: 'panel' }, eyebrow('Générer des licences'), generate),
    generated,
    h('div', { class: 'panel' },
      h('div', { class: 'row between', style: { 'margin-bottom': '16px' } }, eyebrow('Toutes les licences'), h('div', { style: { width: '340px' } }, search)),
      table(['Clé', 'Plugin', 'Titulaire', 'Type', 'Machines', 'État', ''], data.licenses.map(row),
        ui.licenseQuery ? 'Aucune licence ne correspond.' : 'Aucune licence pour le moment.')),
  ];
}

//==============================================================================
//  Comptes
//==============================================================================
function usersTab() {
  const search = h('input', { type: 'search', placeholder: 'Chercher un e-mail ou un nom…', value: ui.userQuery });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { ui.userQuery = search.value; reload(); }
  });
  const self = state.data.me.user.id;
  // Seul un fondateur touche à un compte admin ou fondateur ; un admin donne les autres rôles aux autres comptes.
  const founder = state.data.me.user.role === 'founder';
  const manageable = (u) => u.id !== self && (founder || !isStaff(u));
  const grantable = Object.keys(ROLES).filter((role) => founder || !isStaff({ role }));

  const changeRole = (u) => {
    const role = h('select', null, grantable.map((id) => h('option', { value: id }, ROLES[id])));
    role.value = u.role;
    modal('Rôle du compte', h('div', { class: 'stack' },
      h('p', { class: 'muted', style: { margin: 0 } }, `Pour ${u.email}. VIP : tous les plugins offerts. Abrasion, Relic : le panel admin, limité à ses propres plugins et à leurs licences.`
        + (founder ? ' Admin : tout le panel, sauf les rôles admin et fondateur.' : '')),
      field('Rôle', role)), [{
      label: 'Enregistrer', run: async () => ((await changed(() => api('PATCH', `/users/${u.id}`, { role: role.value }), `Rôle de ${u.email} : ${ROLES[role.value]}.`)) ? undefined : false),
    }], 'Compte');
  };

  const resetPassword = (u) => {
    const password = h('input', { type: 'text', class: 'mono', minLength: 8, placeholder: '8 caractères minimum' });
    modal('Nouveau mot de passe', h('div', { class: 'stack' },
      h('p', { class: 'muted', style: { margin: 0 } }, `Pour ${u.email}. Toutes ses sessions seront fermées ; transmettez-lui le mot de passe par un canal sûr.`),
      field('Mot de passe', password)), [{
      label: 'Définir', run: async () => ((await changed(() => api('PATCH', `/users/${u.id}`, { password: password.value }), 'Mot de passe changé.')) ? undefined : false),
    }], 'Compte');
  };

  const row = (u) => h('tr', null,
    h('td', null, h('div', { class: 'selectable' }, u.email), u.name ? h('div', { class: 'muted', style: { 'font-size': '12px' } }, u.name) : null,
      u.emailVerified ? null : h('div', { style: { 'margin-top': '4px' } }, pill('Adresse non validée', 'warn'))),
    h('td', null, u.role === 'user' ? h('span', { class: 'muted' }, ROLES.user) : pill(roleName(u.role), isStaff(u) ? 'hot' : '')),
    h('td', { class: 'mono' }, String(u.licenses)),
    h('td', null, u.subscribed ? pill('Abonné', '', true) : h('span', { class: 'muted' }, '—')),
    h('td', { class: 'muted' }, date(u.createdAt)),
    h('td', { class: 'actions' },
      // Rend ses essais gratuits à un compte : il pourra relancer un essai de chaque plugin.
      u.trials ? button(`Réinitialiser les essais (${u.trials})`, () => confirm('Réinitialiser les essais gratuits ?',
        `Les ${u.trials} essai(s) de ${u.email}, en cours ou terminés, sont effacés : il pourra relancer un essai de 7 jours pour chaque plugin. Un essai en cours s'arrête tout de suite.`,
        'Réinitialiser', () => changed(() => api('POST', `/users/${u.id}/reset-trials`), 'Essais réinitialisés.')), 'small quiet') : null,
      u.emailVerified ? null : button('Valider l\'e-mail', () => confirm('Valider cette adresse à la main ?',
        `À faire seulement si vous êtes sûr que ${u.email} est bien l'adresse de la personne : elle n'aura plus à ouvrir le lien reçu.`,
        'Valider', () => changed(() => api('PATCH', `/users/${u.id}`, { emailVerified: true }), 'Adresse validée.')), 'small quiet'),
      u.id === self || manageable(u) ? button('Mot de passe', () => resetPassword(u), 'small quiet') : null,
      manageable(u) ? button('Rôle', () => changeRole(u), 'small quiet') : null));

  return h('div', { class: 'panel' },
    h('div', { class: 'row between', style: { 'margin-bottom': '16px' } }, eyebrow('Comptes'), h('div', { style: { width: '340px' } }, search)),
    table(['Compte', 'Rôle', 'Licences', 'Abonnement', 'Inscrit le', ''], data.users.map(row), 'Aucun compte ne correspond.'));
}

//==============================================================================
//==============================================================================
//  Crédits (les titres affichés sur la page d'accueil du site)
//==============================================================================
/** Les champs d'un crédit, vides pour un ajout ou remplis pour une modification. */
function creditFields(c) {
  const f = {
    link: h('input', { class: 'mono', placeholder: 'https://open.spotify.com/track/…', required: true, value: c ? `https://open.spotify.com/track/${c.spotifyId}` : '' }),
    artist: h('input', { maxLength: 120, required: true, value: c?.artist ?? '' }),
    title: h('input', { maxLength: 120, placeholder: c ? '' : 'Vide : le titre donné par Spotify', value: c?.title ?? '' }),
    plugin: h('select', null, h('option', { value: '' }, '— Aucun en particulier —'), data.products.map((p) => h('option', { value: p.id }, p.name))),
    usedOn: h('input', { maxLength: 60, placeholder: 'Voix, chœurs, mix…', value: c?.usedOn ?? '' }),
    released: h('input', { maxLength: 40, placeholder: '9 octobre 2026', value: c?.released ?? '' }),
    duration: h('input', { maxLength: 10, placeholder: '2:39', value: c?.duration ?? '' }),
    kind: h('select', null, [...new Set(['Single', 'EP', 'Album', 'Mixtape', c?.kind ?? 'Single'])].map((k) => h('option', { value: k }, k))),
  };
  // Un <select> ne prend sa valeur qu'une fois ses options en place.
  f.plugin.value = c?.plugin?.id ?? '';
  f.kind.value = c?.kind ?? 'Single';
  const values = () => ({
    spotifyUrl: f.link.value.trim(), artist: f.artist.value.trim(), title: f.title.value.trim(),
    productId: f.plugin.value ? Number(f.plugin.value) : null, usedOn: f.usedOn.value.trim(),
    released: f.released.value.trim(), duration: f.duration.value.trim(), kind: f.kind.value,
  });
  const layout = [
    h('div', { class: 'grid2' }, field('Lien Spotify du titre', f.link), field('Artiste', f.artist)),
    h('div', { class: 'grid3' }, field('Titre', f.title), field('Plugin utilisé', f.plugin), field('Utilisé sur', f.usedOn)),
    h('div', { class: 'grid3' }, field('Date de sortie', f.released), field('Durée', f.duration), field('Format', f.kind)),
  ];
  return { values, layout };
}

function creditsTab() {
  const { values, layout } = creditFields(null);
  const form = h('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      await changed(() => api('POST', '/credits', values()), 'Crédit ajouté : il est visible sur la page d\'accueil du site.');
    },
  }, layout, h('div', null, h('button', { class: 'btn primary', type: 'submit' }, 'Ajouter le crédit')));

  const edit = (c) => {
    const fields = creditFields(c);
    modal(`Modifier « ${c.title} »`, h('div', { class: 'stack' }, fields.layout,
      h('p', { class: 'muted', style: { margin: 0, 'font-size': '12.5px' } }, 'Changer le lien Spotify fait reprendre la pochette du nouveau titre.')), [{
      label: 'Enregistrer',
      run: async () => ((await changed(() => api('PATCH', `/credits/${c.id}`, fields.values()), 'Crédit enregistré.')) ? undefined : false),
    }], 'Crédit');
  };

  const row = (c) => h('tr', null,
    h('td', null, h('strong', null, c.title), h('span', { class: 'muted' }, ` · ${c.artist}`)),
    h('td', null, c.plugin ? c.plugin.name : h('span', { class: 'muted' }, '—'), c.usedOn ? h('div', { class: 'muted', style: { 'font-size': '12px' } }, c.usedOn) : null),
    h('td', { class: 'muted' }, c.released || '—'),
    h('td', null, c.cover ? pill('Pochette', '', true) : pill('Sans pochette', 'warn')),
    h('td', { class: 'actions' }, button('Modifier', () => edit(c), 'small quiet'), button('Retirer', () => confirm(`Retirer « ${c.title} » ?`, 'Le titre disparaît de la section Crédits du site.',
      'Retirer', () => changed(() => api('DELETE', `/credits/${c.id}`), 'Crédit retiré.'), 'danger'), 'small quiet danger')));

  return [
    h('div', { class: 'panel' }, eyebrow('Ajouter un titre'),
      h('p', { class: 'muted', style: { margin: '0 0 14px' } }, 'Collez le lien Spotify du titre : son nom et sa pochette sont récupérés tout seuls. Le titre apparaît dans la section Crédits de la page d\'accueil.'),
      form),
    h('div', { class: 'panel' }, eyebrow('Titres affichés sur le site'),
      table(['Titre', 'Plugin utilisé', 'Sortie', '', ''], data.credits.map(row), 'Aucun crédit : la page d\'accueil affiche le titre d\'exemple.')),
  ];
}

//==============================================================================
//  Paiements : un compte Stripe par créateur de plugins
//==============================================================================
function paymentsTab() {
  const p = data.payments;

  const account = (a) => {
    const label = CREATORS[a.creator] ?? a.creator;
    const key = h('input', { type: 'password', class: 'mono', placeholder: 'sk_live_…', autocomplete: 'off', spellcheck: false, required: true });
    const managed = h('input', { type: 'checkbox', checked: a.managed });
    const form = a.editable ? h('form', {
      class: 'stack', style: { 'margin-top': '14px' },
      onsubmit: (event) => {
        event.preventDefault();
        changed(() => api('PUT', `/payments/${a.creator}`, { secretKey: key.value.trim(), managed: managed.checked }),
          `Compte Stripe de ${label} branché : clé vérifiée, lien de notification créé.`);
      },
    },
      field(a.connected ? 'Remplacer par une autre clé secrète Stripe' : 'Clé secrète Stripe', key),
      h('label', { class: 'check' }, managed, 'Stripe est le vendeur officiel (Managed Payments) : il facture les clients et gère la TVA'),
      h('div', null, h('button', { class: 'btn primary', type: 'submit' }, a.connected ? 'Remplacer' : 'Brancher le compte')))
      : h('p', { class: 'muted', style: { margin: '10px 0 0' } }, `Seul un fondateur ou un compte ${label} peut régler ce compte.`);

    return h('div', { class: 'panel' },
      h('div', { class: 'row between wrap' },
        h('div', { class: 'row wrap' }, h('h2', null, label),
          a.connected ? pill(a.test ? 'Branché · mode essai' : 'Branché', a.test ? 'warn' : '', !a.test) : pill('Non branché', 'warn'),
          a.name ? h('span', { class: 'muted selectable' }, a.name) : null),
        a.connected && a.editable && !a.fromEnv ? button('Débrancher', () => confirm(`Débrancher le compte Stripe de ${label} ?`,
          `Ses plugins ne pourront plus être achetés tant qu'un compte n'est pas rebranché. Les licences déjà vendues ne changent pas.`,
          'Débrancher', () => changed(() => api('DELETE', `/payments/${a.creator}`), 'Compte débranché.'), 'danger'), 'small quiet danger') : null),
      a.test ? h('p', { class: 'muted', style: { margin: '10px 0 0' } }, 'Clé d\'essai : rien n\'est encaissé. Seuls l\'équipe et les comptes de ce créateur peuvent passer commande, avec la carte de test 4242 4242 4242 4242.') : null,
      a.fromEnv ? h('p', { class: 'muted', style: { margin: '10px 0 0' } }, 'Ce compte est réglé sur le serveur (commande onirique-stripe). Brancher une clé ici le remplace.') : null,
      form);
  };

  const sale = p.fixed
    ? [pill(`Vente réglée sur le serveur : ${p.mode}`, p.mode === 'off' ? 'warn' : '')]
    : [pill(p.mode === 'stripe' ? 'Vente ouverte' : p.open ? 'Vente ouverte, en attente d\'un compte branché' : 'Vente fermée', p.mode === 'stripe' ? '' : 'warn', p.mode === 'stripe'),
      p.founder ? button(p.open ? 'Fermer la vente' : 'Ouvrir la vente', () => confirm(p.open ? 'Fermer la vente ?' : 'Ouvrir la vente ?',
        p.open ? 'Plus aucun achat ni abonnement ne pourra être lancé, sur le site comme dans l\'application. Les licences et les abonnements en cours ne changent pas.'
          : 'Les plugins des créateurs dont le compte est branché pourront être achetés tout de suite, sur le site comme dans l\'application.',
        p.open ? 'Fermer' : 'Ouvrir', () => changed(() => api('PUT', '/payments/open', { open: !p.open }), p.open ? 'Vente fermée.' : 'Vente ouverte.', true)), 'small') : null];

  return [
    h('div', { class: 'panel' },
      h('div', { class: 'row between wrap' }, eyebrow('Vente en ligne'), h('div', { class: 'row' }, sale)),
      h('p', { class: 'muted', style: { margin: '12px 0 0' } },
        'Chaque créateur encaisse les ventes de ses plugins sur son propre compte Stripe. Les abonnements (All Access et à la carte) sont encaissés par le compte ONIRIQUE, quels que soient les plugins qu\'ils couvrent.'),
      h('p', { class: 'muted', style: { margin: '8px 0 0' } },
        'La clé se trouve dans le tableau de bord Stripe, rubrique Développeurs, Clés API. Elle est essayée auprès de Stripe, puis gardée chiffrée sur le serveur : elle ne s\'affiche plus jamais, ici ou ailleurs.')),
    p.accounts.map(account),
  ];
}

//==============================================================================
//  Codes promo : valables sur le site et dans l'application, une fois par compte
//==============================================================================
function promosTab() {
  const staff = isStaff(state.data.me.user);
  const nameOf = (id) => data.products.find((p) => p.id === id)?.name ?? 'plugin retiré';
  const f = {
    code: h('input', { class: 'mono', maxLength: 24, required: true, placeholder: 'NOEL20', style: { 'text-transform': 'uppercase' } }),
    kind: h('select', null, h('option', { value: 'percent' }, 'En pourcentage'), h('option', { value: 'amount' }, 'En euros')),
    value: h('input', { type: 'number', min: 1, step: 1, value: 20, required: true }),
    maxUses: h('input', { type: 'number', min: 1, placeholder: 'Sans limite' }),
    expires: h('input', { type: 'date' }),
    note: h('input', { maxLength: 200, placeholder: 'Ex. : influenceur, Black Friday…' }),
  };
  f.kind.addEventListener('change', () => { f.value.step = f.kind.value === 'amount' ? 0.01 : 1; });
  const picks = data.products.map((p) => ({ id: p.id, name: p.name, box: h('input', { type: 'checkbox' }) }));
  const generate = () => { f.code.value = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join(''); };
  const form = h('form', {
    class: 'stack',
    onsubmit: async (event) => {
      event.preventDefault();
      const amount = Number(String(f.value.value).replace(',', '.'));
      await changed(() => api('POST', '/promos', {
        code: f.code.value, note: f.note.value, maxUses: f.maxUses.value ? Number(f.maxUses.value) : null, expiresAt: dateInputToMs(f.expires.value),
        productIds: picks.filter((p) => p.box.checked).map((p) => p.id),
        ...(f.kind.value === 'percent' ? { percent: Math.round(amount) } : { amountCents: Math.round(amount * 100) }),
      }), `Code ${f.code.value.toUpperCase()} créé : il marche tout de suite sur le site et dans l'application.`);
    },
  },
    h('div', { class: 'grid3' }, field('Code', h('div', { class: 'row' }, f.code, button('Générer', generate, 'small quiet'))), field('Remise', f.kind), field('Valeur', f.value)),
    h('div', { class: 'grid3' }, field('Utilisations au total', f.maxUses), field('Valable jusqu\'au', f.expires), field('Note interne', f.note)),
    field(staff ? 'Plugins (aucun coché : tous)' : 'Plugins (aucun coché : tous les vôtres)', h('div', { class: 'row wrap', style: { gap: '6px 16px' } }, picks.map((p) => h('label', { class: 'check' }, p.box, p.name)))),
    h('div', null, h('button', { class: 'btn primary', type: 'submit' }, 'Créer le code')));

  const row = (p) => {
    const expired = p.expiresAt && p.expiresAt < Date.now(), full = p.maxUses && p.uses >= p.maxUses;
    return h('tr', { class: !p.active || expired || full ? 'off' : '' },
      h('td', null, h('button', { class: 'key copy', type: 'button', title: 'Copier le code', onclick: () => attempt(() => call('clipboard', p.code), 'Code copié.') }, p.code),
        p.note ? h('div', { class: 'muted', style: { 'font-size': '12px' } }, p.note) : null),
      h('td', null, p.label),
      h('td', { class: 'muted' }, p.productIds ? p.productIds.map(nameOf).join(', ') : p.creator ? `Plugins ${CREATORS[p.creator] ?? p.creator}` : 'Tous'),
      h('td', { class: 'mono' }, p.maxUses ? `${p.uses} / ${p.maxUses}` : String(p.uses)),
      h('td', { class: 'muted' }, p.expiresAt ? date(p.expiresAt) : '—'),
      h('td', null, !p.active ? pill('Désactivé', 'warn') : expired ? pill('Expiré', 'warn') : full ? pill('Épuisé', 'warn') : pill('Actif', '', true)),
      h('td', { class: 'actions' },
        button('Lien', () => attempt(() => call('clipboard', `https://onirique.store/boutique.html?code=${p.code}`), 'Lien de la boutique avec ce code copié.'), 'small quiet'),
        button(p.active ? 'Désactiver' : 'Réactiver', () => changed(() => api('PATCH', `/promos/${p.id}`, { active: !p.active }), p.active ? 'Code désactivé.' : 'Code réactivé.'), 'small quiet'),
        button('Supprimer', () => confirm(`Supprimer ${p.code} ?`, 'Le code ne pourra plus servir.', 'Supprimer', () => changed(() => api('DELETE', `/promos/${p.id}`), 'Code supprimé.'), 'danger'), 'small quiet danger')));
  };
  return [
    h('div', { class: 'panel' }, eyebrow('Nouveau code promo'),
      h('p', { class: 'muted', style: { margin: '0 0 14px' } }, 'Le client l\'entre au moment d\'acheter, sur le site ou dans l\'application. Il sert une fois par compte, sur les plugins (pas les abonnements).'),
      form),
    h('div', { class: 'panel' }, eyebrow('Codes'),
      table(['Code', 'Remise', 'Plugins', 'Utilisations', 'Fin', 'État', ''], data.promos.map(row), 'Aucun code pour le moment.')),
  ];
}

//==============================================================================
//  Parrainage
//==============================================================================
function referralTab() {
  const r = data.referral, s = r.settings;
  const tile = (label, value) => h('div', { class: 'panel tile', style: { 'margin-top': 0 } }, eyebrow(label), h('div', { class: 'value' }, String(value)));
  const f = {
    enabled: h('input', { type: 'checkbox', checked: s.enabled }),
    friend: h('input', { type: 'number', min: 0, max: 100, value: s.friendPercent }),
    reward: h('input', { type: 'number', min: 1, max: 100, value: s.rewardPercent }),
    milestone: h('input', { type: 'number', min: 0, max: 100, value: s.milestone }),
    days: h('input', { type: 'number', min: 7, max: 3650, value: s.rewardDays }),
  };
  return [
    h('div', { class: 'grid3' }, tile('Amis invités', r.invited), tile('Amis acheteurs', r.converted), tile('Codes offerts', `${r.rewardsUsed} / ${r.rewards} utilisés`)),
    h('div', { class: 'panel', style: { 'margin-top': '16px' } }, eyebrow('Réglages'),
      h('p', { class: 'muted', style: { margin: '0 0 14px' } }, 'L\'ami invité a une remise sur son premier plugin ONIRIQUE. À son premier achat payé, son parrain reçoit un code personnel, et à chaque palier d\'amis acheteurs un plugin ONIRIQUE offert. Les récompenses ne portent que sur les plugins ONIRIQUE.'),
      h('div', { class: 'stack' },
        h('label', { class: 'check' }, f.enabled, 'Parrainage ouvert'),
        h('div', { class: 'grid2' }, field('Remise de l\'ami invité (%)', f.friend), field('Code du parrain par ami acheteur (%)', f.reward)),
        h('div', { class: 'grid2' }, field('Plugin offert tous les … amis (0 : jamais)', f.milestone), field('Validité des codes (jours)', f.days)),
        h('div', null, button('Enregistrer', () => changed(() => api('PUT', '/referral', { enabled: f.enabled.checked, friendPercent: Number(f.friend.value),
          rewardPercent: Number(f.reward.value), milestone: Number(f.milestone.value), rewardDays: Number(f.days.value) }), 'Parrainage enregistré.'), 'primary')))),
    h('div', { class: 'panel' }, eyebrow('Meilleurs parrains'),
      table(['Compte', 'Amis inscrits', 'Amis acheteurs'], r.top.map((t) => h('tr', null, h('td', null, h('span', { class: 'selectable' }, t.email), t.name ? h('div', { class: 'muted', style: { 'font-size': '12px' } }, t.name) : null),
        h('td', { class: 'mono' }, String(t.invited)), h('td', { class: 'mono' }, String(t.converted || 0)))), 'Personne n\'a encore invité d\'ami.')),
  ];
}

//==============================================================================
//  E-mails : un message mis en page aux couleurs d'ONIRIQUE, envoyé aux inscrits depuis l'adresse d'ONIRIQUE
//==============================================================================
const draft = {}; // le message en cours, gardé quand on change d'onglet
function mailingsTab() {
  const m = data.mailings;
  const input = (key, props = {}) => {
    const node = h(props.tag ?? 'input', { ...props, tag: undefined, value: draft[key] ?? props.value ?? '' });
    node.addEventListener('input', () => { draft[key] = node.value; });
    return node;
  };
  const audience = h('select', null, m.audiences.map((a) => h('option', { value: a.id }, `${a.label} · ${a.count}`)));
  audience.value = draft.audience ?? 'newsletter';
  const service = h('input', { type: 'checkbox', checked: !!draft.service });
  const serviceLine = h('label', { class: 'check', style: { display: audience.value === 'all' ? '' : 'none', 'align-items': 'flex-start' } }, service,
    h('span', null, 'C\'est une information de service (conditions, sécurité, panne), sans publicité : la loi interdit d\'envoyer de la publicité aux comptes qui ne l\'ont pas acceptée.'));
  audience.addEventListener('change', () => { draft.audience = audience.value; serviceLine.style.display = audience.value === 'all' ? '' : 'none'; });
  service.addEventListener('change', () => { draft.service = service.checked; });
  const f = {
    subject: input('subject', { maxLength: 140, placeholder: 'Nouveau : MeterBox est sorti' }),
    preheader: input('preheader', { maxLength: 160, placeholder: 'La phrase grise après l\'objet' }),
    eyebrow: input('eyebrow', { maxLength: 40, value: 'Nouveautés' }),
    title: input('title', { maxLength: 120, placeholder: 'Salut {prenom} !' }),
    text: input('text', { tag: 'textarea', rows: 9, maxLength: 12000, placeholder: 'Une ligne vide entre deux paragraphes. {prenom} : le prénom. **gras**, [texte](https://…), # intertitre' }),
    image: input('image', { type: 'url', placeholder: 'https://… (facultatif)' }),
    promoCode: input('promoCode', { class: 'mono', maxLength: 40, placeholder: 'Facultatif' }),
    promoText: input('promoText', { maxLength: 140, placeholder: '-20 % jusqu\'à dimanche' }),
    buttonLabel: input('buttonLabel', { maxLength: 40, placeholder: 'Voir la boutique' }),
    buttonUrl: input('buttonUrl', { type: 'url', placeholder: 'https://onirique.store/boutique.html' }),
  };
  draft.productIds ??= [];
  const picks = data.products.filter((p) => p.published).map((p) => {
    const box = h('input', { type: 'checkbox', checked: draft.productIds.includes(p.id) });
    box.addEventListener('change', () => { draft.productIds = box.checked ? [...draft.productIds, p.id] : draft.productIds.filter((id) => id !== p.id); });
    return h('label', { class: 'check' }, box, p.name);
  });
  const content = () => ({ ...Object.fromEntries(Object.entries(f).map(([key, node]) => [key, node.value])), productIds: draft.productIds, audience: audience.value, service: service.checked });
  const preview = async () => {
    const result = await attempt(() => api('POST', '/mailings/preview', content()));
    if (result) await call('admin:previewMail', result.html);
  };
  const send = () => {
    const a = m.audiences.find((x) => x.id === audience.value);
    confirm(`Envoyer à ${a.count} personne(s) ?`, `« ${f.subject.value} » part vers : ${a.label}. Environ ${Math.max(1, Math.ceil(a.count * 3 / 60))} minute(s), un message toutes les trois secondes.`, 'Envoyer',
      async () => { if (await changed(() => api('POST', '/mailings', content()), 'Envoi lancé : il continue même si vous fermez l\'application.')) Object.keys(draft).forEach((k) => delete draft[k]); });
  };
  const state = { sending: 'En cours', sent: 'Terminé', cancelled: 'Arrêté' };
  // Un envoi en cours : l'onglet se relit toutes les cinq secondes.
  if (m.mailings.some((x) => x.status === 'sending')) setTimeout(() => { if (data.mailings === m) reload('mailings'); }, 5000);
  return [
    m.mailEnabled ? null : h('p', null, pill('Aucun serveur de messagerie relié : envoi impossible', 'warn')),
    h('div', { class: 'panel' }, eyebrow('Nouveau message'),
      h('p', { class: 'muted', style: { margin: '0 0 14px' } }, `Envoyé depuis ${m.from}, mis en page aux couleurs d'ONIRIQUE, avec un lien de désinscription dans chaque message.`),
      h('div', { class: 'stack' },
        field('Destinataires', audience), serviceLine,
        h('div', { class: 'grid2' }, field('Objet', f.subject), field('Phrase d\'aperçu', f.preheader)),
        h('div', { class: 'grid2' }, field('Petit titre', f.eyebrow), field('Titre', f.title)),
        field('Message', f.text), field('Image en tête (adresse)', f.image),
        field('Plugins mis en avant', h('div', { class: 'row wrap', style: { gap: '6px 16px' } }, picks)),
        h('div', { class: 'grid2' }, field('Code promo', f.promoCode), field('Texte du code', f.promoText)),
        h('div', { class: 'grid2' }, field('Texte du bouton', f.buttonLabel), field('Lien du bouton', f.buttonUrl)),
        h('div', { class: 'row' }, button('Aperçu', preview), button('M\'envoyer un essai', () => attempt(async () => { const r = await api('POST', '/mailings/test', content()); return r; }, 'Essai envoyé sur votre adresse.')),
          button('Envoyer', send, 'primary')))),
    h('div', { class: 'panel' }, eyebrow('Envois'),
      table(['Date', 'Objet', 'Destinataires', 'Avancement', ''], m.mailings.map((x) => h('tr', null,
        h('td', { class: 'muted' }, date(x.createdAt)),
        h('td', null, x.subject, x.author ? h('div', { class: 'muted', style: { 'font-size': '12px' } }, `par ${x.author}`) : null),
        h('td', { class: 'muted' }, x.audienceLabel),
        h('td', null, `${x.sent} / ${x.total}${x.failed ? ` · ${x.failed} non remis` : ''} · ${state[x.status] ?? x.status}`,
          h('div', { class: 'progress', style: { 'margin-top': '6px' } }, h('i', { style: { width: `${x.total ? Math.round((x.sent + x.failed) / x.total * 100) : 0}%` } }))),
        h('td', { class: 'actions' }, x.status === 'sending' ? button('Arrêter', () => changed(() => api('POST', `/mailings/${x.id}/cancel`), 'Envoi arrêté.'), 'small quiet danger') : null))),
      'Aucun envoi pour le moment.')),
  ];
}

const TABS = { overview: ['Vue d\'ensemble', overviewTab], products: ['Plugins', productsTab], licenses: ['Licences', licensesTab], users: ['Comptes', usersTab],
  promos: ['Codes promo', promosTab], referral: ['Parrainage', referralTab], mailings: ['E-mails', mailingsTab], credits: ['Crédits', creditsTab], payments: ['Paiements', paymentsTab] };

export function adminView() {
  // Un partenaire n'a que ses plugins et leurs licences.
  const staff = isStaff(state.data.me.user);
  const tabs = Object.entries(TABS).filter(([id]) => staff || id === 'products' || id === 'licenses' || id === 'payments' || id === 'promos');
  if (!tabs.some(([id]) => id === state.adminTab)) state.adminTab = tabs[0][0];
  const tab = state.adminTab;
  const ready = READY[tab]();
  // Un chargement en échec n'est pas relancé tout seul : l'erreur reste affichée avec un bouton.
  if (!ready && !ui.loading && !ui.error) reload(tab);
  const body = ui.error
    ? h('div', { class: 'panel empty' }, h('p', null, ui.error), button('Réessayer', () => reload(tab)))
    : ready ? TABS[tab][1]() : h('div', { class: 'panel empty mono' }, 'Chargement…');

  return [
    eyebrow('Studio'),
    h('h1', null, 'Panel ', h('em', null, 'admin')),
    h('p', { class: 'lede' }, staff ? 'Publiez les nouvelles versions, générez et mettez à jour les licences, gérez les comptes.'
      : 'Vos plugins : publiez leurs nouvelles versions, générez et mettez à jour leurs licences.'),
    h('div', { class: 'segmented', style: { 'margin-bottom': '20px' } }, tabs.map(([id, [label]]) => h('button', {
      type: 'button', class: tab === id ? 'active' : '',
      onclick: () => { state.adminTab = id; closeModal(); reload(id); },
    }, label))),
    body,
  ];
}

/**
 * Un plugin publié depuis le site n'a pas d'aperçu : un navigateur ne peut pas charger un .vst3. Dès qu'un admin
 * ouvre l'application, les aperçus manquants sont fabriqués ici, un essai par version.
 */
let filling = false;
export async function fillMissingDemos() {
  // L'outil qui charge les .vst3 n'existe que pour Windows.
  if (filling || !state.data?.me || !isStaff(state.data.me.user) || window.central.platform !== 'win32') return;
  filling = true;
  let tried = [];
  try { tried = JSON.parse(localStorage.getItem('onirique.demosTried')) || []; } catch { /* rien de gardé */ }
  let made = false;
  for (const p of state.data.catalog.products) {
    if (p.demo || p.demoOff || !p.latest || !/\.vst3$/i.test(p.latest.filename) || tried.includes(p.latest.id)) continue;
    tried.push(p.latest.id);
    try { localStorage.setItem('onirique.demosTried', JSON.stringify(tried)); } catch { /* réessayé au prochain lancement */ }
    toast(`Création de l'aperçu de ${p.name} : son interface s'ouvre à l'écran une à trois minutes, ne la fermez pas.`);
    try {
      await call('admin:refreshDemo', p.id);
      made = true;
      toast(`Aperçu de ${p.name} en ligne.`);
    } catch (error) {
      toast(`Aperçu de ${p.name} impossible : ${error.message} Réessayez depuis Panel admin, Plugins.`, true);
    }
  }
  filling = false;
  if (made) { data.products = null; await refresh(); }
}
