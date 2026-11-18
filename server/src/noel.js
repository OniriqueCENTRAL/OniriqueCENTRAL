// NOËL 2026 (choix de Nov, 18/11) : VOCAL MINI offert. Le 25 décembre, chaque compte reçoit une licence définitive de
// VOCAL MINI, et les comptes créés jusqu'au 31 décembre inclus la reçoivent aussi. Ceux qui l'ont déjà pour de bon
// (achetée, offerte avec VOCALBOX) ne reçoivent rien de plus. Le cadeau part toutes les 10 minutes pendant la période
// (index.js) et tout de suite quand un compte ouvre l'application ou le site (/api/me). L'application joue l'animation du
// cadeau une fois, à l'ouverture (noel dans /api/me) ; après le 15 janvier, plus d'animation.
import { all, get, now } from './db.js';
import { createLicense } from './licensing.js';

export const NOEL = {
  id: 'noel-2026',
  slug: 'onirique-vocal-mini',
  debut: Date.parse('2026-12-25T00:00:00+01:00'),
  fin: Date.parse('2026-12-31T23:59:59+01:00'),
  // L'animation reste proposée jusque-là à ceux qui n'ont pas ouvert l'application pendant les fêtes.
  animationJusquA: Date.parse('2027-01-15T23:59:59+01:00'),
};

export const noelEnCours = (at = now()) => at >= NOEL.debut && at <= NOEL.fin;

const cadeau = () => get('SELECT * FROM products WHERE slug = ?', NOEL.slug);
// Une licence définitive active (pas un essai) : le cadeau est déjà là.
const DEJA = `SELECT 1 FROM licenses l WHERE l.user_id = u.id AND l.product_id = ? AND l.type = 'perpetual'
              AND l.status = 'active' AND l.source != 'trial'`;

/** Offre VOCAL MINI aux comptes qui ne l'ont pas encore (un seul compte avec userId). Rend le nombre de licences créées. */
export function offrirNoel(at = now(), userId = null) {
  if (!noelEnCours(at)) return 0;
  const product = cadeau();
  if (!product) return 0;
  const users = all(`SELECT u.id FROM users u WHERE u.created_at <= ? ${userId ? 'AND u.id = ?' : ''} AND NOT EXISTS (${DEJA})`,
    ...(userId ? [NOEL.fin, userId, product.id] : [NOEL.fin, product.id]));
  for (const u of users) createLicense({ productId: product.id, userId: u.id, source: 'gift', note: 'Cadeau de Noël', bundle: NOEL.id });
  return users.length;
}

/** Ce que l'application montre à l'ouverture : le plugin offert à ce compte pour Noël, ou null. */
export function noelView(userId, at = now()) {
  if (at < NOEL.debut || at > NOEL.animationJusquA) return null;
  const product = cadeau();
  if (!product || !get(`SELECT 1 AS yes FROM licenses WHERE user_id = ? AND product_id = ? AND bundle = ?`, userId, product.id, NOEL.id)) return null;
  return { id: NOEL.id, productId: product.id, slug: product.slug, name: product.name, priceCents: product.price_cents,
    image: product.image ? `/api/media/${product.image}` : null };
}
