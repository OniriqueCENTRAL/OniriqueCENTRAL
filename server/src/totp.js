// Double authentification (A2F) : les codes à 6 chiffres de Google Authenticator et des applications semblables
// (TOTP, RFC 6238 : HMAC-SHA1, un code toutes les 30 secondes).
import crypto from 'node:crypto';
import { renderSVG } from 'uqr';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30_000;

/** Une clé secrète neuve, en base32 comme l'attendent les applications. */
export function newSecret() {
  let bits = '';
  for (const byte of crypto.randomBytes(20)) bits += byte.toString(2).padStart(8, '0');
  return bits.match(/.{5}/g).map((b) => ALPHABET[parseInt(b, 2)]).join('');
}

function decode(secret) {
  const bits = [...secret].map((c) => ALPHABET.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
}

export function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', decode(secret)).update(counter).digest();
  const at = mac[19] & 0xf;
  return String((mac.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * Le pas de temps du code, s'il est juste : celui de maintenant ou un voisin (horloge du téléphone un peu décalée).
 * Un code déjà servi (pas de temps ≤ lastStep) est refusé : il ne peut pas être rejoué.
 */
export function matchStep(secret, code, lastStep = 0, t = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(t / STEP);
  for (const s of [step - 1, step, step + 1]) {
    if (s > lastStep && crypto.timingSafeEqual(Buffer.from(codeAt(secret, s)), Buffer.from(code))) return s;
  }
  return null;
}

/** L'adresse otpauth:// que l'application lit dans le QR code, et le QR code lui-même (SVG). */
export function enrollment(secret, email) {
  const uri = `otpauth://totp/${encodeURIComponent(`ONIRIQUE:${email}`)}?secret=${secret}&issuer=ONIRIQUE&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri, qr: renderSVG(uri, { border: 2 }) };
}

/** Codes de secours, pour se connecter sans le téléphone : chacun ne sert qu'une fois. Seule leur empreinte est gardée. */
export function newRecoveryCodes() {
  return Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})/, '$1-'));
}
export const recoveryHash = (code) => crypto.createHash('sha256').update(String(code).toUpperCase().replace(/[^0-9A-F]/g, '')).digest('hex');
