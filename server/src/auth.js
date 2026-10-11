import crypto from 'node:crypto';
import { config } from './config.js';
import { get, run, now } from './db.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    sha256(token), userId, now() + config.sessionDays * 86400_000);
  return token;
}

export function destroySession(token) {
  run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

/** Jeton de réinitialisation à usage unique, valable une heure. Seule son empreinte est gardée. */
export function createResetToken(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?', userId, now());
  run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, now() + 3600_000);
  return token;
}

/** Renvoie l'identifiant du compte si le jeton est valable, et le consomme. */
export function consumeResetToken(token) {
  const row = get('SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?', sha256(String(token)), now());
  if (row) run('DELETE FROM password_resets WHERE user_id = ?', row.user_id);
  return row?.user_id ?? null;
}

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export function requireUser(req, _res, next) {
  const token = bearer(req);
  const user = token && get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`, sha256(token), now());
  if (!user) return next(new HttpError(401, 'Session expirée, reconnectez-vous.'));
  req.user = user;
  req.token = token;
  next();
}

/** Le compte connecté, ou null pour un visiteur (un jeton invalide est traité comme une absence de jeton). */
export function optionalUser(req) {
  const token = bearer(req);
  return (token && get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`, sha256(token), now())) || null;
}

export function requireAdmin(req, res, next) {
  requireUser(req, res, (error) => {
    if (error) return next(error);
    if (req.user.role !== 'admin') return next(new HttpError(403, 'Réservé aux administrateurs.'));
    next();
  });
}

/** Limite les essais par clé (IP + e-mail) : 10 par quart d'heure. */
const attempts = new Map();
export function rateLimit(key, max = 10, windowMs = 15 * 60_000) {
  const t = now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < t) {
    attempts.set(key, { count: 1, reset: t + windowMs });
    return;
  }
  if (++entry.count > max) throw new HttpError(429, 'Trop de tentatives, réessayez dans quelques minutes.');
}
setInterval(() => {
  const t = now();
  for (const [key, entry] of attempts) if (entry.reset < t) attempts.delete(key);
}, 60_000).unref();

export function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.created_at };
}
