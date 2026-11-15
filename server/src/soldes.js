// LES SOLDES DU SITE : une remise qui s'applique toute seule au paiement, sans code, pendant une période donnée.
// Elle passe par quote() (promos.js), comme les codes : c'est la plus forte remise qui gagne, rien ne se cumule, et le
// prix est toujours recalculé par le serveur au moment de payer. Seuls les plugins ONIRIQUE payants sont concernés
// (pas ceux des partenaires). Une fois la date passée, tout revient au prix normal sans rien toucher.
//
// Black Friday 2026, choisi par Nov : -30 % sur les plus gros plugins (HALO compris, dès sa sortie), -20 % sur les quatre
// suivants, jusqu'au 1er décembre inclus (23 h 59, heure de Paris).
import { get, now } from './db.js';
import { config } from './config.js';

export const SOLDES = {
  id: 'black-friday-2026',
  nom: 'Black Friday',
  fin: Date.parse('2026-12-01T23:59:59+01:00'),
  finTexte: "jusqu'au 1er décembre",
  remises: {
    vocalbox: 30, 'onirique-eclipse': 30, based: 30, 'onirique-halo': 30,
    'onirique-n73': 20, 'onirique-doublebox': 20, 'onirique-resobox': 20, 'onirique-modbox': 20,
  },
  // Le dernier sorti passe en tête de la liste des offres.
  enTete: 'onirique-halo',
  // Les abonnements (ALL ACCESS, ESSENTIAL ; pas la formule à la carte) : la remise porte sur le début de l'abonnement,
  // puis le prix normal revient tout seul. Un coupon Stripe s'en charge (payments.js) ; il n'est plus accepté après la date.
  abonnements: {
    year: { percent: 30, months: 12, texte: 'la première année' },
    month: { percent: 30, months: 3, texte: 'les 3 premiers mois' },
  },
};

// SOLDES=off coupe les soldes (les tests qui vérifient les prix normaux).
export const soldesEnCours = (at = now()) => process.env.SOLDES !== 'off' && at <= SOLDES.fin;

/** La remise d'un plugin en ce moment, ou null : { percent, priceCents (prix soldé), label, name, endsAt, until }. */
export function saleOf(p, at = now()) {
  const percent = SOLDES.remises[p?.slug];
  const price = p?.price_cents ?? p?.priceCents ?? 0;
  if (!percent || !soldesEnCours(at) || price <= 0 || (p.creator && p.creator !== 'onirique')) return null;
  return { percent, priceCents: Math.round(price * (100 - percent) / 100), label: `-${percent} %`, name: SOLDES.nom, endsAt: SOLDES.fin, until: SOLDES.finTexte };
}

/**
 * La remise d'une formule d'abonnement en ce moment, ou null : { percent, priceCents (prix remisé d'une période), months,
 * label, name, endsAt, until, periodText }. Pas avec Lemon Squeezy, qui ne sait pas remettre un abonnement au prix normal.
 */
export function planSaleOf(plan, at = now()) {
  const offer = SOLDES.abonnements[plan?.interval];
  const price = plan?.price_cents ?? plan?.priceCents ?? 0;
  if (!offer || plan.kind !== 'all' || !soldesEnCours(at) || price <= 0 || config.paymentsMode === 'lemon') return null;
  return { percent: offer.percent, priceCents: Math.round(price * (100 - offer.percent) / 100), months: offer.months,
    label: `-${offer.percent} %`, name: SOLDES.nom, endsAt: SOLDES.fin, until: SOLDES.finTexte, periodText: offer.texte };
}

/** La fenêtre d'annonce des soldes (vue une seule fois par visiteur, comme toute nouveauté), ou null après la date. */
export function salePopup(at = now()) {
  if (!soldesEnCours(at)) return null;
  const deals = Object.keys(SOLDES.remises)
    .map((slug) => get('SELECT slug, name, price_cents, creator, published, image FROM products WHERE slug = ?', slug))
    .filter((p) => p && p.published)
    .map((p) => ({ slug: p.slug, name: p.name, priceCents: p.price_cents, sale: saleOf(p, at), image: p.image ? `/api/media/${p.image}` : null }))
    .filter((d) => d.sale)
    .sort((a, b) => (b.slug === SOLDES.enTete) - (a.slug === SOLDES.enTete) || b.sale.percent - a.sale.percent || b.priceCents - a.priceCents);
  if (!deals.length) return null;
  // L'abonnement le plus avantageux (l'annuel ALL ACCESS) ferme la liste, sous les trois premiers plugins.
  const plan = get(`SELECT * FROM plans WHERE active = 1 AND kind = 'all' AND interval = 'year' AND product_ids IS NULL ORDER BY price_cents DESC LIMIT 1`)
    || get(`SELECT * FROM plans WHERE active = 1 AND kind = 'all' ORDER BY price_cents DESC LIMIT 1`);
  const planSale = plan && planSaleOf(plan, at);
  const planDeal = planSale && { slug: null, href: '/boutique#plans', name: `${plan.name.replace(/\s*[—-]\s*(annuel|mensuel)\s*$/i, '')}, ${planSale.periodText}`,
    priceCents: plan.price_cents, sale: planSale };
  const top = Math.max(...deals.map((d) => d.sale.percent));
  return {
    id: SOLDES.id, theme: 'black-friday', kicker: 'BLACK FRIDAY', title: `Jusqu'à -${top} %`,
    text: `Les plus gros plugins ONIRIQUE à prix cassé, et les abonnements aussi, ${SOLDES.finTexte}. La remise s'applique toute seule au paiement, sans code.`,
    link: '/boutique', linkLabel: 'Voir les offres', endsAt: SOLDES.fin, deals: planDeal ? [...deals.slice(0, 3), planDeal] : deals.slice(0, 4),
  };
}
