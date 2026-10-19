import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { all, get, run, now, setting } from './db.js';
import { HttpError, canSelfLicense, rolesWith } from './auth.js';

//==============================================================================
//  Clé de signature : la clé privée ne quitte jamais le serveur. Les plugins
//  embarquent la clé publique et vérifient le fichier de licence hors ligne.
//==============================================================================
const privatePath = path.join(config.keysDir, 'license-private.pem');
const publicPath = path.join(config.keysDir, 'license-public.pem');

if (!fs.existsSync(privatePath)) {
  const pair = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(publicPath, pair.publicKey.export({ type: 'spki', format: 'pem' }));
}

const privateKey = crypto.createPrivateKey(fs.readFileSync(privatePath));
export const publicKeyPem = fs.readFileSync(publicPath, 'utf8');
/** Les 32 octets bruts de la clé publique, tels qu'attendus côté C++. */
export const publicKeyRaw = crypto.createPublicKey(publicKeyPem)
  .export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');

export function signLicense(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    format: 'onirique-license-v1',
    payload: body.toString('base64'),
    signature: crypto.sign(null, body, privateKey).toString('base64'),
  };
}

//==============================================================================
//  Clés de licence
//==============================================================================
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I

export function generateKey() {
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
    if (i % 4 === 3 && i < 15) out += '-';
  }
  return `ONIR-${out}`;
}

export function normalizeKey(input) {
  // L'alphabet des clés n'a pas de O : le préfixe ne peut pas être confondu avec le corps.
  const body = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ONIR/, '');
  return `ONIR-${body.match(/.{1,4}/g)?.join('-') ?? ''}`;
}

export function createLicense({ productId, userId = null, reservedEmail = null, type = 'perpetual',
  expiresAt = null, maxActivations = config.defaultMaxActivations, source = 'admin', note = '', bundle = null }) {
  const key = generateKey();
  const { lastInsertRowid } = run(
    `INSERT INTO licenses (key, product_id, user_id, reserved_email, type, expires_at, max_activations, source, note, created_at, bundle)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    key, productId, userId, reservedEmail, type, expiresAt, maxActivations, source, note, now(), bundle);
  return get('SELECT * FROM licenses WHERE id = ?', lastInsertRowid);
}

//==============================================================================
//  Droits
//==============================================================================
export function activeSubscription(userId) {
  const sub = get(
    `SELECT s.*, p.name AS plan_name, p.interval, p.price_cents, p.kind AS plan_kind, p.product_ids AS plan_product_ids FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id WHERE s.user_id = ?`, userId);
  if (!sub) return null;
  return {
    ...sub,
    valid: sub.status === 'active' && sub.current_period_end > now(),
    // Les plugins couverts : ceux choisis à la carte, sinon ceux de la formule ; null pour tout le catalogue.
    productIds: parseProductIds(sub.product_ids) ?? parseProductIds(sub.plan_product_ids),
  };
}

export function parseProductIds(stored) {
  if (!stored) return null;
  try {
    const ids = JSON.parse(stored);
    return Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : null;
  } catch {
    return null;
  }
}

/** Abonnement à la carte : le prix mensuel du premier plugin et de chaque plugin ajouté (réglables depuis le panel admin). */
export const pickPrices = () => ({
  baseCents: setting('pickBaseCents', config.pickBaseCents),
  extraCents: setting('pickExtraCents', config.pickExtraCents),
});

/** Le prix mensuel d'un abonnement à la carte pour ce nombre de plugins. */
export const pickPriceCents = (count) => pickPrices().baseCents + pickPrices().extraCents * Math.max(0, count - 1);

/** La formule à la carte : il n'y en a qu'une, créée à la première demande. Son prix est celui du premier plugin. */
export function pickPlan() {
  const existing = get(`SELECT * FROM plans WHERE kind = 'pick' ORDER BY id LIMIT 1`);
  if (existing) return existing;
  const { lastInsertRowid } = run(`INSERT INTO plans (name, interval, price_cents, active, kind) VALUES ('À LA CARTE', 'month', ?, 1, 'pick')`,
    pickPrices().baseCents);
  return get('SELECT * FROM plans WHERE id = ?', lastInsertRowid);
}

/** Ce qui donne à l'utilisateur le droit d'utiliser ce produit, ou null. */
export function entitlement(userId, productId) {
  const license = get(
    `SELECT * FROM licenses WHERE user_id = ? AND product_id = ? AND status = 'active'
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY expires_at IS NULL DESC, expires_at DESC LIMIT 1`, userId, productId, now());
  // VIP, et membres de l'équipe ou partenaires qui se sont accordé leurs licences : tous les plugins, sans licence à
  // acheter (un essai en cours ne les ramène pas au mode démo). Comme pour un abonnement, la licence écrite sur la
  // machine a une durée : retirer le rôle ou couper le réglage la laisse s'éteindre.
  const owner = get('SELECT role, self_licenses FROM users WHERE id = ?', userId);
  const vip = !!owner && (rolesWith('plugins').includes(owner.role) || (!!owner.self_licenses && canSelfLicense(owner)));
  if (vip && (!license || license.type === 'trial')) {
    return {
      via: 'vip', type: 'vip', licenseId: null,
      expiresAt: now() + config.vipLicenseDays * 86400_000,
      maxActivations: config.defaultMaxActivations,
    };
  }
  if (license) {
    const { limit } = get(
      `SELECT MAX(max_activations) AS "limit" FROM licenses WHERE user_id = ? AND product_id = ?
         AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`, userId, productId, now());
    return { via: 'license', type: license.type, licenseId: license.id, expiresAt: license.expires_at, maxActivations: limit };
  }
  // Un abonnement est encaissé par ONIRIQUE : il ne couvre que les plugins ONIRIQUE. Ceux d'un créateur partenaire
  // s'achètent à l'unité, sur le compte de ce créateur.
  const sub = activeSubscription(userId);
  if (sub?.valid && (!sub.productIds || sub.productIds.includes(Number(productId)))
      && get('SELECT creator FROM products WHERE id = ?', productId)?.creator === 'onirique') {
    return {
      via: 'subscription', type: 'subscription', licenseId: null,
      expiresAt: sub.current_period_end + config.subscriptionGraceDays * 86400_000,
      maxActivations: config.defaultMaxActivations,
    };
  }
  return null;
}

/**
 * Active un plugin sur une machine et rend le fichier de licence signé pour elle.
 *
 * legacyMachineId : l'ancienne empreinte de la même machine (ONIRIQUE CENTRAL avant le 15 octobre 2026). Une
 * activation faite sous l'ancienne empreinte est reprise telle quelle : elle ne compte pas une machine de plus.
 *
 * Le fichier porte un bail (leaseUntil) : ONIRIQUE CENTRAL le renouvelle à chaque ouverture ; hors ligne, la licence
 * vaut jusqu'à la fin du bail. Une licence remboursée, révoquée ou d'un compte supprimé s'éteint donc partout.
 */
export function activate(user, product, machineId, machineName, legacyMachineId = null) {
  const right = entitlement(user.id, product.id);
  if (!right) throw new HttpError(403, `Aucune licence active pour ${product.name}.`);

  let existing = get('SELECT id FROM activations WHERE user_id = ? AND product_id = ? AND machine_id = ?',
    user.id, product.id, machineId);
  if (!existing && legacyMachineId && legacyMachineId !== machineId) {
    const old = get('SELECT id FROM activations WHERE user_id = ? AND product_id = ? AND machine_id = ?', user.id, product.id, legacyMachineId);
    if (old) {
      run('UPDATE activations SET machine_id = ? WHERE id = ?', machineId, old.id);
      existing = old;
    }
  }
  if (existing) {
    run('UPDATE activations SET last_seen_at = ?, machine_name = ? WHERE id = ?', now(), machineName, existing.id);
  } else {
    const { count } = get('SELECT COUNT(*) AS count FROM activations WHERE user_id = ? AND product_id = ?', user.id, product.id);
    if (count >= right.maxActivations) {
      throw new HttpError(409, `Limite de ${right.maxActivations} machine(s) atteinte : désactivez-en une d'abord.`);
    }
    // Une licence qu'on ferait tourner d'ordinateur en ordinateur (désactiver ici, activer là) : quelques nouvelles
    // machines par mois au plus, au-delà de la limite elle-même.
    const { recent } = get('SELECT COUNT(DISTINCT machine_id) AS recent FROM activation_log WHERE user_id = ? AND product_id = ? AND created_at > ?',
      user.id, product.id, now() - 30 * 86400_000);
    if (recent >= right.maxActivations + config.extraActivationsPerMonth) {
      throw new HttpError(429, `Trop de nouveaux ordinateurs activés ce mois-ci pour ${product.name}. Réessayez dans quelques jours, ou écrivez au support.`);
    }
    run('INSERT INTO activations (user_id, product_id, machine_id, machine_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
      user.id, product.id, machineId, machineName, now(), now());
    run('INSERT INTO activation_log (user_id, product_id, machine_id, created_at) VALUES (?, ?, ?, ?)', user.id, product.id, machineId, now());
  }

  const issuedAt = now();
  const lease = issuedAt + config.leaseDays * 86400_000;
  // Deux empreintes : « machine », l'ancienne, pour les plugins d'avant le 15 octobre 2026 (qui ne lisent qu'elle),
  // et « machine2 », la nouvelle, que les plugins d'aujourd'hui exigent.
  const legacy = legacyMachineId && legacyMachineId !== machineId ? legacyMachineId : null;
  return signLicense({
    product: product.slug,
    email: user.email,
    machine: legacy || machineId,
    ...(legacy ? { machine2: machineId } : {}),
    type: right.type,
    licenseId: right.licenseId,
    issuedAt,
    expiresAt: right.expiresAt,
    leaseUntil: right.expiresAt ? Math.min(right.expiresAt, lease) : lease,
  });
}

export function userActivations(userId) {
  return all(
    `SELECT a.product_id AS productId, a.machine_id AS machineId, a.machine_name AS machineName, a.last_seen_at AS lastSeenAt
     FROM activations a WHERE a.user_id = ? ORDER BY a.created_at`, userId);
}
