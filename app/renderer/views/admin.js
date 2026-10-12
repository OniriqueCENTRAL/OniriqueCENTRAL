import {
  h, eyebrow, pill, led, field, button, euros, date, megabytes, dateInputValue, dateInputToMs,
  toast, attempt, modal, confirm, closeModal, LICENSE_TYPES,
} from '../ui.js';
import { state, call, refresh, render, go } from '../app.js';

const api = (method, route, body) => call('api', method, `/api/admin${route}`, body);

/** Données du panel, chargées onglet par onglet. */
const data = { overview: null, plans: null, credits: null, products: null, licenses: null, users: null };
const ui = { licenseQuery: '', userQuery: '', generated: null, loading: false, error: null };

const LOADERS = {
  overview: async () => { [data.overview, data.plans] = await Promise.all([api('GET', '/overview'), api('GET', '/plans')]); },
  products: async () => { data.products = await api('GET', '/products'); },
  licenses: async () => {
    [data.licenses, data.products] = await Promise.all([
      api('GET', `/licenses?q=${encodeURIComponent(ui.licenseQuery)}`), data.products ?? api('GET', '/products')]);
  },
  users: async () => { data.users = await api('GET', `/users?q=${encodeURIComponent(ui.userQuery)}`); },
  credits: async () => { [data.credits, data.products] = await Promise.all([api('GET', '/credits'), data.products ?? api('GET', '/products')]); },
};
const READY = {
  overview: () => data.overview && data.plans,
  products: () => data.products,
  licenses: () => data.licenses && data.products,
  users: () => data.users,
  credits: () => data.credits && data.products,
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

  return [
    o.paymentsMode !== 'stripe' ? h('p', null, pill(o.paymentsMode === 'demo'
      ? 'Paiements en mode démo : les achats sont accordés sans paiement' : 'Paiements fermés : seules les clés de licence donnent accès', 'warn')) : null,
    h('div', { class: 'grid3' },
      tile('Comptes', o.users), tile('Licences actives', o.licenses), tile('Clés en attente', o.unclaimed),
      tile('Abonnés', o.subscribers), tile('Machines activées', o.activations), tile('Ventes Stripe', euros(o.revenueCents).replace('Gratuit', '0 €'))),
    h('div', { class: 'panel', style: { 'margin-top': '16px' } }, eyebrow('Formules d\'abonnement'),
      table(['Nom', 'Prix (€)', '', '', ''], data.plans.filter((p) => p.kind !== 'pick').map(planRow), 'Aucune formule.'),
      h('p', { class: 'muted', style: { margin: '14px 0 0', 'font-size': '12.5px' } },
        'L\'abonnement à la carte (un prix pour le premier plugin, un supplément par plugin ajouté) se règle dans la configuration du serveur.')),
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
  };
  const body = h('div', { class: 'stack' },
    field('Nom', f.name), field('Accroche', f.tagline),
    field('Description (une ligne vide entre les paragraphes)', f.description),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Prix (€) — 0 pour gratuit', f.price)), field('Couleur', f.accent)),
    h('label', { class: 'check' }, f.published, 'Visible dans la bibliothèque'));
  modal(product ? `Modifier ${product.name}` : 'Nouveau plugin', body, [{
    label: product ? 'Enregistrer' : 'Créer',
    run: async () => {
      const payload = { name: f.name.value, tagline: f.tagline.value, description: f.description.value,
        priceCents: toCents(f.price), accent: f.accent.value, published: f.published.checked };
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
        pill(p.published ? 'Publié' : 'Masqué', p.published ? '' : 'warn'),
        pill(euros(p.priceCents)), p.demo ? pill('Démo en ligne', '', true) : pill('Pas de démo', 'warn'),
        ...SYSTEMS.filter(([key]) => p.licensed?.[key] !== undefined).map(([key, label]) => licensePill(p.licensed[key], label, p.priceCents > 0))),
      h('div', { class: 'row' },
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
    h('td', null, u.role === 'admin' ? pill('Admin', 'hot') : h('span', { class: 'muted' }, 'Utilisateur')),
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
      button('Mot de passe', () => resetPassword(u), 'small quiet'),
      u.id === self ? null : u.role === 'admin'
        ? button('Retirer admin', () => changed(() => api('PATCH', `/users/${u.id}`, { role: 'user' }), 'Rôle admin retiré.'), 'small quiet danger')
        : button('Rendre admin', () => confirm('Donner le rôle admin ?', `${u.email} pourra publier des versions, générer et révoquer des licences.`,
          'Rendre admin', () => changed(() => api('PATCH', `/users/${u.id}`, { role: 'admin' }), 'Rôle admin accordé.')), 'small quiet')));

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

const TABS = { overview: ['Vue d\'ensemble', overviewTab], products: ['Plugins', productsTab], licenses: ['Licences', licensesTab], users: ['Comptes', usersTab], credits: ['Crédits', creditsTab] };

export function adminView() {
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
    h('p', { class: 'lede' }, 'Publiez les nouvelles versions, générez et mettez à jour les licences, gérez les comptes.'),
    h('div', { class: 'segmented', style: { 'margin-bottom': '20px' } }, Object.entries(TABS).map(([id, [label]]) => h('button', {
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
  if (filling || state.data?.me?.user.role !== 'admin' || window.central.platform !== 'win32') return;
  filling = true;
  let tried = [];
  try { tried = JSON.parse(localStorage.getItem('onirique.demosTried')) || []; } catch { /* rien de gardé */ }
  let made = false;
  for (const p of state.data.catalog.products) {
    if (p.demo || !p.latest || !/\.vst3$/i.test(p.latest.filename) || tried.includes(p.latest.id)) continue;
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
