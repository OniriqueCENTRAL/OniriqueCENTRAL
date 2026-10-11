import { h, eyebrow, pill, button, euros, date, attempt, confirm } from '../ui.js';
import { state, call, refresh } from '../app.js';
import { buy } from './library.js';

export function subscriptionView() {
  const { me, catalog } = state.data;
  const sub = me.subscription?.status === 'active' ? me.subscription : null;

  const current = sub ? h('div', { class: 'panel plan current' },
    h('div', { class: 'row between' }, eyebrow('Votre abonnement'), pill(sub.cancelAtPeriodEnd ? 'Se termine' : 'Actif', 'hot', true)),
    h('h2', null, sub.planName),
    h('p', { class: 'muted', style: { margin: 0 } }, sub.cancelAtPeriodEnd
      ? `Résilié : vous gardez l'accès à tous les plugins jusqu'au ${date(sub.currentPeriodEnd)}.`
      : `Prochaine échéance le ${date(sub.currentPeriodEnd)} — ${euros(sub.priceCents)} par ${sub.interval === 'year' ? 'an' : 'mois'}.`),
    sub.cancelAtPeriodEnd ? null : h('div', null, button('Résilier', () => confirm('Résilier l\'abonnement ?',
      `Vous gardez l'accès jusqu'au ${date(sub.currentPeriodEnd)}. Ensuite, seuls les plugins achetés à l'unité restent utilisables.`, 'Résilier',
      async () => { await attempt(() => call('api', 'POST', '/api/subscription/cancel'), 'Abonnement résilié.'); await refresh(); }, 'danger'), 'small danger')))
    : null;

  const plan = (p) => h('div', { class: 'panel plan' },
    eyebrow(p.interval === 'year' ? 'Annuel' : 'Mensuel'),
    h('h2', null, p.name),
    h('div', { class: 'amount' }, euros(p.priceCents), h('small', null, p.interval === 'year' ? ' / AN' : ' / MOIS')),
    h('p', { class: 'muted', style: { margin: 0 } }, `Les ${catalog.products.length} plugins ONIRIQUE, toutes les mises à jour, et chaque nouveau plugin dès sa sortie.`),
    h('div', null, button(sub ? 'Déjà abonné' : 'S\'abonner', () => buy('plan', p), 'primary', { disabled: !!sub })));

  return [
    eyebrow('Abonnement'),
    h('h1', null, 'All ', h('em', null, 'Access')),
    h('p', { class: 'lede' }, 'Un seul abonnement pour toute la collection. Les plugins achetés à l\'unité vous restent acquis, abonnement ou non.'),
    catalog.paymentsMode === 'demo' ? h('p', null, pill('Mode démo — aucun paiement réel', 'warn')) : null,
    current,
    catalog.plans.length
      ? h('div', { class: 'grid2', style: { 'margin-top': '16px' } }, catalog.plans.map(plan))
      : h('div', { class: 'panel empty' }, 'Aucune formule proposée pour le moment.'),
  ];
}
