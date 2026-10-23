import crypto from 'node:crypto';
import { config } from './config.js';
import { get, run, now, setting } from './db.js';
import { mailEnabled } from './mail.js';

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

/** Jeton de validation de l'adresse e-mail, à usage unique. Seule son empreinte est gardée. */
export function createVerifyToken(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('DELETE FROM email_verifications WHERE user_id = ? OR expires_at < ?', userId, now());
  run('INSERT INTO email_verifications (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    sha256(token), userId, now() + config.verifyHours * 3600_000);
  return token;
}

/** Renvoie l'identifiant du compte si le jeton est valable, et le consomme. */
export function consumeVerifyToken(token) {
  const row = get('SELECT user_id FROM email_verifications WHERE token_hash = ? AND expires_at > ?', sha256(String(token)), now());
  if (row) run('DELETE FROM email_verifications WHERE user_id = ?', row.user_id);
  return row?.user_id ?? null;
}

/**
 * Compte créé avant la validation des adresses (email_verified = 2) : rien ne lui est fermé, mais son adresse
 * n'a jamais été confirmée. Le site le lui rappelle, et le lien de validation le fait passer à 1.
 */
export const shouldConfirm = (user) => mailEnabled && user.email_verified === 2;

/** Vrai si ce compte doit encore valider son adresse. Sans envoi d'e-mails possible, personne n'est retenu. */
export const mustVerify = (user) => mailEnabled && !user.email_verified && !isStaff(user);

/**
 * Les rôles d'un compte : user ; vip (tous les plugins offerts) ; abrasion et relic (partenaires : le panel admin, limité à ses
 * propres plugins et à leurs licences) ; admin ; founder (au-dessus des admins : lui seul donne ou retire le rôle admin).
 */
/** Les partenaires : chacun est à la fois un créateur de plugins et le rôle des comptes qui gèrent ces plugins. */
export const PARTNERS = ['abrasion', 'relic'];
export const ROLES = ['user', 'vip', ...PARTNERS, 'admin', 'founder'];
// Les droits réglables par les fondateurs, rôle par rôle (panel admin, « Droits des rôles »). Les valeurs par défaut
// sont celles d'avant le réglage. Les fondateurs ont toujours tous ces droits, sauf « plugins » : eux s'accordent leurs
// licences par le réglage « Mes licences », comme les admins et les partenaires.
export const RIGHTS = {
  sounds: { label: 'ONIRIQUE CLOUD', default: ['vip', 'admin'] },
  links: { label: 'Page de liens', default: ['vip', 'admin'] },
  plugins: { label: 'Tous les plugins offerts', default: ['vip'] },
  engineer: { label: "Profil d'ingé (crédits)", default: [] },
  youtube: { label: 'Shorts YouTube programmés', default: [] },
  instagram: { label: 'Réponses automatiques Instagram', default: [] },
};
// Les rôles dont les droits se règlent (les fondateurs ont tout).
export const EDITABLE_ROLES = ['user', 'vip', 'abrasion', 'relic', 'admin'];
/** Les rôles qui ont ce droit en ce moment. */
export function rolesWith(right) {
  const chosen = setting('role_rights', {})[right];
  const roles = (Array.isArray(chosen) ? chosen : RIGHTS[right].default).filter((r) => EDITABLE_ROLES.includes(r));
  return right === 'plugins' ? roles : [...roles, 'founder'];
}
export const can = (user, right) => !!user && rolesWith(right).includes(user.role);
export const rightsOf = (user) => Object.keys(RIGHTS).filter((right) => can(user, right));
export const isStaff = (user) => user.role === 'admin' || user.role === 'founder';
/** Le créateur dont ce compte gère les plugins, pour un partenaire ; null pour tous les autres. */
export const partnerOf = (user) => (PARTNERS.includes(user.role) ? user.role : null);
/** L'équipe et les partenaires peuvent s'accorder eux-mêmes tous les plugins (réglage self_licenses du compte). */
export const canSelfLicense = (user) => isStaff(user) || PARTNERS.includes(user.role);

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

/** Compte connecté dont l'adresse est validée : ce qui engage une licence ou un paiement passe par ici. */
export function requireVerified(req, res, next) {
  requireUser(req, res, (error) => {
    if (error) return next(error);
    if (mustVerify(req.user)) {
      return next(new HttpError(403, "Validez d'abord votre adresse e-mail : ouvrez le lien reçu par e-mail, ou redemandez-le depuis la page Compte du site."));
    }
    next();
  });
}

/** Le panel admin : en entier pour un admin ou un fondateur ; pour un partenaire, req.creator le limite à ses plugins. */
export function requireAdmin(req, res, next) {
  requireUser(req, res, (error) => {
    if (error) return next(error);
    req.creator = isStaff(req.user) ? null : partnerOf(req.user);
    if (!isStaff(req.user) && !req.creator) return next(new HttpError(403, 'Réservé aux administrateurs.'));
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
  return {
    id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.created_at,
    avatar: user.avatar ? `/api/media/${user.avatar}` : null, // la photo de profil ; null : l'avatar par défaut
    instagram: user.instagram || '',
    engineerName: user.engineer_name || '',
    engineerAvatar: user.engineer_avatar ? `/api/media/${user.engineer_avatar}` : null,
    emailVerified: !mustVerify(user),
    emailToConfirm: shouldConfirm(user),
    // Pour l'équipe et les partenaires : se sont-ils accordé tous les plugins ? (null : le compte n'y a pas droit)
    selfLicenses: canSelfLicense(user) ? !!user.self_licenses : null,
    newsletter: user.marketing === 1, // a accepté de recevoir les nouveautés d'ONIRIQUE par e-mail
    twoFactor: !!user.totp_secret,    // double authentification activée
  };
}
