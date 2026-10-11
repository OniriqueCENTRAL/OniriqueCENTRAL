import crypto from 'node:crypto';
import { config } from './config.js';
import { get, run, now, transaction } from './db.js';
import { HttpError } from './auth.js';
import { createLicense } from './licensing.js';

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

export function grantProduct(userId, product, provider, providerRef = null) {
  return transaction(() => {
    if (!recordOrder(userId, 'product', product.id, product.price_cents, provider, providerRef)) return;
    createLicense({ productId: product.id, userId, source: provider, note: 'Achat' });
  });
}

export function setSubscription(userId, planId, { status, periodEnd, cancelAtPeriodEnd = 0, stripeId = null }) {
  run(`INSERT INTO subscriptions (user_id, plan_id, status, current_period_end, cancel_at_period_end, stripe_subscription, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET plan_id = excluded.plan_id, status = excluded.status,
         current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
         stripe_subscription = excluded.stripe_subscription, updated_at = excluded.updated_at`,
    userId, planId, status, periodEnd, cancelAtPeriodEnd ? 1 : 0, stripeId, now());
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
    success_url: `${config.publicUrl}/checkout/done`,
    cancel_url: `${config.publicUrl}/checkout/cancelled`,
    metadata: { user_id: user.id, kind, ref_id: item.id },
    subscription_data: kind === 'plan' ? { metadata: { user_id: user.id, plan_id: item.id } } : undefined,
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
  if (event.type === 'checkout.session.completed') {
    const userId = Number(object.metadata?.user_id);
    if (!userId) return;
    if (object.customer) run('UPDATE users SET stripe_customer = ? WHERE id = ?', object.customer, userId);
    if (object.mode === 'payment' && object.payment_status === 'paid') {
      const product = get('SELECT * FROM products WHERE id = ?', Number(object.metadata.ref_id));
      if (product) grantProduct(userId, product, 'stripe', object.id);
    } else if (object.mode === 'subscription' && object.subscription) {
      applyStripeSubscription(await stripe('GET', `/subscriptions/${object.subscription}`));
    }
  } else if (event.type.startsWith('customer.subscription.')) {
    applyStripeSubscription(object);
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
    else setSubscription(user.id, item.id, { status: 'active', periodEnd: now() + PERIOD_MS[item.interval] });
    return { mode: 'demo', granted: true };
  }
  if (config.paymentsMode === 'stripe') return stripeCheckout(user, kind, item);
  throw new HttpError(503, 'Les achats ne sont pas encore ouverts.');
}

export async function cancelSubscription(userId) {
  const sub = get('SELECT * FROM subscriptions WHERE user_id = ?', userId);
  if (!sub || sub.status !== 'active') throw new HttpError(404, 'Aucun abonnement en cours.');
  if (sub.stripe_subscription && config.paymentsMode === 'stripe') {
    await stripe('POST', `/subscriptions/${sub.stripe_subscription}`, { cancel_at_period_end: true });
  }
  run('UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE user_id = ?', now(), userId);
}
