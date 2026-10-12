import crypto from 'node:crypto';
import { config } from './config.js';
import { get, run, now, transaction } from './db.js';
import { HttpError } from './auth.js';
import { createLicense, parseProductIds } from './licensing.js';
import { sendMail } from './mail.js';

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

/** Confirmation de commande par e-mail, pour un paiement réel. Un envoi raté ne retire rien à l'acheteur. */
function confirmOrder(userId, what, amountCents, renewal = '', provider = 'stripe') {
  const user = get('SELECT email, name FROM users WHERE id = ?', userId);
  if (!user) return;
  const amount = (amountCents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  sendMail(user.email, 'Confirmation de commande — ONIRIQUE',
    `Bonjour${user.name ? ' ' + user.name : ''},\n\nMerci pour votre commande.\n\n  ${what}\n  ${amount} TTC${renewal}\n\n`
    + 'Votre licence est déjà sur votre compte : ouvrez ONIRIQUE CENTRAL, installez le plugin, il s\'active tout seul.\n'
    + `Application et compte : ${config.siteUrl}\n\n`
    + (provider === 'lemon'
      ? 'Le paiement est encaissé par notre revendeur Lemon Squeezy, qui vous envoie le reçu séparément.\n\n'
      : `Le contenu vous est fourni dès le paiement, comme vous l'avez demandé en commandant : le droit de rétractation ne s'applique plus (${config.siteUrl}/remboursement.html).\n\n`)
    + `Une question : ${config.supportEmail}\n\nONIRIQUE`)
    .catch((error) => console.error('Confirmation de commande :', error.message));
}

export function grantProduct(userId, product, provider, providerRef = null) {
  return transaction(() => {
    if (!recordOrder(userId, 'product', product.id, product.price_cents, provider, providerRef)) return false;
    createLicense({ productId: product.id, userId, source: provider, note: 'Achat' });
    return true;
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

async function stripe(method, path, body) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? flatten(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) throw new HttpError(502, `Stripe : ${json.error?.message || response.status}`);
  return json;
}

async function stripeCheckout(user, kind, item) {
  const recurring = kind === 'plan' ? { interval: item.interval } : undefined;
  const session = await stripe('POST', '/checkout/sessions', {
    mode: kind === 'plan' ? 'subscription' : 'payment',
    customer: user.stripe_customer || undefined,
    customer_email: user.stripe_customer ? undefined : user.email,
    client_reference_id: user.id,
    locale: 'fr',
    // Case obligatoire sur la page de paiement : conditions de vente, et fourniture immédiate d'un contenu numérique
    // (ce qui met fin au droit de rétractation). Demande une adresse de CGV réglée dans le tableau de bord Stripe.
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message:
      `J'accepte les [conditions générales de vente](${config.siteUrl}/cgv.html) et je demande à recevoir mon achat tout de suite : je renonce à mon droit de rétractation.` } },
    success_url: `${config.publicUrl}/checkout/done`,
    cancel_url: `${config.publicUrl}/checkout/cancelled`,
    metadata: { user_id: user.id, kind, ref_id: item.id },
    // Les plugins d'un abonnement à la carte voyagent avec l'abonnement : c'est Stripe qui les rend au webhook.
    subscription_data: kind === 'plan'
      ? { metadata: { user_id: user.id, plan_id: item.id, product_ids: item.productIds ? JSON.stringify(item.productIds) : undefined } }
      : undefined,
    line_items: [{
      quantity: 1,
      price_data: { currency: 'eur', unit_amount: item.price_cents, recurring, product_data: { name: item.name } },
    }],
  });
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

export function verifyStripeSignature(rawBody, header) {
  const parts = Object.fromEntries(String(header || '').split(',').map((part) => part.split('=')));
  if (!parts.t || !parts.v1) throw new HttpError(400, 'Signature absente.');
  if (Math.abs(now() / 1000 - Number(parts.t)) > 300) throw new HttpError(400, 'Signature périmée.');
  const expected = crypto.createHmac('sha256', config.stripeWebhookSecret).update(`${parts.t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new HttpError(400, 'Signature invalide.');
  }
}

export async function handleStripeEvent(event) {
  const object = event.data.object;
  // Paiement différé (virement, prélèvement) : la commande n'est honorée qu'une fois l'argent reçu.
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const userId = Number(object.metadata?.user_id);
    if (!userId) return;
    if (object.customer) run('UPDATE users SET stripe_customer = ? WHERE id = ?', object.customer, userId);
    if (object.mode === 'payment' && object.payment_status === 'paid') {
      const product = get('SELECT * FROM products WHERE id = ?', Number(object.metadata.ref_id));
      if (product && grantProduct(userId, product, 'stripe', object.id)) confirmOrder(userId, `${product.name} — licence définitive`, object.amount_total ?? product.price_cents);
    } else if (object.mode === 'subscription' && object.subscription) {
      applyStripeSubscription(await stripe('GET', `/subscriptions/${object.subscription}`));
      const plan = get('SELECT name, interval FROM plans WHERE id = ?', Number(object.metadata.ref_id));
      if (plan && event.type === 'checkout.session.completed') {
        confirmOrder(userId, `Abonnement ${plan.name}`, object.amount_total ?? 0,
          `, puis le même montant chaque ${plan.interval === 'year' ? 'année' : 'mois'} jusqu'à résiliation (onglet Abonnement de l'application)`);
      }
    }
  } else if (event.type.startsWith('customer.subscription.')) {
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
        user_id: String(user.id), kind, ref_id: String(item.id),
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
    if (custom.kind === 'product') {
      const product = get('SELECT * FROM products WHERE id = ?', refId);
      if (product && grantProduct(userId, product, 'lemon', orderRef)) {
        confirmOrder(userId, `${product.name} — licence définitive`, attributes.total ?? product.price_cents, '', 'lemon');
      }
    } else if (custom.kind === 'plan') {
      // La première échéance d'un abonnement : l'accès lui-même arrive par l'événement subscription_created.
      const plan = get('SELECT name, interval FROM plans WHERE id = ?', refId);
      if (plan && recordOrder(userId, 'plan', refId, attributes.total ?? 0, 'lemon', orderRef)) {
        confirmOrder(userId, `Abonnement ${plan.name}`, attributes.total ?? 0,
          `, puis le même montant chaque ${plan.interval === 'year' ? 'année' : 'mois'} jusqu'à résiliation (onglet Abonnement de l'application)`, 'lemon');
      }
    }
  } else if (name === 'order_refunded') {
    // Remboursement complet d'un achat : la licence qu'il avait créée est révoquée, et ses machines libérées.
    if (custom.kind !== 'product' || attributes.status !== 'refunded' || !get('SELECT id FROM orders WHERE provider_ref = ?', orderRef)) return;
    transaction(() => {
      run(`UPDATE licenses SET status = 'revoked' WHERE id = (SELECT id FROM licenses WHERE user_id = ? AND product_id = ?
             AND source = 'lemon' AND status = 'active' ORDER BY created_at DESC LIMIT 1)`, userId, refId);
      const still = get(`SELECT id FROM licenses WHERE user_id = ? AND product_id = ? AND status = 'active'
                          AND (expires_at IS NULL OR expires_at > ?)`, userId, refId, now());
      if (!still) run('DELETE FROM activations WHERE user_id = ? AND product_id = ?', userId, refId);
    });
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
    grantProduct(user.id, item, 'free');
    return { mode: 'free', granted: true };
  }
  if (config.paymentsMode === 'demo') {
    if (kind === 'product') grantProduct(user.id, item, 'demo');
    else setSubscription(user.id, item.id, { status: 'active', periodEnd: now() + PERIOD_MS[item.interval], productIds: item.productIds ?? null });
    return { mode: 'demo', granted: true };
  }
  if (config.paymentsMode === 'stripe') return stripeCheckout(user, kind, item);
  if (config.paymentsMode === 'lemon') return lemonCheckout(user, kind, item);
  throw new HttpError(503, 'Les achats ne sont pas encore ouverts.');
}

export async function cancelSubscription(userId) {
  const sub = get('SELECT * FROM subscriptions WHERE user_id = ?', userId);
  if (!sub || sub.status !== 'active') throw new HttpError(404, 'Aucun abonnement en cours.');
  if (sub.stripe_subscription && config.paymentsMode === 'stripe') {
    await stripe('POST', `/subscriptions/${sub.stripe_subscription}`, { cancel_at_period_end: true });
  }
  // Chez Lemon Squeezy, supprimer un abonnement le résilie à la fin de la période payée.
  if (sub.stripe_subscription && config.paymentsMode === 'lemon') await lemon('DELETE', `/subscriptions/${sub.stripe_subscription}`);
  run('UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE user_id = ?', now(), userId);
}
