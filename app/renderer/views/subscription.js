import { h, eyebrow, pill, button, euros, date, attempt, confirm } from '../ui.js';
import { state, call, refresh } from '../app.js';
import { buy } from './library.js';

/** Abonnement à la carte : on coche les plugins voulus, le prix suit. Le serveur refait le calcul au paiement. */
function pickPanel(sub) {
  const { catalog } = state.data;
  // Les abonnements ne couvrent que les plugins ONIRIQUE : ceux des créateurs partenaires s'achètent à l'unité.
  const paid = catalog.products.filter((p) => p.priceCents > 0 && p.creator === 'onirique');
  if (!catalog.pick || !paid.length) return null;
  const { baseCents, extraCents } = catalog.pick;
  const priceOf = (count) => baseCents + extraCents * Math.max(0, count - 1);

  const amount = h('div', { class: 'amount' });
  const subscribe = button('S\'abonner', () => {
    const chosen = boxes.filter((b) => b.box.checked).map((b) => b.product);
    buy('pick', {
      name: `À la carte — ${chosen.map((p) => p.name.replace(/^ONIRIQUE\s+/i, '')).join(', ')}`,
      interval: 'month', priceCents: priceOf(chosen.length), productIds: chosen.map((p) => p.id),
    });
  }, 'primary');

  function update() {
    const count = boxes.filter((b) => b.box.checked).length;
    amount.replaceChildren(count ? euros(priceOf(count)) : `dès ${euros(baseCents)}`, h('small', null, ' / MOIS'));
    subscribe.disabled = !!sub || !count;
    subscribe.textContent = sub ? 'Déjà abonné' : 'S\'abonner';
  }

  const boxes = paid.map((product) => {
    const box = h('input', { type: 'checkbox', disabled: !!sub, onchange: update });
    return { box, product, row: h('label', { class: 'check', style: { display: 'flex' } }, box,
      h('span', null, product.name), h('span', { class: 'muted', style: { 'font-size': '12.5px' } }, product.tagline)) };
  });
  update();

  return h('div', { class: 'panel plan', style: { 'margin-top': '16px' } },
    eyebrow('À la carte'),
    h('h2', null, 'Seulement les plugins qu\'il vous faut'),
    h('p', { class: 'muted', style: { margin: 0 } },
      `${euros(baseCents)} par mois pour le premier plugin, puis ${euros(extraCents)} par mois pour chaque plugin ajouté. Mises à jour comprises, résiliable à tout moment.`),
    h('div', { class: 'stack', style: { gap: '8px', margin: '6px 0' } }, boxes.map((b) => b.row)),
    amount,
    h('div', null, subscribe));
}

export function subscriptionView() {
  const { me, catalog } = state.data;
  const sub = me.subscription?.status === 'active' ? me.subscription : null;
  // Ce que couvre l'abonnement en cours : tout le catalogue, ou les plugins choisis à la carte.
  const covered = sub?.productIds
    ? catalog.products.filter((p) => sub.productIds.includes(p.id)).map((p) => p.name).join(', ') || `${sub.productIds.length} plugin(s)`
    : 'tous les plugins ONIRIQUE';

  const current = sub ? h('div', { class: 'panel plan current' },
    h('div', { class: 'row between' }, eyebrow('Votre abonnement'), pill(sub.cancelAtPeriodEnd ? 'Se termine' : 'Actif', 'hot', true)),
    h('h2', null, sub.planName),
    sub.productIds ? h('p', { class: 'muted', style: { margin: 0 } }, `Plugins inclus : ${covered}.`) : null,
    h('p', { class: 'muted', style: { margin: 0 } }, sub.cancelAtPeriodEnd
      ? `Résilié : vous gardez l'accès jusqu'au ${date(sub.currentPeriodEnd)}.`
      : `Prochaine échéance le ${date(sub.currentPeriodEnd)} — ${euros(sub.priceCents)} par ${sub.interval === 'year' ? 'an' : 'mois'}.`),
    sub.cancelAtPeriodEnd ? null : h('div', null, button('Résilier', () => confirm('Résilier l\'abonnement ?',
      `Vous gardez l'accès jusqu'au ${date(sub.currentPeriodEnd)}. Ensuite, seuls les plugins achetés à l'unité restent utilisables.`, 'Résilier',
      async () => { await attempt(() => call('api', 'POST', '/api/subscription/cancel'), 'Abonnement résilié.'); await refresh(); }, 'danger'), 'small danger')))
    : null;

  const plan = (p) => h('div', { class: 'panel plan' },
    eyebrow(p.interval === 'year' ? 'Annuel' : 'Mensuel'),
    h('h2', null, p.name),
    h('div', { class: 'amount' }, euros(p.priceCents), h('small', null, p.interval === 'year' ? ' / AN' : ' / MOIS')),
    h('p', { class: 'muted', style: { margin: 0 } }, p.description || (p.productIds?.length
      ? 'Les plugins ci-dessous, avec toutes leurs mises à jour, tant que l\'abonnement est actif.'
      : `Les ${catalog.products.filter((x) => x.creator === 'onirique').length} plugins ONIRIQUE, toutes les mises à jour, et chaque nouveau plugin ONIRIQUE dès sa sortie. Les plugins des créateurs partenaires s'achètent à l'unité.`)),
    p.productIds?.length ? h('div', { class: 'row wrap', style: { gap: '6px' } },
      p.productIds.map((id) => catalog.products.find((x) => x.id === id)).filter(Boolean).map((x) => pill(x.name.replace(/^ONIRIQUE\s+/i, '')))) : null,
    h('div', null, button(sub ? 'Déjà abonné' : 'S\'abonner', () => buy('plan', p), 'primary', { disabled: !!sub })));

  // Packs : un achat unique, une licence définitive pour chaque plugin du pack.
  const pack = (p) => {
    const items = p.productIds.map((id) => catalog.products.find((x) => x.id === id)).filter(Boolean);
    const full = items.reduce((sum, x) => sum + x.priceCents, 0);
    const owned = items.every((x) => me.entitlements?.[x.id]?.via === 'license' && me.entitlements[x.id].type !== 'trial');
    return h('div', { class: 'panel plan' },
      eyebrow('Pack · paiement unique'),
      h('h2', null, p.name),
      h('div', { class: 'amount' }, euros(p.priceCents), full > p.priceCents ? h('small', { style: { 'text-decoration': 'line-through', 'margin-left': '10px' } }, euros(full)) : null),
      p.description ? h('p', { class: 'muted', style: { margin: 0 } }, p.description) : null,
      h('div', { class: 'row wrap', style: { gap: '6px' } }, items.map((x) => pill(x.name.replace(/^ONIRIQUE\s+/i, '')))),
      h('div', null, button(owned ? 'Déjà possédé' : 'Acheter le pack', () => buy('pack', { ...p, name: `Pack ${p.name}` }), 'primary', { disabled: owned })));
  };

  return [
    eyebrow('Abonnement'),
    h('h1', null, 'Votre ', h('em', null, 'abonnement')),
    h('p', { class: 'lede' }, 'Toute la collection avec All Access, ou seulement les plugins de votre choix, à la carte. Les plugins achetés à l\'unité vous restent acquis, abonnement ou non.'),
    catalog.paymentsMode === 'demo' ? h('p', null, pill('Mode démo — aucun paiement réel', 'warn')) : null,
    current,
    catalog.plans.length
      ? h('div', { class: 'grid2', style: { 'margin-top': '16px' } }, catalog.plans.map(plan))
      : null,
    catalog.packs?.length ? h('div', { class: 'grid2', style: { 'margin-top': '16px' } }, catalog.packs.filter((p) => p.productIds.every((id) => catalog.products.some((x) => x.id === id))).map(pack)) : null,
    pickPanel(sub),
    !catalog.plans.length && !catalog.pick ? h('div', { class: 'panel empty' }, 'Aucune formule proposée pour le moment.') : null,
  ];
}
