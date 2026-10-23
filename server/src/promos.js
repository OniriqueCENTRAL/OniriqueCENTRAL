import crypto from 'node:crypto';
import { config } from './config.js';
import { all, get, run, now, setting, setSetting, transaction } from './db.js';
import { HttpError } from './auth.js';
import { sendMail } from './mail.js';
import { renderEmail } from './mailtemplate.js';

//==============================================================================
//  Codes promo : créés depuis le panel admin, valables sur le site comme dans l'application
//==============================================================================
// Stripe refuse un paiement de moins de 50 centimes : une remise qui laisserait moins s'arrête à 50 centimes.
const STRIPE_MINIMUM = 50;
const CODE_FORMAT = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;

export const normalizeCode = (value) => String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');

const uses = (promoId) => get('SELECT COUNT(*) AS n FROM promo_redemptions WHERE promo_id = ?', promoId).n;

const parseIds = (text) => { try { const ids = JSON.parse(text); return Array.isArray(ids) ? ids.map(Number) : null; } catch { return null; } };

/** Ce que dit un code de sa remise : « -20 % » ou « -10 € ». */
export function promoLabel(promo) {
  if (promo.percent) return `-${promo.percent} %`;
  const euros = promo.amount_cents / 100;
  return `-${euros.toLocaleString('fr-FR', { minimumFractionDigits: promo.amount_cents % 100 ? 2 : 0 })} €`;
}

export function promoView(promo) {
  return {
    id: promo.id, code: promo.code, percent: promo.percent, amountCents: promo.amount_cents, label: promoLabel(promo),
    productIds: parseIds(promo.product_ids), creator: promo.creator, maxUses: promo.max_uses, expiresAt: promo.expires_at,
    active: !!promo.active, kind: promo.kind, ownerId: promo.owner_id, note: promo.note, createdAt: promo.created_at,
    uses: uses(promo.id),
  };
}

/** Le code, s'il peut servir à ce compte pour ce plugin ; sinon une erreur qui dit pourquoi. */
function usablePromo(user, product, code) {
  const promo = get('SELECT * FROM promo_codes WHERE code = ?', normalizeCode(code));
  if (!promo || !promo.active || (promo.owner_id && promo.owner_id !== user.id)) throw new HttpError(404, 'Ce code promo n\'existe pas.');
  if (promo.expires_at && promo.expires_at < now()) throw new HttpError(410, 'Ce code promo a expiré.');
  if (promo.max_uses && uses(promo.id) >= promo.max_uses) throw new HttpError(410, 'Ce code promo a déjà servi autant de fois que prévu.');
  if (get('SELECT 1 AS yes FROM promo_redemptions WHERE promo_id = ? AND user_id = ?', promo.id, user.id)) {
    throw new HttpError(409, 'Vous avez déjà utilisé ce code promo.');
  }
  const ids = parseIds(promo.product_ids);
  if ((ids && !ids.includes(product.id)) || (promo.creator && promo.creator !== product.creator)) {
    throw new HttpError(400, `Ce code promo ne s'applique pas à ${product.name}.`);
  }
  return promo;
}

//==============================================================================
//  Parrainage : l'ami invité a une remise sur son premier achat, le parrain des codes quand ses amis achètent
//==============================================================================
const REFERRAL_DEFAULTS = { enabled: true, friendPercent: 15, rewardPercent: 30, milestone: 5, rewardDays: 365 };
export const referralSettings = () => ({ ...REFERRAL_DEFAULTS, ...setting('referral', {}) });

export function saveReferralSettings(body) {
  const current = referralSettings();
  const percent = (value, fallback, min) => {
    if (value === undefined) return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > 100) throw new HttpError(400, `Pourcentage invalide : entre ${min} et 100.`);
    return n;
  };
  const next = {
    enabled: body.enabled === undefined ? current.enabled : !!body.enabled,
    friendPercent: percent(body.friendPercent, current.friendPercent, 0),
    rewardPercent: percent(body.rewardPercent, current.rewardPercent, 1),
    milestone: body.milestone === undefined ? current.milestone : Number(body.milestone),
    rewardDays: body.rewardDays === undefined ? current.rewardDays : Number(body.rewardDays),
  };
  if (!Number.isInteger(next.milestone) || next.milestone < 0 || next.milestone > 100) throw new HttpError(400, 'Palier invalide : entre 0 (aucun) et 100 amis.');
  if (!Number.isInteger(next.rewardDays) || next.rewardDays < 7 || next.rewardDays > 3650) throw new HttpError(400, 'Durée des codes : entre 7 et 3650 jours.');
  setSetting('referral', next);
  return next;
}

// Le code de parrainage d'un compte : sept signes faciles à recopier (ni 0, ni O, ni 1, ni I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function referralCode(user) {
  if (user.referral_code) return user.referral_code;
  for (;;) {
    const code = Array.from(crypto.randomBytes(7), (b) => ALPHABET[b % ALPHABET.length]).join('');
    if (get('SELECT id FROM users WHERE referral_code = ?', code)) continue;
    run('UPDATE users SET referral_code = ? WHERE id = ?', code, user.id);
    user.referral_code = code;
    return code;
  }
}

const paidOrders = (userId) => get(`SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND amount_cents > 0 AND provider NOT IN ('demo', 'free', 'promo')`, userId).n;

/**
 * Rattache un compte à son parrain : à l'inscription, ou plus tard tant que le compte n'a rien acheté et a moins de
 * 30 jours. Renvoie le parrain, ou lève une erreur qui dit pourquoi.
 */
export function attachReferrer(user, code) {
  const wanted = normalizeCode(code);
  const sponsor = wanted && get('SELECT * FROM users WHERE referral_code = ?', wanted);
  if (!sponsor) throw new HttpError(404, 'Ce code de parrainage n\'existe pas.');
  if (sponsor.id === user.id) throw new HttpError(400, 'Vous ne pouvez pas être votre propre parrain.');
  if (user.referred_by) throw new HttpError(409, 'Ce compte a déjà un parrain.');
  if (sponsor.referred_by === user.id) throw new HttpError(400, 'Ce compte est déjà votre filleul.');
  if (paidOrders(user.id)) throw new HttpError(409, 'Le parrainage se choisit avant le premier achat.');
  if (now() - user.created_at > 30 * 86400_000) throw new HttpError(409, 'Le parrainage se choisit dans les 30 jours qui suivent l\'inscription.');
  run('UPDATE users SET referred_by = ? WHERE id = ?', sponsor.id, user.id);
  user.referred_by = sponsor.id;
  return sponsor;
}

/** La remise de bienvenue de l'ami invité : sur son premier plugin ONIRIQUE, une seule fois. null s'il n'y a droit. */
function welcomePercent(user, product) {
  const settings = referralSettings();
  if (!settings.enabled || !settings.friendPercent || !user.referred_by || user.referral_welcome_used) return null;
  return product.creator === 'onirique' ? settings.friendPercent : null;
}

//==============================================================================
//  Remises d'acheteur : avoir acheté un plugin en fait payer un autre moins cher
//==============================================================================
// Les acheteurs de VOCAL MINI paient VOCALBOX moitié prix. « Acheteur » : une licence définitive active de ce plugin
// (achat, pack, code, cadeau), pas un essai ni un abonnement.
const OWNER_OFFERS = [
  { owns: 'onirique-vocal-mini', ownsName: 'VOCAL MINI', on: 'vocalbox', percent: 50 },
];
function ownerOffer(user, product) {
  for (const o of OWNER_OFFERS) {
    if (product.slug !== o.on) continue;
    const owns = get(`SELECT 1 AS yes FROM licenses l JOIN products p ON p.id = l.product_id
                      WHERE l.user_id = ? AND p.slug = ? AND l.type = 'perpetual' AND l.status = 'active' AND l.source != 'trial' LIMIT 1`,
      user.id, o.owns);
    if (owns) return o;
  }
  return null;
}

//==============================================================================
//  Le prix à payer
//==============================================================================
/**
 * Le prix d'un plugin pour ce compte, avec le code promo donné (facultatif) ou la remise de bienvenue d'un filleul :
 * la plus forte des deux, jamais les deux ensemble. Un code qui ne peut pas servir lève une erreur.
 */
export function quote(user, product, code) {
  const price = product.price_cents;
  const offers = [];
  if (code && normalizeCode(code)) {
    const promo = usablePromo(user, product, code);
    const off = promo.percent ? Math.round(price * promo.percent / 100) : Math.min(promo.amount_cents, price);
    offers.push({ off, promo, label: promoLabel(promo), source: 'promo' });
  }
  const welcome = price > 0 ? welcomePercent(user, product) : null;
  if (welcome) offers.push({ off: Math.round(price * welcome / 100), promo: null, label: `-${welcome} %`, source: 'welcome' });
  const owner = price > 0 ? ownerOffer(user, product) : null;
  if (owner) offers.push({ off: Math.round(price * owner.percent / 100), promo: null, label: `-${owner.percent} %`, source: 'owner', owner });

  const best = offers.sort((a, b) => b.off - a.off)[0];
  if (!best || !best.off) {
    return { priceCents: price, finalCents: price, discountCents: 0, label: null, code: null, source: null,
      promoId: null, welcome: false, ignored: offers.length ? 'Ce code ne change pas le prix de ce plugin.' : null };
  }
  let final = price - best.off;
  if (final > 0 && final < STRIPE_MINIMUM) final = Math.min(price, STRIPE_MINIMUM);
  return {
    priceCents: price, finalCents: final, discountCents: price - final, label: best.label,
    code: best.promo?.code ?? null, source: best.source, promoId: best.promo?.id ?? null, welcome: best.source === 'welcome',
    // Le code donné ne bat pas la remise de bienvenue (ou d'acheteur) : on le dit, pour que personne ne croie qu'il a été
    // refusé. La remise d'acheteur se présente d'elle-même, avec ou sans code.
    ignored: best.source === 'owner'
      ? (code ? `Votre remise d'acheteur de ${best.owner.ownsName} est plus forte que ce code : c'est elle qui s'applique.`
              : `${best.label} : vous avez ${best.owner.ownsName}, ${product.name} est à moitié prix pour vous.`)
      : code && best.source === 'welcome' ? 'Votre remise de parrainage est plus forte que ce code : c\'est elle qui s\'applique.' : null,
  };
}

/**
 * Ce qu'un achat payé avec une remise consomme : le code (une fois par compte), la remise de bienvenue, et, au
 * premier achat payé d'un filleul, la récompense de son parrain. Appelé une fois par commande.
 */
export function afterPurchase(userId, productId, { promoId = null, welcome = false, discountCents = 0, orderRef = null, paidCents = 0 } = {}) {
  transaction(() => {
    if (promoId) {
      run(`INSERT OR IGNORE INTO promo_redemptions (promo_id, user_id, product_id, order_ref, discount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        promoId, userId, productId, orderRef, discountCents, now());
    }
    if (welcome) run('UPDATE users SET referral_welcome_used = 1 WHERE id = ?', userId);
  });
  if (paidCents > 0) rewardSponsor(userId);
}

/**
 * Premier achat payé d'un filleul : son parrain reçoit un code personnel (-30 % par défaut, sur un plugin ONIRIQUE),
 * et, à chaque palier d'amis acheteurs (5 par défaut), un plugin ONIRIQUE offert (un code à -100 %).
 */
export function rewardSponsor(userId) {
  const settings = referralSettings();
  const friend = get('SELECT * FROM users WHERE id = ?', userId);
  if (!settings.enabled || !friend?.referred_by || friend.referral_rewarded) return [];
  const sponsor = get('SELECT * FROM users WHERE id = ?', friend.referred_by);
  if (!sponsor) return [];
  const made = transaction(() => {
    run('UPDATE users SET referral_rewarded = 1 WHERE id = ?', friend.id);
    const converted = get('SELECT COUNT(*) AS n FROM users WHERE referred_by = ? AND referral_rewarded = 1', sponsor.id).n;
    const expiresAt = now() + settings.rewardDays * 86400_000;
    const gifts = [{ percent: settings.rewardPercent, note: `Parrainage : premier achat de ${friend.email}` }];
    if (settings.milestone && converted % settings.milestone === 0) gifts.push({ percent: 100, note: `Parrainage : ${converted} amis acheteurs, un plugin offert` });
    return gifts.map((gift) => {
      const code = rewardCode();
      run(`INSERT INTO promo_codes (code, percent, creator, max_uses, expires_at, active, owner_id, kind, note, created_at)
           VALUES (?, ?, 'onirique', 1, ?, 1, ?, 'reward', ?, ?)`, code, gift.percent, expiresAt, sponsor.id, gift.note, now());
      return { code, percent: gift.percent };
    });
  });
  const what = (r) => (r.percent === 100 ? 'Un plugin ONIRIQUE offert' : `-${r.percent} % sur un plugin ONIRIQUE`);
  const lines = made.map((r) => `  ${r.code}  ·  ${what(r)}`).join('\n');
  const hello = `Bonjour${sponsor.name ? ' ' + sponsor.name : ''},`;
  const howTo = `À entrer dans le champ « Code promo » au moment d'acheter, sur le site ou dans ONIRIQUE CENTRAL. Valable ${settings.rewardDays} jours, une fois. Vos codes sont aussi sur votre page compte.`;
  sendMail(sponsor.email, 'Votre parrainage vous rapporte — ONIRIQUE',
    `${hello}\n\nUn ami que vous avez invité vient de faire son premier achat. Merci !\n\nVotre récompense :\n\n${lines}\n\n${howTo}\n\n${config.siteUrl}/boutique.html\n\nONIRIQUE`,
    undefined, { html: renderEmail({
      eyebrow: 'Parrainage', title: 'Votre ami a craqué. Merci !', preheader: `${what(made[made.length - 1])} : votre récompense de parrainage.`,
      blocks: [
        { text: hello },
        { text: 'Un ami que vous avez invité vient de faire son premier achat chez ONIRIQUE. Voici votre récompense :' },
        ...made.map((r) => ({ code: r.code, caption: r.percent === 100 ? 'Plugin offert' : 'Votre code', detail: what(r) })),
        { text: howTo },
        { button: { label: 'Choisir mon plugin', url: `${config.siteUrl}/boutique.html` } },
        { divider: true },
        { text: `Continuez d'inviter : chaque ami qui achète vous rapporte un nouveau code${settings.milestone ? `, et tous les ${settings.milestone} amis acheteurs, un plugin offert` : ''}. Votre lien : ${config.siteUrl}/compte.html?ref=${referralCode(sponsor)}` },
      ],
    }) })
    .catch((error) => console.error('Récompense de parrainage :', error.message));
  return made;
}

function rewardCode() {
  for (;;) {
    const code = 'MERCI-' + Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');
    if (!get('SELECT id FROM promo_codes WHERE code = ?', code)) return code;
  }
}

/** Ce que la page compte montre du parrainage. */
export function referralView(user) {
  const settings = referralSettings();
  const code = referralCode(user);
  const invited = get('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?', user.id).n;
  const converted = get('SELECT COUNT(*) AS n FROM users WHERE referred_by = ? AND referral_rewarded = 1', user.id).n;
  const rewards = all(`SELECT * FROM promo_codes WHERE owner_id = ? AND kind = 'reward' ORDER BY created_at DESC`, user.id).map((p) => ({
    code: p.code, label: p.percent === 100 ? 'Un plugin ONIRIQUE offert' : `${promoLabel(p)} sur un plugin ONIRIQUE`,
    used: uses(p.id) > 0, expiresAt: p.expires_at, expired: !!p.expires_at && p.expires_at < now(),
  }));
  const sponsor = user.referred_by ? get('SELECT name, email FROM users WHERE id = ?', user.referred_by) : null;
  return {
    enabled: settings.enabled, code, link: `${config.siteUrl}/compte.html?ref=${code}`,
    friendPercent: settings.friendPercent, rewardPercent: settings.rewardPercent, milestone: settings.milestone, rewardDays: settings.rewardDays,
    invited, converted, rewards,
    // Le prochain palier : combien d'amis acheteurs il reste avant le plugin offert.
    toMilestone: settings.milestone ? settings.milestone - (converted % settings.milestone) : null,
    // Ce compte a été invité : par qui (le prénom ou le début de l'adresse, jamais l'adresse entière), et sa remise.
    sponsor: sponsor ? (sponsor.name || sponsor.email.split('@')[0]) : null,
    welcomePercent: user.referred_by && !user.referral_welcome_used && settings.enabled && settings.friendPercent ? settings.friendPercent : null,
    canAttach: !user.referred_by && settings.enabled && !paidOrders(user.id) && now() - user.created_at <= 30 * 86400_000,
  };
}

/** Pour le panel admin : les chiffres du parrainage et les meilleurs parrains. */
export function referralStats() {
  return {
    settings: referralSettings(),
    invited: get('SELECT COUNT(*) AS n FROM users WHERE referred_by IS NOT NULL').n,
    converted: get('SELECT COUNT(*) AS n FROM users WHERE referral_rewarded = 1').n,
    rewards: get(`SELECT COUNT(*) AS n FROM promo_codes WHERE kind = 'reward'`).n,
    rewardsUsed: get(`SELECT COUNT(*) AS n FROM promo_codes p WHERE kind = 'reward' AND EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.promo_id = p.id)`).n,
    top: all(`SELECT s.id, s.email, s.name, COUNT(f.id) AS invited, SUM(f.referral_rewarded) AS converted
              FROM users f JOIN users s ON s.id = f.referred_by GROUP BY s.id ORDER BY converted DESC, invited DESC LIMIT 10`),
  };
}

//==============================================================================
//  Administration des codes
//==============================================================================
/** Les champs d'un code envoyés par le panel. creator : celui du partenaire qui le crée, imposé ; null pour l'équipe. */
export function promoFields(body, existing = {}, creator = null) {
  const code = body.code !== undefined ? normalizeCode(body.code) : existing.code;
  if (!CODE_FORMAT.test(code || '')) throw new HttpError(400, 'Code invalide : 3 à 24 lettres, chiffres, tirets.');
  let percent = existing.percent ?? null, amount = existing.amount_cents ?? null;
  if (body.percent !== undefined || body.amountCents !== undefined) {
    percent = body.percent ? Number(body.percent) : null;
    amount = body.amountCents ? Number(body.amountCents) : null;
  }
  if (percent !== null && (!Number.isInteger(percent) || percent < 1 || percent > 100)) throw new HttpError(400, 'Remise en pourcentage : entre 1 et 100.');
  if (amount !== null && (!Number.isInteger(amount) || amount < 1 || amount > 10_000_00)) throw new HttpError(400, 'Remise en euros invalide.');
  if ((percent === null) === (amount === null)) throw new HttpError(400, 'Choisissez une remise : en pourcentage ou en euros.');
  let productIds = existing.product_ids ? parseIds(existing.product_ids) : null;
  if (body.productIds !== undefined) {
    productIds = Array.isArray(body.productIds) && body.productIds.length ? [...new Set(body.productIds.map(Number))] : null;
    for (const id of productIds ?? []) {
      const product = get('SELECT creator FROM products WHERE id = ?', id);
      if (!product || (creator && product.creator !== creator)) throw new HttpError(400, 'Plugin inconnu dans la liste.');
    }
  }
  const maxUses = body.maxUses !== undefined ? (body.maxUses ? Number(body.maxUses) : null) : existing.max_uses ?? null;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1_000_000)) throw new HttpError(400, 'Nombre d\'utilisations invalide.');
  const expiresAt = body.expiresAt !== undefined ? (body.expiresAt ? Number(body.expiresAt) : null) : existing.expires_at ?? null;
  if (expiresAt !== null && !Number.isFinite(expiresAt)) throw new HttpError(400, 'Date de fin invalide.');
  return {
    code, percent, amount, productIds: productIds ? JSON.stringify(productIds) : null, maxUses, expiresAt,
    creator: creator ?? (body.creator !== undefined ? (body.creator || null) : existing.creator ?? null),
    active: body.active !== undefined ? (body.active ? 1 : 0) : existing.active ?? 1,
    note: body.note !== undefined ? String(body.note).trim().slice(0, 200) : existing.note ?? '',
  };
}
