import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { get, run, now, transaction, setting } from './db.js';
import { HttpError, isStaff } from './auth.js';
import { createLicense, parseProductIds } from './licensing.js';
import { sendMail } from './mail.js';
import { afterPurchase, rewardSponsor } from './promos.js';

const PERIOD_MS = { month: 31 * 86400_000, year: 366 * 86400_000 };

//==============================================================================
//  Ce qu'un paiement réussi accorde (commun au mode démo et à Stripe)
//==============================================================================
function recordOrder(userId, kind, refId, amount, provider, providerRef) {
  if (providerRef && get('SELECT id FROM orders WHERE provider_ref = ?', providerRef)) return false;
  run('INSERT INTO orders (user_id, kind, ref_id, amount_cents, provider, provider_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId, kind, refId, amount, provider, providerRef, now());
  return true;
}

const RESELLERS = { lemon: 'Lemon Squeezy', 'stripe-managed': 'Link (Stripe)' };
const stripeProvider = (account) => (account.managed ? 'stripe-managed' : 'stripe');

/** Remboursement complet d'un achat : la licence qu'il avait créée est révoquée, et ses machines libérées. */
function revokePurchase(userId, productId, source) {
  transaction(() => {
    run(`UPDATE licenses SET status = 'revoked' WHERE id = (SELECT id FROM licenses WHERE user_id = ? AND product_id = ?
           AND source = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1)`, userId, productId, source);
    const still = get(`SELECT id FROM licenses WHERE user_id = ? AND product_id = ? AND status = 'active'
                        AND (expires_at IS NULL OR expires_at > ?)`, userId, productId, now());
    if (!still) run('DELETE FROM activations WHERE user_id = ? AND product_id = ?', userId, productId);
  });
}

/** Confirmation de commande par e-mail, pour un paiement réel. Un envoi raté ne retire rien à l'acheteur. */
function confirmOrder(userId, what, amountCents, renewal = '', provider = 'stripe', currency = 'eur') {
  const user = get('SELECT email, name FROM users WHERE id = ?', userId);
  if (!user) return;
  let amount;
  try {
    // Certaines monnaies n'ont pas de centimes (yen, won) : Intl sait combien de décimales chacune en a.
    const format = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: String(currency).toUpperCase() });
    amount = format.format(amountCents / 10 ** format.resolvedOptions().maximumFractionDigits);
  } catch {
    amount = `${amountCents / 100} ${currency}`;
  }
  sendMail(user.email, 'Confirmation de commande — ONIRIQUE',
    `Bonjour${user.name ? ' ' + user.name : ''},\n\nMerci pour votre commande.\n\n  ${what}\n  ${amount} TTC${renewal}\n\n`
    + 'Votre licence est déjà sur votre compte : ouvrez ONIRIQUE CENTRAL, installez le plugin, il s\'active tout seul.\n'
    + `Application et compte : ${config.siteUrl}\n\n`
    + (RESELLERS[provider]
      ? `Le paiement est encaissé par notre revendeur ${RESELLERS[provider]}, qui vous envoie le reçu séparément.\n\n`
      : `Le contenu vous est fourni dès le paiement, comme vous l'avez demandé en commandant : le droit de rétractation ne s'applique plus (${config.siteUrl}/remboursement.html).\n\n`)
    + `Une question : ${config.supportEmail}\n\nONIRIQUE`, undefined, { eyebrow: 'Commande' })
    .catch((error) => console.error('Confirmation de commande :', error.message));
}

/** amount : ce qui a été réellement payé (après un code promo), le prix du plugin sinon. */
export function grantProduct(userId, product, provider, providerRef = null, amount = product.price_cents) {
  return transaction(() => {
    if (!recordOrder(userId, 'product', product.id, amount, provider, providerRef)) return false;
    createLicense({ productId: product.id, userId, source: provider, note: 'Achat' });
    return true;
  });
}

/**
 * Un pack payé : une licence définitive par plugin du pack, réunies sous la référence de la commande (bundle), ce qui
 * permet de toutes les révoquer si la commande est remboursée.
 */
export function grantPack(userId, pack, provider, providerRef = null, amount = pack.price_cents) {
  const ref = providerRef || `${provider}_${crypto.randomBytes(8).toString('hex')}`;
  return transaction(() => {
    if (!recordOrder(userId, 'pack', pack.id, amount, provider, ref)) return false;
    for (const productId of parseProductIds(pack.product_ids) || []) {
      if (get('SELECT id FROM products WHERE id = ?', productId)) {
        createLicense({ productId, userId, source: provider, note: `Pack ${pack.name}`, bundle: `pack:${ref}` });
      }
    }
    return true;
  });
}

function revokePack(userId, providerRef) {
  transaction(() => {
    const licences = get(`SELECT GROUP_CONCAT(product_id) AS ids FROM licenses WHERE user_id = ? AND bundle = ? AND status = 'active'`, userId, `pack:${providerRef}`);
    run(`UPDATE licenses SET status = 'revoked' WHERE user_id = ? AND bundle = ?`, userId, `pack:${providerRef}`);
    for (const productId of String(licences?.ids || '').split(',').filter(Boolean).map(Number)) {
      const still = get(`SELECT id FROM licenses WHERE user_id = ? AND product_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`, userId, productId, now());
      if (!still) run('DELETE FROM activations WHERE user_id = ? AND product_id = ?', userId, productId);
    }
  });
}

/** productIds : les plugins couverts par un abonnement à la carte ; null pour un abonnement à tout le catalogue. */
export function setSubscription(userId, planId, { status, periodEnd, cancelAtPeriodEnd = 0, stripeId = null, productIds = null }) {
  run(`INSERT INTO subscriptions (user_id, plan_id, status, current_period_end, cancel_at_period_end, stripe_subscription, product_ids, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET plan_id = excluded.plan_id, status = excluded.status,
         current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
         stripe_subscription = excluded.stripe_subscription, product_ids = excluded.product_ids, updated_at = excluded.updated_at`,
    userId, planId, status, periodEnd, cancelAtPeriodEnd ? 1 : 0, stripeId,
    productIds?.length ? JSON.stringify(productIds) : null, now());
}

//==============================================================================
//  Comptes Stripe : un par créateur de plugins (ONIRIQUE et chaque partenaire), branché depuis le panel admin
//==============================================================================
const STRIPE_VERSION = '2025-03-31.basil'; // la première version qui connaît Managed Payments
const STRIPE_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'charge.refunded', 'charge.dispute.closed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'];

// Les clés sont chiffrées dans la base avec une clé gardée à part (dossier keys/) : une copie de la base seule ne les livre pas.
const sealPath = path.join(config.keysDir, 'secrets.key');
if (!fs.existsSync(sealPath)) fs.writeFileSync(sealPath, crypto.randomBytes(32), { mode: 0o600 });
const sealKey = fs.readFileSync(sealPath);
export function seal(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sealKey, iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
export function unseal(stored) {
  const raw = Buffer.from(stored, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', sealKey, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

/** Le compte Stripe d'un créateur : celui du panel admin, sinon, pour ONIRIQUE, celui du fichier .env (onirique-stripe). */
export function stripeAccount(creator) {
  const row = get('SELECT * FROM stripe_accounts WHERE creator = ?', String(creator));
  if (row) {
    return { creator: row.creator, key: unseal(row.secret_key), hook: unseal(row.webhook_secret), hookId: row.webhook_id,
      name: row.name, test: !!row.test, managed: !!row.managed };
  }
  if (creator === 'onirique' && config.stripeSecretKey) {
    return { creator, key: config.stripeSecretKey, hook: config.stripeWebhookSecret, hookId: null, name: '',
      test: config.stripeSecretKey.includes('_test_'), managed: config.stripeManaged, fromEnv: true };
  }
  return null;
}

/** Ce que le panel admin affiche d'un compte : jamais ses clés. */
export function stripeAccountView(creator) {
  const account = stripeAccount(creator);
  return { creator, connected: !!account, name: account?.name ?? '', test: !!account?.test, managed: account ? account.managed : true, fromEnv: !!account?.fromEnv };
}

/**
 * Le mode de vente en vigueur. Sans réglage dans le fichier .env, la vente par Stripe s'ouvre toute seule dès qu'un
 * compte est branché depuis le panel admin ; un fondateur peut la refermer (réglage payments_open).
 */
export const paymentsMode = () => (config.paymentsMode !== 'off' ? config.paymentsMode
  : setting('payments_open', true) && get('SELECT 1 AS yes FROM stripe_accounts LIMIT 1') ? 'stripe' : 'off');

/** Les créateurs dont les plugins peuvent être achetés par le public : compte branché, avec une clé réelle. */
export const sellers = (creators) => creators.filter((creator) => { const account = stripeAccount(creator); return account && !account.test; });

/** La vente : Stripe vendeur officiel (Managed Payments), ou vente en nom propre avec la case obligatoire des conditions. */
const sellerOptions = (managed) => (managed ? { managed_payments: { enabled: true } } : {
  // Conditions de vente, et fourniture immédiate d'un contenu numérique (ce qui met fin au droit de rétractation).
  // Demande une adresse de CGV réglée dans le tableau de bord Stripe.
  consent_collection: { terms_of_service: 'required' },
  custom_text: { terms_of_service_acceptance: { message:
    `J'accepte les [conditions générales de vente](${config.siteUrl}/cgv.html) et je demande à recevoir mon achat tout de suite : je renonce à mon droit de rétractation.` } },
});
const lineItems = (kind, name, cents, interval) => [{
  quantity: 1,
  price_data: {
    currency: 'eur', unit_amount: cents, recurring: kind === 'plan' ? { interval } : undefined,
    tax_behavior: 'inclusive', // les prix affichés sont TTC : la TVA est comprise dedans, pas ajoutée au paiement
    // Catégorie fiscale exigée par Managed Payments : logiciel téléchargé, ou logiciel par abonnement.
    product_data: { name, tax_code: kind === 'plan' ? 'txcd_10103100' : 'txcd_10202000' },
  },
}];

/**
 * Branche le compte Stripe d'un créateur. La clé est essayée pour de bon avant d'être gardée : le compte répond,
 * Stripe accepte une page de paiement faite comme celles du site, puis le webhook qui annonce les paiements est créé.
 */
export async function connectStripe(creator, secretKey, managed) {
  if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(secretKey)) {
    throw new HttpError(400, 'Ce n\'est pas une clé secrète Stripe : elle commence par sk_live_ ou sk_test_.');
  }
  const test = secretKey.includes('_test_');
  const account = await stripe('GET', '/account', undefined, secretKey);
  if (!test && !account.charges_enabled) throw new HttpError(400, 'Ce compte Stripe ne peut pas encore encaisser : terminez son activation dans le tableau de bord Stripe.');
  // Les abonnements passent tous par le compte ONIRIQUE : lui seul est essayé avec une page d'abonnement.
  for (const kind of creator === 'onirique' ? ['product', 'plan'] : ['product']) {
    const session = await stripe('POST', '/checkout/sessions', {
      mode: kind === 'plan' ? 'subscription' : 'payment', locale: 'fr', success_url: config.siteUrl,
      ...sellerOptions(managed), line_items: lineItems(kind, 'Essai de réglage ONIRIQUE', 100, 'month'),
    }, secretKey);
    await stripe('POST', `/checkout/sessions/${session.id}/expire`, undefined, secretKey).catch(() => {});
  }
  const url = `${config.publicUrl}/api/stripe/webhook/${creator}`;
  for (const hook of (await stripe('GET', '/webhook_endpoints?limit=100', undefined, secretKey)).data) {
    if (hook.url === url) await stripe('DELETE', `/webhook_endpoints/${hook.id}`, undefined, secretKey);
  }
  const hook = await stripe('POST', '/webhook_endpoints', { url, api_version: STRIPE_VERSION, enabled_events: STRIPE_EVENTS }, secretKey);
  saveStripeAccount(creator, { secretKey, webhookSecret: hook.secret, webhookId: hook.id, test, managed,
    name: account.settings?.dashboard?.display_name || account.business_profile?.name || account.email || account.id });
}

export function saveStripeAccount(creator, { secretKey, webhookSecret, webhookId = null, name = '', test = false, managed = true }) {
  run(`INSERT INTO stripe_accounts (creator, secret_key, webhook_secret, webhook_id, name, test, managed, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (creator) DO UPDATE SET secret_key = excluded.secret_key, webhook_secret = excluded.webhook_secret,
         webhook_id = excluded.webhook_id, name = excluded.name, test = excluded.test, managed = excluded.managed, updated_at = excluded.updated_at`,
    creator, seal(secretKey), seal(webhookSecret), webhookId, String(name).slice(0, 120), test ? 1 : 0, managed ? 1 : 0, now());
}

/** Débranche un compte : son webhook est retiré chez Stripe si possible, puis ses clés sont effacées d'ici. */
export async function disconnectStripe(creator) {
  const account = stripeAccount(creator);
  if (!account || account.fromEnv) throw new HttpError(404, 'Aucun compte Stripe branché depuis le panel pour ce créateur.');
  if (account.hookId) await stripe('DELETE', `/webhook_endpoints/${account.hookId}`, undefined, account.key).catch(() => {});
  run('DELETE FROM stripe_accounts WHERE creator = ?', creator);
}

//==============================================================================
//  Stripe (API REST, sans SDK)
//==============================================================================
function flatten(object, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(object)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value !== null && typeof value === 'object') flatten(value, name, out);
    else if (value !== undefined && value !== null) out.append(name, String(value));
  }
  return out;
}

async function stripe(method, path, body, key) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_VERSION,
    },
    body: body ? flatten(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) throw new HttpError(502, `Stripe : ${json.error?.message || response.status}`);
  return json;
}

/** La remise d'un achat (code promo, remise de parrainage), telle qu'elle voyage chez Stripe ou Lemon Squeezy. */
const discountMeta = (item) => (item.discount ? {
  promo_id: item.discount.promoId ? String(item.discount.promoId) : undefined,
  welcome: item.discount.welcome ? '1' : undefined,
  discount_cents: String(item.discount.discountCents),
} : {});
const discountFrom = (meta = {}) => ({ promoId: Number(meta.promo_id) || null, welcome: meta.welcome === '1', discountCents: Number(meta.discount_cents) || 0 });

async function stripeCheckout(user, kind, item) {
  const creator = kind === 'plan' || kind === 'pack' ? 'onirique' : item.creator;
  const account = stripeAccount(creator);
  // Compte en mode essai : rien n'est encaissé, donc seuls l'équipe et le partenaire concerné peuvent commander, pour essayer.
  if (!account || (account.test && !isStaff(user) && user.role !== creator)) {
    throw new HttpError(503, kind === 'plan' ? 'Les abonnements ne sont pas encore ouverts.' : 'Ce plugin n\'est pas encore en vente.');
  }
  // Un client Stripe n'existe que dans le compte qui l'a créé : il n'est réutilisé que chez ONIRIQUE.
  const customer = creator === 'onirique' ? user.stripe_customer : null;
  const session = await stripe('POST', '/checkout/sessions', {
    mode: kind === 'plan' ? 'subscription' : 'payment',
    customer: customer || undefined,
    customer_email: customer ? undefined : user.email,
    client_reference_id: user.id,
    locale: 'fr',
    ...sellerOptions(account.managed),
    success_url: `${config.publicUrl}/checkout/done`,
    cancel_url: `${config.publicUrl}/checkout/cancelled`,
    metadata: { user_id: user.id, kind, ref_id: item.id, ...discountMeta(item) },
    // Les plugins d'un abonnement à la carte voyagent avec l'abonnement : c'est Stripe qui les rend au webhook.
    subscription_data: kind === 'plan'
      ? { metadata: { user_id: user.id, plan_id: item.id, product_ids: item.productIds ? JSON.stringify(item.productIds) : undefined } }
      : undefined,
    line_items: lineItems(kind, item.name, item.price_cents, item.interval),
  }, account.key);
  return { mode: 'stripe', url: session.url };
}

// Selon la version de l'API, la fin de période est sur l'abonnement ou sur sa ligne.
const stripePeriodEnd = (sub) => (sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? 0) * 1000;

function applyStripeSubscription(sub) {
  const userId = Number(sub.metadata?.user_id);
  const planId = Number(sub.metadata?.plan_id);
  if (!userId || !planId) return;
  const live = ['active', 'trialing', 'past_due'].includes(sub.status);
  setSubscription(userId, planId, {
    status: live ? 'active' : 'ended',
    periodEnd: stripePeriodEnd(sub),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    stripeId: sub.id,
    productIds: parseProductIds(sub.metadata?.product_ids),
  });
}

export function verifyStripeSignature(rawBody, header, secret) {
  const parts = Object.fromEntries(String(header || '').split(',').map((part) => part.split('=')));
  if (!parts.t || !parts.v1) throw new HttpError(400, 'Signature absente.');
  if (Math.abs(now() / 1000 - Number(parts.t)) > 300) throw new HttpError(400, 'Signature périmée.');
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new HttpError(400, 'Signature invalide.');
  }
}

/** account : le compte Stripe (stripeAccount) dont le webhook a reçu l'événement. Il n'agit que sur ses propres plugins. */
export async function handleStripeEvent(event, account) {
  const object = event.data.object;
  const platform = account.creator === 'onirique'; // les abonnements et les clients enregistrés ne passent que par ONIRIQUE
  // Paiement différé (virement, prélèvement) : la commande n'est honorée qu'une fois l'argent reçu.
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const userId = Number(object.metadata?.user_id);
    if (!userId) return;
    if (object.customer && platform) run('UPDATE users SET stripe_customer = ? WHERE id = ?', object.customer, userId);
    if (object.mode === 'payment' && object.payment_status === 'paid' && object.metadata?.kind === 'pack' && platform) {
      const pack = get('SELECT * FROM packs WHERE id = ?', Number(object.metadata.ref_id));
      const paid = object.amount_total ?? pack?.price_cents ?? 0;
      if (pack && grantPack(userId, pack, 'stripe', object.id, paid)) {
        rewardSponsor(userId);
        confirmOrder(userId, `Pack ${pack.name} — licences définitives`, paid, '', stripeProvider(account), object.currency || 'eur');
      }
    } else if (object.mode === 'payment' && object.payment_status === 'paid') {
      const product = get('SELECT * FROM products WHERE id = ? AND creator = ?', Number(object.metadata.ref_id), account.creator);
      const paid = object.amount_total ?? product?.price_cents ?? 0;
      if (product && grantProduct(userId, product, 'stripe', object.id, paid)) {
        afterPurchase(userId, product.id, { ...discountFrom(object.metadata), orderRef: object.id, paidCents: paid });
        confirmOrder(userId, `${product.name} — licence définitive`, paid, '', stripeProvider(account), object.currency || 'eur');
      }
    } else if (object.mode === 'subscription' && object.subscription && platform) {
      applyStripeSubscription(await stripe('GET', `/subscriptions/${object.subscription}`, undefined, account.key));
      const plan = get('SELECT name, interval FROM plans WHERE id = ?', Number(object.metadata.ref_id));
      if (plan && event.type === 'checkout.session.completed') {
        // Le premier paiement entre dans l'historique des achats (les renouvellements, eux, restent chez Stripe).
        recordOrder(userId, 'plan', Number(object.metadata.ref_id), object.amount_total ?? 0, 'stripe', object.id);
        if (object.amount_total > 0) rewardSponsor(userId); // un abonnement payé compte comme premier achat d'un filleul
        confirmOrder(userId, `Abonnement ${plan.name}`, object.amount_total ?? 0,
          `, puis le même montant chaque ${plan.interval === 'year' ? 'année' : 'mois'} jusqu'à résiliation (onglet Abonnement de l'application)`, stripeProvider(account), object.currency || 'eur');
      }
    }
  } else if (event.type === 'charge.refunded' || event.type === 'charge.dispute.closed') {
    // Remboursement complet (par l'éditeur, ou par Stripe quand il est le vendeur) ou litige perdu : l'argent est
    // repris, la licence aussi. La commande est retrouvée par son paiement.
    const gone = event.type === 'charge.refunded' ? object.refunded : object.status === 'lost';
    if (!gone || !object.payment_intent) return;
    const session = (await stripe('GET', `/checkout/sessions?payment_intent=${encodeURIComponent(object.payment_intent)}&limit=1`, undefined, account.key)).data?.[0];
    const userId = Number(session?.metadata?.user_id), productId = Number(session?.metadata?.ref_id);
    if (session?.metadata?.kind === 'pack' && userId && platform && get('SELECT id FROM orders WHERE provider_ref = ?', session.id)) return revokePack(userId, session.id);
    if (session?.mode === 'payment' && userId && productId && get('SELECT id FROM orders WHERE provider_ref = ?', session.id)
        && get('SELECT id FROM products WHERE id = ? AND creator = ?', productId, account.creator)) revokePurchase(userId, productId, 'stripe');
  } else if (event.type.startsWith('customer.subscription.') && platform) {
    applyStripeSubscription(object);
  }
}

//==============================================================================
//  Lemon Squeezy : revendeur officiel, il encaisse, facture, gère la TVA et reverse le reste
//==============================================================================
async function lemon(method, path, body) {
  const response = await fetch(`https://api.lemonsqueezy.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.lemonApiKey}`,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(502, `Lemon Squeezy : ${json.errors?.[0]?.detail || response.status}`);
  return json;
}

async function lemonCheckout(user, kind, item) {
  const variant = kind === 'plan' ? config.lemonVariants[item.interval] : config.lemonVariants.once;
  if (!variant) throw new HttpError(503, 'Cette formule n\'est pas encore ouverte à la vente.');
  const { data } = await lemon('POST', '/checkouts', { data: {
    type: 'checkouts',
    attributes: {
      custom_price: item.price_cents, // pour un abonnement, ce prix vaut aussi pour chaque renouvellement
      product_options: { name: item.name, redirect_url: `${config.publicUrl}/checkout/done`, enabled_variants: [Number(variant)] },
      checkout_options: { locale: 'fr' },
      // Ces valeurs reviennent telles quelles dans chaque événement de la commande ou de l'abonnement.
      checkout_data: { email: user.email, custom: {
        user_id: String(user.id), kind, ref_id: String(item.id), ...discountMeta(item),
        product_ids: item.productIds ? JSON.stringify(item.productIds) : undefined,
      } },
    },
    relationships: {
      store: { data: { type: 'stores', id: String(config.lemonStoreId) } },
      variant: { data: { type: 'variants', id: String(variant) } },
    },
  } });
  return { mode: 'lemon', url: data.attributes.url };
}

export function verifyLemonSignature(rawBody, header) {
  const expected = crypto.createHmac('sha256', config.lemonWebhookSecret).update(rawBody).digest();
  const given = Buffer.from(String(header || ''), 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new HttpError(400, 'Signature invalide.');
}

export function handleLemonEvent(event) {
  const name = String(event.meta?.event_name || '');
  const custom = event.meta?.custom_data || {};
  const attributes = event.data?.attributes || {};
  const userId = Number(custom.user_id), refId = Number(custom.ref_id);
  if (!userId || !refId) return; // une vente faite hors de ce site : rien à accorder ici
  const orderRef = `ls_order_${event.data.id}`;

  if (name === 'order_created') {
    if (attributes.status !== 'paid') return;
    if (custom.kind === 'pack') {
      const pack = get('SELECT * FROM packs WHERE id = ?', refId);
      const paid = attributes.total ?? pack?.price_cents ?? 0;
      if (pack && grantPack(userId, pack, 'lemon', orderRef, paid)) {
        rewardSponsor(userId);
        confirmOrder(userId, `Pack ${pack.name} — licences définitives`, paid, '', 'lemon');
      }
    } else if (custom.kind === 'product') {
      const product = get('SELECT * FROM products WHERE id = ?', refId);
      const paid = attributes.total ?? product?.price_cents ?? 0;
      if (product && grantProduct(userId, product, 'lemon', orderRef, paid)) {
        afterPurchase(userId, product.id, { ...discountFrom(custom), orderRef, paidCents: paid });
        confirmOrder(userId, `${product.name} — licence définitive`, paid, '', 'lemon');
      }
    } else if (custom.kind === 'plan') {
      // La première échéance d'un abonnement : l'accès lui-même arrive par l'événement subscription_created.
      const plan = get('SELECT name, interval FROM plans WHERE id = ?', refId);
      if (plan && recordOrder(userId, 'plan', refId, attributes.total ?? 0, 'lemon', orderRef)) {
        if (attributes.total > 0) rewardSponsor(userId);
        confirmOrder(userId, `Abonnement ${plan.name}`, attributes.total ?? 0,
          `, puis le même montant chaque ${plan.interval === 'year' ? 'année' : 'mois'} jusqu'à résiliation (onglet Abonnement de l'application)`, 'lemon');
      }
    }
  } else if (name === 'order_refunded') {
    // Remboursement complet d'un achat : la licence qu'il avait créée est révoquée, et ses machines libérées.
    if (custom.kind === 'pack' && attributes.status === 'refunded' && get('SELECT id FROM orders WHERE provider_ref = ?', orderRef)) return revokePack(userId, orderRef);
    if (custom.kind !== 'product' || attributes.status !== 'refunded' || !get('SELECT id FROM orders WHERE provider_ref = ?', orderRef)) return;
    revokePurchase(userId, refId, 'lemon');
  } else if (name.startsWith('subscription_') && !name.startsWith('subscription_payment')) {
    // Résilié : l'abonné garde l'accès jusqu'à la fin de la période payée (ends_at), puis reçoit « expired ».
    const cancelled = attributes.status === 'cancelled';
    const live = ['on_trial', 'active', 'past_due', 'cancelled'].includes(attributes.status);
    setSubscription(userId, refId, {
      status: live ? 'active' : 'ended',
      periodEnd: Date.parse(cancelled ? attributes.ends_at : attributes.renews_at) || 0,
      cancelAtPeriodEnd: cancelled,
      stripeId: String(event.data.id),
      productIds: parseProductIds(custom.product_ids),
    });
  }
}

//==============================================================================
//  Points d'entrée
//==============================================================================
export async function checkout(user, kind, item) {
  if (item.price_cents === 0 && kind === 'product') {
    // Gratuit par lui-même, ou rendu gratuit par un code (un plugin offert à un parrain, par exemple).
    if (grantProduct(user.id, item, item.discount ? 'promo' : 'free')) afterPurchase(user.id, item.id, item.discount ?? {});
    return { mode: 'free', granted: true };
  }
  const mode = paymentsMode();
  if (mode === 'demo') {
    if (kind === 'pack') {
      if (grantPack(user.id, get('SELECT * FROM packs WHERE id = ?', item.id), 'demo', null, item.price_cents)) rewardSponsor(user.id);
      return { mode: 'demo', granted: true };
    }
    if (kind === 'product' && grantProduct(user.id, item, 'demo', null, item.price_cents)) afterPurchase(user.id, item.id, item.discount ?? {});
    else setSubscription(user.id, item.id, { status: 'active', periodEnd: now() + PERIOD_MS[item.interval], productIds: item.productIds ?? null });
    return { mode: 'demo', granted: true };
  }
  if (mode === 'stripe') return stripeCheckout(user, kind, item);
  if (mode === 'lemon') return lemonCheckout(user, kind, item);
  throw new HttpError(503, 'Les achats ne sont pas encore ouverts.');
}

export async function cancelSubscription(userId) {
  const sub = get('SELECT * FROM subscriptions WHERE user_id = ?', userId);
  if (!sub || sub.status !== 'active') throw new HttpError(404, 'Aucun abonnement en cours.');
  const platform = stripeAccount('onirique');
  if (sub.stripe_subscription && paymentsMode() === 'stripe' && platform) {
    await stripe('POST', `/subscriptions/${sub.stripe_subscription}`, { cancel_at_period_end: true }, platform.key);
  }
  // Chez Lemon Squeezy, supprimer un abonnement le résilie à la fin de la période payée.
  if (sub.stripe_subscription && paymentsMode() === 'lemon') await lemon('DELETE', `/subscriptions/${sub.stripe_subscription}`);
  run('UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE user_id = ?', now(), userId);
}
