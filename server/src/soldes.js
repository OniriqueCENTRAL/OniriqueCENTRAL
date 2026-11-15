// LES SOLDES DU SITE : une remise qui s'applique toute seule au paiement, sans code, pendant une période donnée.
// Elle passe par quote() (promos.js), comme les codes : c'est la plus forte remise qui gagne, rien ne se cumule, et le
// prix est toujours recalculé par le serveur au moment de payer. Seuls les plugins ONIRIQUE payants sont concernés
// (pas ceux des partenaires). Une fois la date passée, tout revient au prix normal sans rien toucher.
//
// Black Friday 2026, choisi par Nov : -30 % sur les trois plus gros plugins, -20 % sur les quatre suivants, jusqu'au
// 1er décembre inclus (23 h 59, heure de Paris).
import { get, now } from './db.js';

export const SOLDES = {
  id: 'black-friday-2026',
  nom: 'Black Friday',
  fin: Date.parse('2026-12-01T23:59:59+01:00'),
  finTexte: "jusqu'au 1er décembre",
  remises: {
    vocalbox: 30, 'onirique-eclipse': 30, based: 30,
    'onirique-n73': 20, 'onirique-doublebox': 20, 'onirique-resobox': 20, 'onirique-modbox': 20,
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

/** La fenêtre d'annonce des soldes (vue une seule fois par visiteur, comme toute nouveauté), ou null après la date. */
export function salePopup(at = now()) {
  if (!soldesEnCours(at)) return null;
  const deals = Object.keys(SOLDES.remises)
    .map((slug) => get('SELECT slug, name, price_cents, creator, published, image FROM products WHERE slug = ?', slug))
    .filter((p) => p && p.published)
    .map((p) => ({ slug: p.slug, name: p.name, priceCents: p.price_cents, sale: saleOf(p, at), image: p.image ? `/api/media/${p.image}` : null }))
    .filter((d) => d.sale)
    .sort((a, b) => b.sale.percent - a.sale.percent || b.priceCents - a.priceCents);
  if (!deals.length) return null;
  const top = Math.max(...deals.map((d) => d.sale.percent));
  return {
    id: SOLDES.id, theme: 'black-friday', kicker: 'BLACK FRIDAY', title: `Jusqu'à -${top} %`,
    text: `Les plus gros plugins ONIRIQUE à prix cassé, ${SOLDES.finTexte}. La remise s'applique toute seule au paiement, sans code.`,
    link: '/boutique', linkLabel: 'Voir les offres', endsAt: SOLDES.fin, deals: deals.slice(0, 4),
  };
}
