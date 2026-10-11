import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { all, get, run, now } from './db.js';
import { HttpError } from './auth.js';

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
  expiresAt = null, maxActivations = config.defaultMaxActivations, source = 'admin', note = '' }) {
  const key = generateKey();
  const { lastInsertRowid } = run(
    `INSERT INTO licenses (key, product_id, user_id, reserved_email, type, expires_at, max_activations, source, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    key, productId, userId, reservedEmail, type, expiresAt, maxActivations, source, note, now());
  return get('SELECT * FROM licenses WHERE id = ?', lastInsertRowid);
}

//==============================================================================
//  Droits
//==============================================================================
export function activeSubscription(userId) {
  const sub = get(
    `SELECT s.*, p.name AS plan_name, p.interval, p.price_cents FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id WHERE s.user_id = ?`, userId);
  if (!sub) return null;
  return { ...sub, valid: sub.status === 'active' && sub.current_period_end > now() };
}

/** Ce qui donne à l'utilisateur le droit d'utiliser ce produit, ou null. */
export function entitlement(userId, productId) {
  const license = get(
    `SELECT * FROM licenses WHERE user_id = ? AND product_id = ? AND status = 'active'
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY expires_at IS NULL DESC, expires_at DESC LIMIT 1`, userId, productId, now());
  if (license) {
    const { limit } = get(
      `SELECT MAX(max_activations) AS "limit" FROM licenses WHERE user_id = ? AND product_id = ?
         AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`, userId, productId, now());
    return { via: 'license', type: license.type, licenseId: license.id, expiresAt: license.expires_at, maxActivations: limit };
  }
  const sub = activeSubscription(userId);
  if (sub?.valid) {
    return {
      via: 'subscription', type: 'subscription', licenseId: null,
      expiresAt: sub.current_period_end + config.subscriptionGraceDays * 86400_000,
      maxActivations: config.defaultMaxActivations,
    };
  }
  return null;
}

export function activate(user, product, machineId, machineName) {
  const right = entitlement(user.id, product.id);
  if (!right) throw new HttpError(403, `Aucune licence active pour ${product.name}.`);

  const existing = get('SELECT id FROM activations WHERE user_id = ? AND product_id = ? AND machine_id = ?',
    user.id, product.id, machineId);
  if (existing) {
    run('UPDATE activations SET last_seen_at = ?, machine_name = ? WHERE id = ?', now(), machineName, existing.id);
  } else {
    const { count } = get('SELECT COUNT(*) AS count FROM activations WHERE user_id = ? AND product_id = ?', user.id, product.id);
    if (count >= right.maxActivations) {
      throw new HttpError(409, `Limite de ${right.maxActivations} machine(s) atteinte : désactivez-en une d'abord.`);
    }
    run('INSERT INTO activations (user_id, product_id, machine_id, machine_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
      user.id, product.id, machineId, machineName, now(), now());
  }

  return signLicense({
    product: product.slug,
    email: user.email,
    machine: machineId,
    type: right.type,
    licenseId: right.licenseId,
    issuedAt: now(),
    expiresAt: right.expiresAt,
  });
}

export function userActivations(userId) {
  return all(
    `SELECT a.product_id AS productId, a.machine_id AS machineId, a.machine_name AS machineName, a.last_seen_at AS lastSeenAt
     FROM activations a WHERE a.user_id = ? ORDER BY a.created_at`, userId);
}
