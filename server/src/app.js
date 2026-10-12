import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import { config } from './config.js';
import { all, get, run, now, transaction, grantFounders, setting, setSetting } from './db.js';
import {
  HttpError, hashPassword, verifyPassword, createSession, destroySession,
  requireUser, requireVerified, requireAdmin, optionalUser, rateLimit, validEmail, publicUser, createResetToken, consumeResetToken,
  ROLES, PARTNERS, isStaff, partnerOf, canSelfLicense,
  createVerifyToken, consumeVerifyToken, mustVerify, shouldConfirm,
} from './auth.js';
import { mailEnabled, sendMail } from './mail.js';
import { embedsLicenseKey, MISSING_LICENSE } from './plugincheck.js';
import {
  activate, activeSubscription, createLicense, entitlement, generateKey, normalizeKey, pickPlan, pickPriceCents, pickPrices,
  publicKeyPem, publicKeyRaw, userActivations,
} from './licensing.js';
import {
  cancelSubscription, checkout, connectStripe, disconnectStripe, handleLemonEvent, handleStripeEvent, paymentsMode,
  stripeAccount, stripeAccountView, verifyLemonSignature, verifyStripeSignature,
} from './payments.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const str = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const int = (value, fallback = null) => (Number.isInteger(Number(value)) && value !== '' && value !== null ? Number(value) : fallback);

/** Nom de fichier réduit à un nom simple : jamais de chemin, jamais de caractère réservé. */
function safeFilename(input) {
  const name = path.basename(String(input || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  if (!name || name.startsWith('.') || name.length > 120) throw new HttpError(400, 'Nom de fichier invalide.');
  return name;
}

export function compareVersions(a, b) {
  const pa = String(a).split(/[.\-+]/), pb = String(b).split(/[.\-+]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0', y = pb[i] ?? '0';
    const nx = Number(x), ny = Number(y);
    const diff = Number.isNaN(nx) || Number.isNaN(ny) ? x.localeCompare(y) : nx - ny;
    if (diff) return diff;
  }
  return 0;
}

// Les formats livrés dans le .zip d'une version Mac (VST3, Audio Unit…), lus une fois dans les noms de l'archive.
const zipFormats = new Map();
function versionFormats(v) {
  if (v.platform !== 'mac' || !/\.zip$/i.test(v.filename)) return undefined;
  const key = `${v.stored_as}:${v.size}`; // un fichier remplacé change de taille : il est relu
  if (!zipFormats.has(key)) {
    let data = Buffer.alloc(0);
    try { data = fs.readFileSync(path.join(config.filesDir, v.stored_as)); } catch { /* fichier absent : aucun format annoncé */ }
    zipFormats.set(key, [['VST3', '.vst3/'], ['AAX', '.aaxplugin/'], ['AU', '.component/']].filter(([, mark]) => data.includes(mark)).map(([name]) => name));
  }
  return zipFormats.get(key);
}

// Une version vérifie-t-elle sa licence ? true / false d'après le contenu du fichier (voir plugincheck.js), null quand
// il ne se lit pas (installateur). Calculé une fois par fichier : il faut le lire en entier.
const licenseChecks = new Map();
function versionLicensed(v) {
  const key = `${v.stored_as}:${v.size}`;
  if (!licenseChecks.has(key)) {
    let result = null;
    try { result = embedsLicenseKey(fs.readFileSync(path.join(config.filesDir, v.stored_as)), v.filename, publicKeyPem); } catch { /* fichier absent */ }
    licenseChecks.set(key, result);
  }
  return licenseChecks.get(key);
}

const versionView = (v) => v && ({
  id: v.id, version: v.version, notes: v.notes, filename: v.filename, size: v.size, sha256: v.sha256, createdAt: v.created_at,
  platform: v.platform, formats: versionFormats(v),
});

/** Le système demandé : "mac" pour l'application Mac, "win" pour tout le reste (application Windows, site). */
const platformOf = (value) => (value === 'mac' ? 'mac' : 'win');

function productVersions(productId) {
  return all('SELECT * FROM versions WHERE product_id = ?', productId)
    .sort((a, b) => compareVersions(b.version, a.version) || b.created_at - a.created_at);
}

/** latest est la dernière version pour le système demandé : null si le plugin n'existe pas encore pour lui. */
function productView(p, platform) {
  const versions = productVersions(p.id);
  const wanted = platformOf(platform);
  return {
    id: p.id, slug: p.slug, name: p.name, tagline: p.tagline, description: p.description, accent: p.accent,
    creator: p.creator, // "onirique" ou un partenaire ("abrasion", "bloom")
    priceCents: p.price_cents, image: p.image ? `/api/media/${p.image}` : null, published: !!p.published,
    demo: p.demo ? `/api/media/${p.demo}` : null,
    latest: versionView(versions.find((v) => v.platform === wanted)) || null,
    platforms: [...new Set(versions.map((v) => v.platform))], // les systèmes pour lesquels le plugin existe
    versions: versions.map(versionView),
  };
}

const planView = (p) => ({ id: p.id, name: p.name, interval: p.interval, priceCents: p.price_cents, active: !!p.active, kind: p.kind });

/** Envoie le lien de validation de l'adresse. Sans attente : l'inscription ne dépend pas du serveur de messagerie. */
function sendVerification(user) {
  const link = `${config.siteUrl}/compte?verify=${createVerifyToken(user.id)}`;
  sendMail(user.email, 'Validez votre adresse e-mail — ONIRIQUE',
    `Bonjour${user.name ? ' ' + user.name : ''},\n\n${mustVerify(user) ? 'Bienvenue chez ONIRIQUE. Pour valider votre compte' : 'Pour confirmer votre adresse e-mail'}, ouvrez ce lien `
    + `(valable ${config.verifyHours} heures) :\n\n${link}\n\n`
    + (mustVerify(user) ? "Tant que l'adresse n'est pas validée, les essais gratuits, les achats et l'activation des plugins restent fermés.\n\n" : '')
    + "Si vous n'avez pas créé de compte, ignorez ce message.\n\nONIRIQUE")
    .catch((error) => console.error('Envoi du lien de validation :', error.message));
}

/** Les licences réservées à cette adresse par un admin lui reviennent une fois l'adresse prouvée. */
function claimReserved(user) {
  run(`UPDATE licenses SET user_id = ?, reserved_email = NULL WHERE user_id IS NULL AND reserved_email = ?`, user.id, user.email);
}

const licenseView = (l) => ({
  id: l.id, key: l.key, productId: l.product_id, productName: l.product_name, userId: l.user_id, email: l.email || l.reserved_email || null,
  claimed: !!l.user_id, type: l.type, status: l.status, expiresAt: l.expires_at, maxActivations: l.max_activations,
  source: l.source, note: l.note, createdAt: l.created_at, activations: l.activations ?? undefined,
  bundle: l.bundle ?? null, // la clé du pack ALL LICENCE dont cette licence fait partie
});

function findProduct(id) {
  const product = get('SELECT * FROM products WHERE id = ?', int(id, 0));
  if (!product) throw new HttpError(404, 'Produit introuvable.');
  return product;
}

/** Enregistre le corps de la requête dans un fichier, en calculant taille et empreinte. */
async function receiveFile(req, directory, maxBytes) {
  const storedAs = crypto.randomBytes(16).toString('hex');
  const target = path.join(directory, storedAs);
  const hash = crypto.createHash('sha256');
  let size = 0;
  try {
    await pipeline(req, async function* (source) {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > maxBytes) throw new HttpError(413, 'Fichier trop volumineux.');
        hash.update(chunk);
        yield chunk;
      }
    }, fs.createWriteStream(target));
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw error;
  }
  if (!size) {
    fs.rmSync(target, { force: true });
    throw new HttpError(400, 'Fichier vide.');
  }
  return { storedAs, size, sha256: hash.digest('hex') };
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Stripe signe le corps brut : ce point d'entrée passe avant le parseur JSON.
  // Chaque créateur a son adresse : l'événement est vérifié avec le secret de son compte, et n'agit que sur ses plugins.
  app.post(['/api/stripe/webhook', '/api/stripe/webhook/:creator'], express.raw({ type: '*/*', limit: '1mb' }), wrap(async (req, res) => {
    const account = stripeAccount(req.params.creator || 'onirique');
    if (!account) throw new HttpError(404, 'Introuvable.');
    const raw = req.body.toString('utf8');
    verifyStripeSignature(raw, req.headers['stripe-signature'], account.hook);
    await handleStripeEvent(JSON.parse(raw), account);
    res.json({ received: true });
  }));

  app.post('/api/lemon/webhook', express.raw({ type: '*/*', limit: '1mb' }), wrap(async (req, res) => {
    if (paymentsMode() !== 'lemon') throw new HttpError(404, 'Introuvable.');
    const raw = req.body.toString('utf8');
    verifyLemonSignature(raw, req.headers['x-signature']);
    handleLemonEvent(JSON.parse(raw));
    res.json({ received: true });
  }));

  app.use('/api', express.json({ limit: '200kb' }));

  //============================================================================
  //  Public
  //============================================================================
  app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'ONIRIQUE CENTRAL' }));

  app.get('/api/catalog', (req, res) => {
    const platform = platformOf(req.get('X-Onirique-Platform'));
    res.json({
      products: all('SELECT * FROM products WHERE published = 1 ORDER BY created_at').map((p) => productView(p, platform)),
      plans: all(`SELECT * FROM plans WHERE active = 1 AND kind = 'all' ORDER BY price_cents`).map(planView),
      // Abonnement à la carte : le prix du premier plugin et de chaque plugin ajouté, par mois.
      pick: pickPrices(),
      paymentsMode: paymentsMode(),
    });
  });

  app.get('/api/public-key', (_req, res) => res.json({ pem: publicKeyPem, raw: publicKeyRaw }));

  // Crédits : les titres réalisés avec les plugins, affichés sur la page d'accueil du site.
  const creditRows = () => all(
    `SELECT c.*, p.name AS product_name, p.slug AS product_slug FROM credits c
     LEFT JOIN products p ON p.id = c.product_id ORDER BY c.created_at DESC`).map((c) => ({
    id: c.id, title: c.title, artist: c.artist, kind: c.kind, released: c.released, duration: c.duration,
    spotifyId: c.spotify_id, cover: c.cover ? `/api/media/${c.cover}` : null, usedOn: c.used_on,
    plugin: c.product_id ? { id: c.product_id, name: c.product_name, slug: c.product_slug } : null,
  }));
  app.get('/api/credits', (_req, res) => res.json(creditRows()));

  app.get('/api/media/:file', (req, res, next) => {
    if (!/^[a-f0-9]{32}\.(png|jpg|webp|json)$/.test(req.params.file)) return next(new HttpError(404, 'Introuvable.'));
    res.set('X-Content-Type-Options', 'nosniff'); // des images viennent des utilisateurs : le type annoncé fait foi
    res.sendFile(path.join(config.mediaDir, req.params.file), { maxAge: '7d' }, (error) => error && next(new HttpError(404, 'Introuvable.')));
  });

  for (const [route, text] of [['done', 'Paiement reçu. Vous pouvez revenir dans ONIRIQUE CENTRAL.'], ['cancelled', 'Paiement annulé.']]) {
    app.get(`/checkout/${route}`, (_req, res) => res.type('html').send(
      `<!doctype html><meta charset="utf-8"><title>ONIRIQUE CENTRAL</title>
       <body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d0809;color:#f6eeee;font:16px system-ui">${text}</body>`));
  }

  //============================================================================
  //  Comptes
  //============================================================================
  app.post('/api/auth/register', (req, res) => {
    rateLimit(`register:${req.ip}`, 20);
    const email = str(req.body.email, 254).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!validEmail(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Mot de passe : 8 caractères minimum.');
    if (get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'Un compte existe déjà avec cette adresse.');

    // Sans serveur de messagerie, aucun lien ne peut partir : le compte est validé d'office.
    const { lastInsertRowid: id } = run('INSERT INTO users (email, name, password_hash, email_verified, created_at) VALUES (?, ?, ?, ?, ?)',
      email, str(req.body.name, 80), hashPassword(password), mailEnabled ? 0 : 1, now());
    const user = get('SELECT * FROM users WHERE id = ?', id);
    // Les licences réservées à cette adresse ne sont rattachées qu'une fois l'adresse validée : sinon il
    // suffirait de s'inscrire avec l'adresse de quelqu'un pour prendre ses licences.
    if (mustVerify(user)) sendVerification(user);
    else claimReserved(user);
    res.status(201).json({ token: createSession(id), user: publicUser(user), verificationSent: mustVerify(user) });
  });

  app.post('/api/auth/verify', (req, res) => {
    rateLimit(`verify:${req.ip}`, 20);
    const user = transaction(() => {
      const id = consumeVerifyToken(req.body.token);
      if (!id) return null;
      run('UPDATE users SET email_verified = 1 WHERE id = ?', id);
      grantFounders();
      const verified = get('SELECT * FROM users WHERE id = ?', id);
      claimReserved(verified);
      return verified;
    });
    if (!user) throw new HttpError(400, 'Lien invalide ou expiré. Redemandez-en un depuis la page Compte.');
    res.json({ ok: true, email: user.email });
  });

  app.post('/api/auth/verify/resend', requireUser, (req, res) => {
    if (!mustVerify(req.user) && !shouldConfirm(req.user)) return res.json({ ok: true, alreadyVerified: true });
    rateLimit(`verify-resend:${req.user.id}`, 3);
    sendVerification(req.user);
    res.json({ ok: true });
  });

  app.post('/api/auth/login', (req, res) => {
    const email = str(req.body.email, 254).toLowerCase();
    rateLimit(`login:${req.ip}:${email}`);
    const user = get('SELECT * FROM users WHERE email = ?', email);
    if (!user || !verifyPassword(String(req.body.password ?? ''), user.password_hash)) {
      throw new HttpError(401, 'E-mail ou mot de passe incorrect.');
    }
    res.json({ token: createSession(user.id), user: publicUser(user) });
  });

  app.post('/api/auth/logout', requireUser, (req, res) => {
    destroySession(req.token);
    res.json({ ok: true });
  });

  app.get('/api/me', requireUser, (req, res) => {
    const licenses = all(
      `SELECT l.*, p.name AS product_name FROM licenses l JOIN products p ON p.id = l.product_id
       WHERE l.user_id = ? ORDER BY l.created_at DESC`, req.user.id);
    const entitlements = {};
    for (const product of all('SELECT id FROM products')) {
      const right = entitlement(req.user.id, product.id);
      if (right) entitlements[product.id] = right;
    }
    const sub = activeSubscription(req.user.id);
    res.json({
      user: publicUser(req.user),
      subscription: sub && {
        planId: sub.plan_id, planName: sub.plan_name, interval: sub.interval, kind: sub.plan_kind,
        // À la carte : les plugins choisis et le prix qui en découle. Sinon tout le catalogue, au prix de la formule.
        productIds: sub.productIds,
        priceCents: sub.productIds ? pickPriceCents(sub.productIds.length) : sub.price_cents,
        status: sub.valid ? 'active' : 'ended', currentPeriodEnd: sub.current_period_end, cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      },
      licenses: licenses.map(licenseView),
      activations: userActivations(req.user.id),
      entitlements,
      // Plugins pour lesquels un essai a déjà été lancé (expiré ou non) : l'essai ne se reprend pas.
      trialsUsed: all(`SELECT DISTINCT product_id AS id FROM licenses WHERE user_id = ? AND source = 'trial'`, req.user.id).map((r) => r.id),
    });
  });

  // L'équipe et les partenaires activent ou coupent, pour leur propre compte, l'accès offert à tous les plugins.
  app.post('/api/me/self-licenses', requireUser, (req, res) => {
    if (!canSelfLicense(req.user)) throw new HttpError(403, 'Réservé à l\'équipe et aux partenaires.');
    const enabled = req.body.enabled ? 1 : 0;
    transaction(() => {
      run('UPDATE users SET self_licenses = ? WHERE id = ?', enabled, req.user.id);
      // Coupé : les machines activées grâce à lui sont libérées, sauf pour les plugins que le compte possède vraiment.
      for (const { product_id: productId } of all('SELECT DISTINCT product_id FROM activations WHERE user_id = ?', req.user.id)) {
        if (!entitlement(req.user.id, productId)) run('DELETE FROM activations WHERE user_id = ? AND product_id = ?', req.user.id, productId);
      }
    });
    res.json({ ok: true, enabled: !!enabled });
  });

  // Photo de profil : une image PNG, JPEG ou WebP de 2 Mo au plus, en corps brut de la requête.
  app.put('/api/me/avatar', requireUser, wrap(async (req, res) => {
    rateLimit(`avatar:${req.user.id}`, 20);
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[req.headers['content-type']];
    if (!ext) throw new HttpError(400, 'Image attendue : PNG, JPEG ou WebP.');
    const file = await receiveFile(req, config.mediaDir, 2 * 1024 * 1024);
    const stored = path.join(config.mediaDir, file.storedAs);
    // Le type annoncé ne suffit pas : le début du fichier doit être celui d'une image de ce type.
    const head = Buffer.alloc(12);
    const fd = fs.openSync(stored, 'r');
    fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
    const real = head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png'
      : head.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? 'jpg'
        : head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : null;
    if (real !== ext) {
      fs.rmSync(stored, { force: true });
      throw new HttpError(400, "Ce fichier n'est pas une image PNG, JPEG ou WebP valide.");
    }
    const name = `${file.storedAs}.${ext}`;
    fs.renameSync(stored, path.join(config.mediaDir, name));
    if (req.user.avatar) fs.rmSync(path.join(config.mediaDir, req.user.avatar), { force: true });
    run('UPDATE users SET avatar = ? WHERE id = ?', name, req.user.id);
    res.json({ avatar: `/api/media/${name}` });
  }));

  app.delete('/api/me/avatar', requireUser, (req, res) => {
    if (req.user.avatar) fs.rmSync(path.join(config.mediaDir, req.user.avatar), { force: true });
    run('UPDATE users SET avatar = NULL WHERE id = ?', req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/me/profile', requireUser, (req, res) => {
    run('UPDATE users SET name = ? WHERE id = ?', str(req.body.name, 80), req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/me/password', requireUser, (req, res) => {
    rateLimit(`password:${req.user.id}`);
    const next = typeof req.body.next === 'string' ? req.body.next : '';
    if (!verifyPassword(String(req.body.current ?? ''), req.user.password_hash)) throw new HttpError(403, 'Mot de passe actuel incorrect.');
    if (next.length < 8 || next.length > 200) throw new HttpError(400, 'Nouveau mot de passe : 8 caractères minimum.');
    transaction(() => {
      run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
      run('DELETE FROM sessions WHERE user_id = ?', req.user.id);
    });
    res.json({ token: createSession(req.user.id) });
  });

  //============================================================================
  //  Licences, achats, téléchargements
  //============================================================================
  app.post('/api/licenses/redeem', requireVerified, (req, res) => {
    rateLimit(`redeem:${req.user.id}`, 15);
    const key = normalizeKey(req.body.key);
    const license = get('SELECT * FROM licenses WHERE key = ?', key);
    // Clé ALL LICENCE : elle porte une licence par plugin, toutes rattachées au compte d'un coup.
    const pack = license ? [] : all(`SELECT * FROM licenses WHERE bundle = ? AND status = 'active'`, key);
    if (pack.length) {
      if (pack.every((l) => l.user_id === req.user.id)) throw new HttpError(409, 'Cette clé est déjà sur votre compte.');
      if (pack.some((l) => l.user_id && l.user_id !== req.user.id)) throw new HttpError(409, 'Cette clé est déjà utilisée par un autre compte.');
      if (pack.some((l) => l.reserved_email && l.reserved_email.toLowerCase() !== req.user.email.toLowerCase())) {
        throw new HttpError(403, 'Cette clé est réservée à une autre adresse e-mail.');
      }
      run(`UPDATE licenses SET user_id = ?, reserved_email = NULL WHERE bundle = ? AND status = 'active' AND user_id IS NULL`, req.user.id, key);
      return res.json({ ok: true, productId: null, products: pack.length });
    }
    if (!license || license.status !== 'active') throw new HttpError(404, 'Clé de licence inconnue ou révoquée.');
    if (license.user_id === req.user.id) throw new HttpError(409, 'Cette clé est déjà sur votre compte.');
    if (license.user_id) throw new HttpError(409, 'Cette clé est déjà utilisée par un autre compte.');
    if (license.reserved_email && license.reserved_email.toLowerCase() !== req.user.email.toLowerCase()) {
      throw new HttpError(403, 'Cette clé est réservée à une autre adresse e-mail.');
    }
    run('UPDATE licenses SET user_id = ?, reserved_email = NULL WHERE id = ?', req.user.id, license.id);
    res.json({ ok: true, productId: license.product_id });
  });

  const machineOf = (body) => {
    const machineId = str(body.machineId, 64);
    if (!/^[a-f0-9]{32,64}$/.test(machineId)) throw new HttpError(400, 'Identifiant de machine invalide.');
    return machineId;
  };

  app.post('/api/licenses/activate', requireVerified, (req, res) => {
    const product = findProduct(req.body.productId);
    res.json({ license: activate(req.user, product, machineOf(req.body), str(req.body.machineName, 60)) });
  });

  app.post('/api/licenses/deactivate', requireUser, (req, res) => {
    const product = findProduct(req.body.productId);
    run('DELETE FROM activations WHERE user_id = ? AND product_id = ? AND machine_id = ?', req.user.id, product.id, machineOf(req.body));
    res.json({ ok: true });
  });

  // Essai gratuit : une seule fois par compte et par plugin, 7 jours. La licence créée est de type "trial" :
  // le plugin la lit comme les autres, mais passe en mode démo (bruit blanc à l'export) tant qu'elle court.
  app.post('/api/licenses/trial', requireVerified, (req, res) => {
    rateLimit(`trial:${req.user.id}`, 10);
    const product = findProduct(req.body.productId);
    if (!product.published) throw new HttpError(404, 'Produit introuvable.');
    if (get('SELECT id FROM licenses WHERE user_id = ? AND product_id = ?', req.user.id, product.id)) {
      throw new HttpError(409, `Vous avez déjà utilisé votre essai de ${product.name}, ou vous possédez déjà ce plugin.`);
    }
    const expiresAt = now() + config.trialDays * 86400_000;
    createLicense({ productId: product.id, userId: req.user.id, type: 'trial', expiresAt, source: 'trial', note: 'Essai gratuit 7 jours' });
    res.status(201).json({ ok: true, productId: product.id, expiresAt });
  });

  app.post('/api/checkout', requireVerified, wrap(async (req, res) => {
    const kind = req.body.kind;
    if (kind === 'product') {
      const product = findProduct(req.body.id);
      if (!product.published) throw new HttpError(404, 'Produit introuvable.');
      const right = entitlement(req.user.id, product.id);
      if (right?.via === 'license') throw new HttpError(409, 'Vous possédez déjà ce plugin.');
      return res.json(await checkout(req.user, 'product', product));
    }
    // Abonnement à la carte : une liste de plugins, au prix du premier plus un supplément par plugin ajouté.
    if (kind === 'pick') {
      const ids = [...new Set((Array.isArray(req.body.productIds) ? req.body.productIds : []).map((id) => int(id, 0)))];
      if (!ids.length || ids.length > 50) throw new HttpError(400, 'Choisissez au moins un plugin.');
      const products = ids.map((id) => get('SELECT * FROM products WHERE id = ? AND published = 1', id));
      if (products.some((p) => !p)) throw new HttpError(404, 'Produit introuvable.');
      const free = products.find((p) => p.price_cents === 0);
      if (free) throw new HttpError(400, `${free.name} est gratuit : inutile de l'ajouter à un abonnement.`);
      const owned = products.find((p) => entitlement(req.user.id, p.id)?.via === 'license' && entitlement(req.user.id, p.id).type !== 'trial');
      if (owned) throw new HttpError(409, `Vous possédez déjà ${owned.name}.`);
      if (activeSubscription(req.user.id)?.valid) throw new HttpError(409, 'Vous avez déjà un abonnement en cours.');
      const plan = pickPlan();
      return res.json(await checkout(req.user, 'plan', {
        id: plan.id, interval: plan.interval, productIds: ids, price_cents: pickPriceCents(ids.length),
        name: `ONIRIQUE à la carte — ${products.map((p) => p.name.replace(/^ONIRIQUE\s+/i, '')).join(', ')}`.slice(0, 120),
      }));
    }
    if (kind === 'plan') {
      const plan = get(`SELECT * FROM plans WHERE id = ? AND active = 1 AND kind = 'all'`, int(req.body.id, 0));
      if (!plan) throw new HttpError(404, 'Formule introuvable.');
      if (activeSubscription(req.user.id)?.valid) throw new HttpError(409, 'Vous avez déjà un abonnement en cours.');
      return res.json(await checkout(req.user, 'plan', plan));
    }
    throw new HttpError(400, 'Achat invalide.');
  }));

  app.post('/api/subscription/cancel', requireUser, wrap(async (req, res) => {
    await cancelSubscription(req.user.id);
    res.json({ ok: true });
  }));

  app.get('/api/download/:versionId', requireUser, (req, res, next) => {
    const version = get('SELECT * FROM versions WHERE id = ?', int(req.params.versionId, 0));
    if (!version) throw new HttpError(404, 'Version introuvable.');
    // L'équipe télécharge tout, un partenaire ses propres plugins ; les autres, ce à quoi ils ont droit.
    const mine = partnerOf(req.user) && get('SELECT creator FROM products WHERE id = ?', version.product_id)?.creator === partnerOf(req.user);
    if (!isStaff(req.user) && !mine && !entitlement(req.user.id, version.product_id)) {
      throw new HttpError(403, 'Ce téléchargement demande une licence active.');
    }
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': version.size, 'X-Checksum-Sha256': version.sha256 });
    fs.createReadStream(path.join(config.filesDir, version.stored_as)).on('error', next).pipe(res);
  });

  //============================================================================
  //  Support : le message part par e-mail vers la boîte de support et reste consultable dans le panel admin
  //============================================================================
  const THREE_YEARS = 3 * 365 * 86400_000; // durée de conservation annoncée dans la politique de confidentialité

  app.post('/api/support', wrap(async (req, res) => {
    const user = optionalUser(req);
    rateLimit(`support:${user ? 'u' + user.id : req.ip}`, user ? 5 : 3);
    if (str(req.body.website, 100)) return res.json({ ok: true }); // champ piège rempli : un robot, on ne dit rien

    const email = user ? user.email : str(req.body.email, 254).toLowerCase();
    const name = user ? user.name : str(req.body.name, 80);
    const subject = str(req.body.subject, 120);
    const message = str(req.body.message, 3500);
    const context = str(req.body.context, 200);
    if (!validEmail(email)) throw new HttpError(400, 'Indiquez une adresse e-mail valide pour recevoir la réponse.');
    if (!subject || message.length < 10) throw new HttpError(400, 'Indiquez un sujet et un message (10 caractères minimum).');
    if (!mailEnabled || !config.supportEmail) throw new HttpError(503, "Le support n'est pas encore ouvert.");

    try {
      await sendMail(config.supportEmail, `[Support] ${subject}`,
        `De : ${name ? name + ' — ' : ''}${email}${user ? ` (compte n° ${user.id})` : ' (visiteur sans compte)'}\n`
        + (context ? `Contexte : ${context}\n` : '') + `\n${message}\n\n—\nRépondre à ce message écrit directement à ${email}.`, email);
    } catch (error) {
      console.error('Envoi du message de support :', error.message);
      throw new HttpError(502, "Le message n'a pas pu être transmis. Réessayez plus tard.");
    }
    run('DELETE FROM support_messages WHERE created_at < ?', now() - THREE_YEARS);
    run('INSERT INTO support_messages (user_id, email, name, subject, message, context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      user?.id ?? null, email, name, subject, message, context, now());
    res.json({ ok: true });
  }));

  //============================================================================
  //  Mot de passe oublié
  //============================================================================
  app.post('/api/auth/forgot', (req, res) => {
    const email = str(req.body.email, 254).toLowerCase();
    if (!validEmail(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
    rateLimit(`forgot:${req.ip}`, 5);
    rateLimit(`forgot:${email}`, 3);
    if (!mailEnabled) throw new HttpError(503, 'Réinitialisation indisponible pour le moment. Contactez le support.');

    const user = get('SELECT * FROM users WHERE email = ?', email);
    if (user) {
      const link = `${config.siteUrl}/compte?reset=${createResetToken(user.id)}`;
      // Pas d'attente : la réponse ne doit ni tarder ni changer selon que le compte existe.
      sendMail(user.email, 'Réinitialiser votre mot de passe ONIRIQUE',
        `Bonjour,\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable une heure) :\n\n${link}\n\n`
        + "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe ne change pas.\n\nONIRIQUE")
        .catch((error) => console.error('Envoi du lien de réinitialisation :', error.message));
    }
    res.json({ ok: true });
  });

  app.post('/api/auth/reset', (req, res) => {
    rateLimit(`reset:${req.ip}`, 10);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Mot de passe : 8 caractères minimum.');
    const userId = transaction(() => {
      const id = consumeResetToken(req.body.token);
      if (!id) return null;
      run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), id);
      run('DELETE FROM sessions WHERE user_id = ?', id);
      return id;
    });
    if (!userId) throw new HttpError(400, 'Lien invalide ou expiré. Refaites une demande.');
    res.json({ ok: true });
  });

  //============================================================================
  //  Administration
  //============================================================================
  const admin = express.Router();
  admin.use(requireAdmin);
  // Un partenaire n'a que ses plugins, leurs versions et leurs licences : le reste du panel lui est fermé.
  admin.use((req, _res, next) => next(req.creator && !/^\/(products|versions|licenses|payments)(\/|$)/.test(req.path)
    ? new HttpError(403, 'Réservé aux administrateurs.') : undefined));

  const CREATORS = ['onirique', ...PARTNERS];

  // Paiements : un compte Stripe par créateur. Un partenaire branche le sien ; seul un fondateur branche celui
  // d'ONIRIQUE ou d'un autre, et ouvre ou ferme la vente. Les clés ne ressortent jamais du serveur.
  const mayConnect = (req, creator) => req.user.role === 'founder' || req.user.role === creator;
  const paymentCreator = (req) => {
    const creator = String(req.params.creator);
    if (!CREATORS.includes(creator) || (req.creator && creator !== req.creator)) throw new HttpError(404, 'Créateur introuvable.');
    if (!mayConnect(req, creator)) throw new HttpError(403, 'Seul un fondateur ou le partenaire concerné peut régler ce compte.');
    return creator;
  };
  admin.get('/payments', (req, res) => {
    res.json({
      mode: paymentsMode(), open: !!setting('payments_open', false), fixed: config.paymentsMode !== 'off', founder: req.user.role === 'founder',
      accounts: CREATORS.filter((c) => !req.creator || c === req.creator).map((c) => ({ ...stripeAccountView(c), editable: mayConnect(req, c) })),
    });
  });
  admin.put('/payments/open', (req, res) => {
    if (req.user.role !== 'founder') throw new HttpError(403, 'Seul un fondateur ouvre ou ferme la vente.');
    setSetting('payments_open', req.body.open === true);
    res.json({ ok: true, mode: paymentsMode() });
  });
  admin.put('/payments/:creator', wrap(async (req, res) => {
    const creator = paymentCreator(req);
    await connectStripe(creator, str(req.body.secretKey, 300), req.body.managed !== false);
    res.json(stripeAccountView(creator));
  }));
  admin.delete('/payments/:creator', wrap(async (req, res) => {
    const creator = paymentCreator(req);
    await disconnectStripe(creator);
    res.json(stripeAccountView(creator));
  }));
  /** Le produit, s'il est du ressort de ce compte : un partenaire ne touche qu'aux plugins de son créateur. */
  function ownProduct(req, id) {
    const product = findProduct(id);
    if (req.creator && product.creator !== req.creator) throw new HttpError(404, 'Produit introuvable.');
    return product;
  }
  /** La licence, si son plugin est du ressort de ce compte. */
  function ownLicense(req, id) {
    const license = get('SELECT * FROM licenses WHERE id = ?', int(id, 0));
    if (!license || (req.creator && findProduct(license.product_id).creator !== req.creator)) throw new HttpError(404, 'Licence introuvable.');
    return license;
  }

  // Crédits. À la création, le titre et la pochette sont demandés à Spotify (oEmbed) ; la pochette est copiée
  // sur le serveur, pour que la page d'accueil ne charge rien chez un tiers.
  async function spotifyInfo(trackId) {
    try {
      const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${trackId}`)}`,
        { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return {};
      const info = await response.json();
      let cover = null;
      const image = new URL(String(info.thumbnail_url || ''));
      // Seuls les serveurs d'images de Spotify sont contactés.
      if (image.protocol === 'https:' && /(^|\.)(scdn\.co|spotifycdn\.com)$/.test(image.hostname)) {
        const picture = await fetch(image, { signal: AbortSignal.timeout(8000) });
        const bytes = Buffer.from(await picture.arrayBuffer());
        if (picture.ok && bytes.length > 0 && bytes.length < 3 * 1024 * 1024) {
          cover = `${crypto.randomBytes(16).toString('hex')}.jpg`;
          fs.writeFileSync(path.join(config.mediaDir, cover), bytes);
        }
      }
      return { title: str(info.title, 120), cover };
    } catch {
      return {}; // Spotify injoignable : le crédit est créé sans pochette, avec le titre saisi
    }
  }

  admin.get('/credits', (_req, res) => res.json(creditRows()));

  admin.post('/credits', wrap(async (req, res) => {
    const trackId = str(req.body.spotifyUrl, 300).match(/(?:track[/:])([A-Za-z0-9]{22})/)?.[1];
    if (!trackId) throw new HttpError(400, 'Lien Spotify invalide : collez le lien d\'un titre (open.spotify.com/track/…).');
    const artist = str(req.body.artist, 120);
    if (!artist) throw new HttpError(400, "Indiquez l'artiste.");
    const productId = req.body.productId ? findProduct(req.body.productId).id : null;

    const info = await spotifyInfo(trackId);
    const title = str(req.body.title, 120) || info.title;
    if (!title) {
      if (info.cover) fs.rmSync(path.join(config.mediaDir, info.cover), { force: true });
      throw new HttpError(400, 'Indiquez le titre du morceau.');
    }
    run(`INSERT INTO credits (title, artist, kind, released, duration, spotify_id, cover, product_id, used_on, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      title, artist, str(req.body.kind, 30) || 'Single', str(req.body.released, 40), str(req.body.duration, 10),
      trackId, info.cover ?? null, productId, str(req.body.usedOn, 60), now());
    res.status(201).json(creditRows()[0]);
  }));

  // Modification d'un crédit : seuls les champs envoyés changent. Un nouveau lien Spotify fait reprendre la pochette.
  admin.patch('/credits/:id', wrap(async (req, res) => {
    const credit = get('SELECT * FROM credits WHERE id = ?', int(req.params.id, 0));
    if (!credit) throw new HttpError(404, 'Crédit introuvable.');
    const b = req.body;
    const next = {
      title: b.title === undefined ? credit.title : str(b.title, 120),
      artist: b.artist === undefined ? credit.artist : str(b.artist, 120),
      kind: b.kind === undefined ? credit.kind : str(b.kind, 30) || 'Single',
      released: b.released === undefined ? credit.released : str(b.released, 40),
      duration: b.duration === undefined ? credit.duration : str(b.duration, 10),
      usedOn: b.usedOn === undefined ? credit.used_on : str(b.usedOn, 60),
      productId: b.productId === undefined ? credit.product_id : b.productId ? findProduct(b.productId).id : null,
      spotifyId: credit.spotify_id,
      cover: credit.cover,
    };
    if (!next.title) throw new HttpError(400, 'Indiquez le titre du morceau.');
    if (!next.artist) throw new HttpError(400, "Indiquez l'artiste.");
    if (b.spotifyUrl !== undefined) {
      const trackId = str(b.spotifyUrl, 300).match(/(?:track[/:])([A-Za-z0-9]{22})/)?.[1];
      if (!trackId) throw new HttpError(400, 'Lien Spotify invalide : collez le lien d\'un titre (open.spotify.com/track/…).');
      if (trackId !== credit.spotify_id) {
        next.spotifyId = trackId;
        next.cover = (await spotifyInfo(trackId)).cover ?? null;
      }
    }
    run(`UPDATE credits SET title = ?, artist = ?, kind = ?, released = ?, duration = ?, used_on = ?, product_id = ?, spotify_id = ?, cover = ? WHERE id = ?`,
      next.title, next.artist, next.kind, next.released, next.duration, next.usedOn, next.productId, next.spotifyId, next.cover, credit.id);
    if (credit.cover && credit.cover !== next.cover) fs.rmSync(path.join(config.mediaDir, credit.cover), { force: true });
    res.json(creditRows().find((c) => c.id === credit.id));
  }));

  admin.delete('/credits/:id', (req, res) => {
    const credit = get('SELECT * FROM credits WHERE id = ?', int(req.params.id, 0));
    if (!credit) throw new HttpError(404, 'Crédit introuvable.');
    run('DELETE FROM credits WHERE id = ?', credit.id);
    if (credit.cover) fs.rmSync(path.join(config.mediaDir, credit.cover), { force: true });
    res.json({ ok: true });
  });

  admin.get('/support', (_req, res) => {
    res.json({
      mailbox: config.supportEmail,
      messages: all(`SELECT id, user_id AS userId, email, name, subject, message, context, created_at AS createdAt
                     FROM support_messages ORDER BY created_at DESC LIMIT 200`),
    });
  });

  admin.delete('/support/:id', (req, res) => {
    const { changes } = run('DELETE FROM support_messages WHERE id = ?', int(req.params.id, 0));
    if (!changes) throw new HttpError(404, 'Message introuvable.');
    res.json({ ok: true });
  });

  admin.get('/overview', (_req, res) => {
    const count = (sql, ...params) => get(sql, ...params).n;
    res.json({
      users: count('SELECT COUNT(*) AS n FROM users'),
      licenses: count(`SELECT COUNT(*) AS n FROM licenses WHERE status = 'active'`),
      unclaimed: count(`SELECT COUNT(*) AS n FROM licenses WHERE status = 'active' AND user_id IS NULL`),
      subscribers: count(`SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'active' AND current_period_end > ?`, now()),
      activations: count('SELECT COUNT(*) AS n FROM activations'),
      revenueCents: count(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM orders WHERE provider IN ('stripe', 'lemon')`),
      supportMessages: count('SELECT COUNT(*) AS n FROM support_messages'),
      paymentsMode: paymentsMode(),
    });
  });

  // Produits
  // Le panel admin voit en plus, pour chaque version et pour la version actuelle de chaque système, si le plugin
  // embarque le module de licence (licensed : true, false, ou null pour un installateur qu'on ne peut pas lire).
  admin.get('/products', (req, res) => res.json(all('SELECT * FROM products WHERE ? IS NULL OR creator = ? ORDER BY created_at', req.creator, req.creator).map((p) => {
    const view = productView(p);
    const rows = productVersions(p.id);
    const current = (platform) => { const v = rows.find((row) => row.platform === platform); return v ? versionLicensed(v) : undefined; };
    return {
      ...view,
      versions: view.versions.map((v, i) => ({ ...v, licensed: versionLicensed(rows[i]) })),
      licensed: { win: current('win'), mac: current('mac') },
    };
  })));

  function productFields(body, existing = {}) {
    const name = body.name !== undefined ? str(body.name, 60) : existing.name;
    if (!name) throw new HttpError(400, 'Le nom est obligatoire.');
    const accent = body.accent !== undefined ? str(body.accent, 7) : existing.accent ?? '#e23444';
    if (!/^#[0-9a-fA-F]{6}$/.test(accent)) throw new HttpError(400, 'Couleur invalide (format #rrggbb).');
    const price = body.priceCents !== undefined ? int(body.priceCents) : existing.price_cents ?? 0;
    if (price === null || price < 0 || price > 10_000_00) throw new HttpError(400, 'Prix invalide.');
    if (body.creator !== undefined && !CREATORS.includes(body.creator)) throw new HttpError(400, 'Créateur invalide.');
    return {
      name, accent, price,
      creator: body.creator ?? existing.creator ?? 'onirique',
      tagline: body.tagline !== undefined ? str(body.tagline, 140) : existing.tagline ?? '',
      description: body.description !== undefined ? str(body.description, 4000) : existing.description ?? '',
      published: body.published !== undefined ? (body.published ? 1 : 0) : existing.published ?? 1,
    };
  }

  admin.post('/products', (req, res) => {
    const f = productFields(req.body);
    const slug = (str(req.body.slug, 40) || f.name).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) throw new HttpError(400, 'Identifiant invalide.');
    if (get('SELECT id FROM products WHERE slug = ?', slug)) throw new HttpError(409, 'Un produit porte déjà cet identifiant.');
    // Un partenaire ne crée que des plugins à son nom.
    const { lastInsertRowid } = run(
      'INSERT INTO products (slug, name, tagline, description, accent, price_cents, published, created_at, creator) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      slug, f.name, f.tagline, f.description, f.accent, f.price, f.published, now(), req.creator ?? f.creator);
    res.status(201).json(productView(findProduct(lastInsertRowid)));
  });

  admin.patch('/products/:id', (req, res) => {
    const product = ownProduct(req, req.params.id);
    const f = productFields(req.body, product);
    run('UPDATE products SET name = ?, tagline = ?, description = ?, accent = ?, price_cents = ?, published = ?, creator = ? WHERE id = ?',
      f.name, f.tagline, f.description, f.accent, f.price, f.published, req.creator ?? f.creator, product.id);
    res.json(productView(findProduct(product.id)));
  });

  admin.put('/products/:id/image', wrap(async (req, res) => {
    const product = ownProduct(req, req.params.id);
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[req.headers['content-type']];
    if (!ext) throw new HttpError(400, 'Image attendue : PNG, JPEG ou WebP.');
    const file = await receiveFile(req, config.mediaDir, 8 * 1024 * 1024);
    const name = `${file.storedAs}.${ext}`;
    fs.renameSync(path.join(config.mediaDir, file.storedAs), path.join(config.mediaDir, name));
    if (product.image) fs.rmSync(path.join(config.mediaDir, product.image), { force: true });
    run('UPDATE products SET image = ? WHERE id = ?', name, product.id);
    res.json(productView(findProduct(product.id)));
  }));

  // Démo interactive : le fichier demo.json produit par onirique-probe à partir du .vst3.
  admin.put('/products/:id/demo', wrap(async (req, res) => {
    const product = ownProduct(req, req.params.id);
    const file = await receiveFile(req, config.mediaDir, 80 * 1024 * 1024);
    const stored = path.join(config.mediaDir, file.storedAs);
    let valid = false;
    try {
      const demo = JSON.parse(fs.readFileSync(stored, 'utf8'));
      valid = demo.format === 'onirique-demo-v1' && Array.isArray(demo.controls) && typeof demo.base === 'string';
    } catch { /* pas du JSON */ }
    if (!valid) {
      fs.rmSync(stored, { force: true });
      throw new HttpError(400, 'Fichier de démo invalide.');
    }
    const name = `${file.storedAs}.json`;
    fs.renameSync(stored, path.join(config.mediaDir, name));
    if (product.demo) fs.rmSync(path.join(config.mediaDir, product.demo), { force: true });
    run('UPDATE products SET demo = ? WHERE id = ?', name, product.id);
    res.json(productView(findProduct(product.id)));
  }));

  // Versions : le fichier est le corps brut de la requête.
  admin.post('/products/:id/versions', wrap(async (req, res) => {
    const product = ownProduct(req, req.params.id);
    const version = str(req.query.version, 30);
    if (!/^\d+(\.\d+){0,3}([\-+][0-9A-Za-z.]+)?$/.test(version)) throw new HttpError(400, 'Numéro de version invalide (ex. 1.2.0).');
    const filename = safeFilename(req.query.filename);
    const platform = platformOf(req.query.platform);
    // Sur Mac, un plugin est un dossier : il s'envoie en .zip (ou en installateur .pkg).
    const accepted = platform === 'mac' ? /\.(zip|pkg)$/i : /\.(vst3|zip|exe|msi)$/i;
    if (!accepted.test(filename)) throw new HttpError(400, platform === 'mac' ? 'Fichier attendu pour Mac : .zip ou .pkg.' : 'Fichier attendu : .vst3, .zip, .exe ou .msi.');
    if (get('SELECT id FROM versions WHERE product_id = ? AND version = ? AND platform = ?', product.id, version, platform)) {
      throw new HttpError(409, `La version ${version} existe déjà pour ${product.name} (${platform === 'mac' ? 'Mac' : 'Windows'}).`);
    }
    const file = await receiveFile(req, config.filesDir, 2 * 1024 ** 3);
    const stored = path.join(config.filesDir, file.storedAs);
    if (product.price_cents > 0 && embedsLicenseKey(fs.readFileSync(stored), filename, publicKeyPem) === false) {
      fs.rmSync(stored, { force: true });
      throw new HttpError(400, MISSING_LICENSE);
    }
    const { lastInsertRowid } = run(
      'INSERT INTO versions (product_id, version, notes, filename, stored_as, size, sha256, created_at, platform) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      product.id, version, str(req.query.notes, 4000), filename, file.storedAs, file.size, file.sha256, now(), platform);
    res.status(201).json(versionView(get('SELECT * FROM versions WHERE id = ?', lastInsertRowid)));
  }));

  /** La version, si son plugin est du ressort de ce compte. */
  function ownVersion(req) {
    const version = get('SELECT * FROM versions WHERE id = ?', int(req.params.id, 0));
    if (!version || (req.creator && findProduct(version.product_id).creator !== req.creator)) throw new HttpError(404, 'Version introuvable.');
    return version;
  }

  admin.patch('/versions/:id', (req, res) => {
    run('UPDATE versions SET notes = ? WHERE id = ?', str(req.body.notes, 4000), ownVersion(req).id);
    res.json({ ok: true });
  });

  admin.delete('/versions/:id', (req, res) => {
    const version = ownVersion(req);
    run('DELETE FROM versions WHERE id = ?', version.id);
    fs.rmSync(path.join(config.filesDir, version.stored_as), { force: true });
    res.json({ ok: true });
  });

  // Licences
  admin.get('/licenses', (req, res) => {
    const q = `%${str(req.query.q, 80)}%`;
    const rows = all(
      `SELECT l.*, p.name AS product_name, u.email,
         (SELECT COUNT(*) FROM activations a WHERE a.user_id = l.user_id AND a.product_id = l.product_id) AS activations
       FROM licenses l JOIN products p ON p.id = l.product_id LEFT JOIN users u ON u.id = l.user_id
       WHERE (? IS NULL OR p.creator = ?)
         AND (l.key LIKE ? OR u.email LIKE ? OR l.reserved_email LIKE ? OR l.note LIKE ? OR p.name LIKE ? OR l.bundle LIKE ?)
       ORDER BY l.created_at DESC, l.id DESC LIMIT 500`, req.creator, req.creator, q, q, q, q, q, q);
    res.json(rows.map(licenseView));
  });

  const LICENSE_TYPES = ['perpetual', 'timed', 'nfr'];
  function expiry(value) {
    if (value === null || value === undefined || value === '') return null;
    const time = int(value);
    if (time === null || time < 0) throw new HttpError(400, "Date d'expiration invalide.");
    return time;
  }
  function activationLimit(value) {
    const limit = int(value, config.defaultMaxActivations);
    if (limit < 1 || limit > 50) throw new HttpError(400, 'Nombre de machines : entre 1 et 50.');
    return limit;
  }
  /** Rattache à un compte existant, sinon réserve la clé pour cette adresse. */
  function owner(email) {
    if (!email) return { userId: null, reservedEmail: null };
    if (!validEmail(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
    const user = get('SELECT id FROM users WHERE email = ?', email);
    return user ? { userId: user.id, reservedEmail: null } : { userId: null, reservedEmail: email };
  }

  admin.post('/licenses', (req, res) => {
    // "all" : ALL LICENCE, une seule clé qui donne une licence pour chaque plugin existant à cet instant
    // (pour un partenaire : chacun de ses plugins).
    const everything = req.body.productId === 'all';
    const products = everything
      ? all('SELECT * FROM products WHERE ? IS NULL OR creator = ? ORDER BY created_at', req.creator, req.creator)
      : [ownProduct(req, req.body.productId)];
    if (!products.length) throw new HttpError(400, 'Aucun plugin à mettre dans la licence.');
    const type = LICENSE_TYPES.includes(req.body.type) ? req.body.type : 'perpetual';
    const count = int(req.body.count, 1);
    if (count < 1 || count > 200) throw new HttpError(400, 'Entre 1 et 200 licences à la fois.');
    const expiresAt = expiry(req.body.expiresAt);
    if (type === 'timed' && !expiresAt) throw new HttpError(400, "Une licence à durée limitée demande une date d'expiration.");
    const target = owner(str(req.body.email, 254).toLowerCase());
    if (target.userId && count > 1) throw new HttpError(400, 'Une seule licence par compte et par génération.');

    const maxActivations = activationLimit(req.body.maxActivations);
    const note = str(req.body.note, 200);
    const created = transaction(() => Array.from({ length: count }, () => {
      const bundle = everything ? generateKey() : null;
      const made = products.map((product) => ({
        ...createLicense({ productId: product.id, ...target, type, expiresAt, maxActivations, source: 'admin', note, bundle }),
        product_name: product.name,
      }));
      // Pour un pack, c'est sa clé qui est rendue : elle seule est à transmettre.
      return everything ? { ...made[0], id: null, key: bundle, product_id: null, product_name: `ALL LICENCE · ${products.length} plugins` } : made[0];
    }));
    res.status(201).json(created.map(licenseView));
  });

  admin.patch('/licenses/:id', (req, res) => {
    const license = ownLicense(req, req.params.id);
    const b = req.body;
    const next = {
      status: b.status !== undefined ? b.status : license.status,
      type: b.type !== undefined ? b.type : license.type,
      expiresAt: b.expiresAt !== undefined ? expiry(b.expiresAt) : license.expires_at,
      maxActivations: b.maxActivations !== undefined ? activationLimit(b.maxActivations) : license.max_activations,
      note: b.note !== undefined ? str(b.note, 200) : license.note,
      userId: license.user_id,
      reservedEmail: license.reserved_email,
    };
    if (!['active', 'revoked'].includes(next.status)) throw new HttpError(400, 'Statut invalide.');
    if (!LICENSE_TYPES.includes(next.type)) throw new HttpError(400, 'Type invalide.');
    if (b.email !== undefined) Object.assign(next, owner(str(b.email, 254).toLowerCase()));

    transaction(() => {
      run(`UPDATE licenses SET status = ?, type = ?, expires_at = ?, max_activations = ?, note = ?, user_id = ?, reserved_email = ? WHERE id = ?`,
        next.status, next.type, next.expiresAt, next.maxActivations, next.note, next.userId, next.reservedEmail, license.id);
      // Une licence retirée à un compte emporte ses activations si plus rien ne les justifie.
      for (const userId of new Set([license.user_id, next.userId])) {
        if (userId && !entitlement(userId, license.product_id)) {
          run('DELETE FROM activations WHERE user_id = ? AND product_id = ?', userId, license.product_id);
        }
      }
    });
    res.json({ ok: true });
  });

  admin.post('/licenses/:id/reset', (req, res) => {
    const license = ownLicense(req, req.params.id);
    if (license.user_id) run('DELETE FROM activations WHERE user_id = ? AND product_id = ?', license.user_id, license.product_id);
    res.json({ ok: true });
  });

  admin.delete('/licenses/:id', (req, res) => {
    const license = ownLicense(req, req.params.id);
    if (license.user_id) throw new HttpError(409, 'Licence déjà rattachée à un compte : révoquez-la plutôt.');
    run('DELETE FROM licenses WHERE id = ?', license.id);
    res.json({ ok: true });
  });

  // Utilisateurs et formules
  admin.get('/users', (req, res) => {
    const q = `%${str(req.query.q, 80)}%`;
    res.json(all(
      `SELECT u.id, u.email, u.name, u.role, u.created_at AS createdAt, u.email_verified AS emailVerified,
         (SELECT COUNT(*) FROM licenses l WHERE l.user_id = u.id AND l.status = 'active') AS licenses,
         (SELECT COUNT(*) FROM licenses l WHERE l.user_id = u.id AND l.source = 'trial') AS trials,
         EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND s.current_period_end > ?) AS subscribed
       FROM users u WHERE u.email LIKE ? OR u.name LIKE ? ORDER BY u.created_at DESC LIMIT 500`, now(), q, q));
  });

  admin.patch('/users/:id', (req, res) => {
    const user = get('SELECT * FROM users WHERE id = ?', int(req.params.id, 0));
    if (!user) throw new HttpError(404, 'Compte introuvable.');
    // Seul un fondateur touche à un compte admin ou fondateur : son rôle comme son mot de passe.
    const founder = req.user.role === 'founder';
    if (req.body.role !== undefined && req.body.role !== user.role) {
      if (!ROLES.includes(req.body.role)) throw new HttpError(400, 'Rôle invalide.');
      if (user.id === req.user.id) throw new HttpError(400, 'Vous ne pouvez pas changer votre propre rôle.');
      if (!founder && (isStaff(user) || isStaff({ role: req.body.role }))) {
        throw new HttpError(403, 'Seul un fondateur peut donner ou retirer le rôle admin.');
      }
      run('UPDATE users SET role = ? WHERE id = ?', req.body.role, user.id);
    }
    // Valider une adresse à la main, pour un compte dont le lien n'arrive pas.
    if (req.body.emailVerified === true && !user.email_verified) {
      transaction(() => {
        run('UPDATE users SET email_verified = 1 WHERE id = ?', user.id);
        run('DELETE FROM email_verifications WHERE user_id = ?', user.id);
        claimReserved(user);
      });
    }
    if (req.body.password !== undefined) {
      if (!founder && isStaff(user) && user.id !== req.user.id) {
        throw new HttpError(403, "Seul un fondateur peut changer le mot de passe d'un administrateur.");
      }
      const password = String(req.body.password);
      if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Mot de passe : 8 caractères minimum.');
      run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), user.id);
      run('DELETE FROM sessions WHERE user_id = ?', user.id);
    }
    res.json({ ok: true });
  });

  // Rend ses essais gratuits à un compte : les licences d'essai sont retirées, expirées ou non, et avec elles
  // les activations que plus rien ne justifie. Le compte peut alors relancer un essai de chaque plugin.
  admin.post('/users/:id/reset-trials', (req, res) => {
    const user = get('SELECT * FROM users WHERE id = ?', int(req.params.id, 0));
    if (!user) throw new HttpError(404, 'Compte introuvable.');
    const removed = transaction(() => {
      const trials = all(`SELECT id, product_id FROM licenses WHERE user_id = ? AND source = 'trial'`, user.id);
      run(`DELETE FROM licenses WHERE user_id = ? AND source = 'trial'`, user.id);
      for (const productId of new Set(trials.map((t) => t.product_id))) {
        if (!entitlement(user.id, productId)) run('DELETE FROM activations WHERE user_id = ? AND product_id = ?', user.id, productId);
      }
      return trials.length;
    });
    res.json({ ok: true, removed });
  });

  admin.get('/plans', (_req, res) => res.json(all('SELECT * FROM plans ORDER BY price_cents').map(planView)));

  // Abonnement à la carte : le prix du premier plugin et de chaque plugin ajouté, par mois.
  admin.get('/pick', (_req, res) => res.json(pickPrices()));
  admin.patch('/pick', (req, res) => {
    const baseCents = int(req.body.baseCents), extraCents = int(req.body.extraCents);
    if (baseCents === null || extraCents === null || baseCents < 0 || extraCents < 0 || baseCents > 1_000_00 || extraCents > 1_000_00) {
      throw new HttpError(400, 'Prix invalide.');
    }
    transaction(() => {
      setSetting('pickBaseCents', baseCents);
      setSetting('pickExtraCents', extraCents);
      // La formule à la carte porte le prix du premier plugin.
      run(`UPDATE plans SET price_cents = ? WHERE kind = 'pick'`, baseCents);
    });
    res.json(pickPrices());
  });

  admin.patch('/plans/:id', (req, res) => {
    const plan = get('SELECT * FROM plans WHERE id = ?', int(req.params.id, 0));
    if (!plan) throw new HttpError(404, 'Formule introuvable.');
    const price = req.body.priceCents !== undefined ? int(req.body.priceCents) : plan.price_cents;
    if (price === null || price < 0) throw new HttpError(400, 'Prix invalide.');
    run('UPDATE plans SET name = ?, price_cents = ?, active = ? WHERE id = ?',
      req.body.name !== undefined ? str(req.body.name, 60) || plan.name : plan.name, price,
      req.body.active !== undefined ? (req.body.active ? 1 : 0) : plan.active, plan.id);
    res.json({ ok: true });
  });

  app.use('/api/admin', admin);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Introuvable.')));

  app.use((error, _req, res, _next) => {
    const status = error.status || (error.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500 && !error.status) console.error(error);
    if (res.headersSent) return res.destroy();
    res.status(status).json({ error: status >= 500 && !error.status ? 'Erreur interne du serveur.' : error.message });
  });

  return app;
}
