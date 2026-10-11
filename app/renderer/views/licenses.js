import { h, eyebrow, pill, led, button, date, attempt, confirm, LICENSE_TYPES } from '../ui.js';
import { state, call, refresh } from '../app.js';

export function licensesView() {
  const { me, catalog, machineId, machineName } = state.data;
  const productName = (id) => catalog.products.find((p) => p.id === id)?.name ?? 'Plugin retiré';

  const key = h('input', { class: 'mono', placeholder: 'ONIR-XXXX-XXXX-XXXX-XXXX', maxLength: 40, autocapitalize: 'characters' });
  key.spellcheck = false;
  const redeem = h('form', {
    class: 'row',
    onsubmit: async (event) => {
      event.preventDefault();
      if (!key.value.trim()) return;
      if (await attempt(() => call('api', 'POST', '/api/licenses/redeem', { key: key.value }), 'Licence ajoutée à votre compte.')) await refresh();
    },
  }, h('div', { class: 'grow' }, key), h('button', { class: 'btn primary', type: 'submit' }, 'Ajouter'));

  const expired = (l) => l.expiresAt && l.expiresAt < Date.now();
  const licenseRow = (l) => h('tr', { class: l.status !== 'active' || expired(l) ? 'off' : '' },
    h('td', null, l.productName),
    h('td', null, h('span', { class: 'key' }, l.key)),
    h('td', null, LICENSE_TYPES[l.type] || l.type),
    h('td', null, l.status === 'revoked' ? pill('Révoquée', 'warn') : expired(l) ? pill('Expirée', 'warn') : l.expiresAt ? date(l.expiresAt) : 'Sans limite'),
    h('td', { class: 'actions' }, button('Copier', () => attempt(() => call('clipboard', l.key), 'Clé copiée.'), 'small quiet')));

  const machineRow = (a) => h('tr', null,
    h('td', null, productName(a.productId)),
    h('td', null, h('div', { class: 'row' }, led(a.machineId === machineId), a.machineName || 'Machine sans nom',
      a.machineId === machineId ? pill('Ce PC') : null)),
    h('td', { class: 'muted' }, `Vue le ${date(a.lastSeenAt)}`),
    h('td', { class: 'actions' }, button('Désactiver', () => confirm('Désactiver cette machine ?',
      `${productName(a.productId)} ne s'y ouvrira plus à sa prochaine vérification. La place est rendue.`, 'Désactiver',
      async () => { await attempt(() => call('license:deactivate', a.productId, a.machineId), 'Machine désactivée.'); await refresh(); }), 'small danger')));

  return [
    eyebrow('Licences'),
    h('h1', null, 'Vos ', h('em', null, 'licences')),
    h('p', { class: 'lede' }, `Chaque licence s'active sur un nombre limité de machines. Ce PC s'appelle ${machineName}.`),

    h('div', { class: 'panel' }, eyebrow('Ajouter une clé de licence'), redeem),

    h('div', { class: 'panel' }, eyebrow('Sur votre compte'),
      me.subscription?.status === 'active' ? h('div', { class: 'row', style: { 'margin-bottom': '14px' } },
        pill(me.subscription.productIds ? 'À la carte' : 'All Access', 'hot', true),
        h('span', { class: 'muted' }, `${me.subscription.productIds ? `${me.subscription.productIds.length} plugin(s) inclus` : 'Tous les plugins inclus'} jusqu'au ${date(me.subscription.currentPeriodEnd)}.`)) : null,
      me.licenses.length
        ? h('table', null, h('thead', null, h('tr', null, ['Plugin', 'Clé', 'Type', 'Validité', ''].map((t) => h('th', null, t)))),
          h('tbody', null, me.licenses.map(licenseRow)))
        : h('div', { class: 'empty' }, 'Aucune licence pour le moment. Achetez un plugin ou entrez une clé ci-dessus.')),

    h('div', { class: 'panel' }, eyebrow('Machines activées'),
      me.activations.length
        ? h('table', null, h('tbody', null, me.activations.map(machineRow)))
        : h('div', { class: 'empty' }, 'Aucune machine activée. L\'activation se fait à l\'installation d\'un plugin.')),
  ];
}
