// La vente des prods d'un pack, façon BeatStars. Chaque beatmaker branche son propre compte Stripe ou PayPal (clés
// chiffrées), règle ses licences (MP3, WAV, Track stems, Exclusive…) et dépose les fichiers livrés avec chaque prod.
// L'acheteur choisit une licence sur la page d'écoute et paie chez le prestataire. Un paiement Stripe n'est confirmé que
// par le webhook signé du compte du beatmaker ; un paiement PayPal est encaissé (capture) par le serveur, au retour de
// l'acheteur, depuis le panneau du beatmaker ou toutes les cinq minutes. Puis la commande est livrée : liens de
// téléchargement des fichiers de la licence et contrat de licence, par la page d'achat et par e-mail.
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { get, all, run, now, transaction } from './db.js';
import { HttpError, rateLimit, optionalUser } from './auth.js';
import { sendMail } from './mail.js';
import { seal, unseal, verifyStripeSignature } from './payments.js';
import { contactsOf, listContacts } from './packsend.js';

export const FILE_KINDS = { mp3: 'MP3', wav: 'WAV', stems: 'Track stems (ZIP)' };
const MAX_FILE = { mp3: 100 * 1024 * 1024, wav: 500 * 1024 * 1024, stems: 2 * 1024 ** 3 };
const DEFAULT_LICENSES = [
  { name: 'MP3', price: 2999, files: ['mp3'], terms: "Licence non exclusive. Un titre commercial, jusqu'à 50 000 écoutes en streaming et 2 000 ventes ou téléchargements, un clip vidéo. Mention obligatoire « Prod. by » suivie du nom du beatmaker. Le beatmaker reste propriétaire de la prod et peut la vendre à d'autres artistes." },
  { name: 'WAV', price: 4999, files: ['mp3', 'wav'], terms: "Licence non exclusive. Un titre commercial, jusqu'à 250 000 écoutes en streaming et 5 000 ventes ou téléchargements, clips vidéo illimités. Mention obligatoire « Prod. by » suivie du nom du beatmaker. Le beatmaker reste propriétaire de la prod et peut la vendre à d'autres artistes." },
  { name: 'Track stems', price: 9999, files: ['mp3', 'wav', 'stems'], terms: "Licence non exclusive avec les pistes séparées pour le mixage. Un titre commercial, écoutes en streaming et ventes illimitées, clips vidéo et concerts. Mention obligatoire « Prod. by » suivie du nom du beatmaker. Le beatmaker reste propriétaire de la prod et peut la vendre à d'autres artistes." },
  { name: 'Exclusive', price: 49999, files: ['mp3', 'wav', 'stems'], exclusive: true, terms: "Licence exclusive : la prod est retirée de la vente dès l'achat et ne sera plus vendue à personne. Exploitation commerciale illimitée. Mention obligatoire « Prod. by » suivie du nom du beatmaker. Les licences non exclusives vendues avant cet achat restent valables." },
];

const str = (value, max = 200) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const id = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0);
const euros = (cents) => (cents / 100).toFixed(2);
const eurosFr = (cents) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const parse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };

//------------------------------------------------------------------------------ Licences et compte de paiement
/** Les licences d'un beatmaker ; les quatre licences de départ sont créées la première fois. */
export function licensesOf(userId) {
  if (!get('SELECT 1 AS x FROM sound_sellers WHERE user_id = ?', userId)) transaction(() => {
    run('INSERT INTO sound_sellers (user_id, updated_at) VALUES (?, ?)', userId, now());
    DEFAULT_LICENSES.forEach((l, i) => run('INSERT INTO sound_licenses (user_id, name, price, files, terms, exclusive, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      userId, l.name, l.price, JSON.stringify(l.files), l.terms, l.exclusive ? 1 : 0, i, now()));
  });
  return all('SELECT * FROM sound_licenses WHERE user_id = ? ORDER BY position, id', userId).map(licenseView);
}
const licenseView = (l) => ({ id: l.id, name: l.name, price: l.price, files: parse(l.files, []), terms: l.terms, exclusive: !!l.exclusive });
const sellerRow = (userId) => get('SELECT * FROM sound_sellers WHERE user_id = ?', userId);
export const connectAvailable = () => !!(config.stripeConnectClientId && config.stripeConnectSecretKey);
const hasStripe = (s) => !!(s && s.provider === 'stripe' && (s.secret || (s.connect_account && connectAvailable())));
/** Les comptes de paiement tels que le beatmaker les voit (Stripe et PayPal, branchés ensemble ou non) : jamais leurs secrets. */
export function sellerView(userId) {
  const s = sellerRow(userId), stripe = hasStripe(s), paypal = !!s?.paypal_secret;
  return { connected: stripe || paypal, connectAvailable: connectAvailable(),
    stripe: stripe ? { sandbox: !!s.sandbox, account: s.account, connect: !!s.connect_account, webhook: !!(s.webhook_secret || s.connect_account) } : null,
    paypal: paypal ? { sandbox: !!s.paypal_sandbox, clientId: s.paypal_client_id } : null };
}
/** Les moyens de paiement qu'un acheteur peut choisir chez ce beatmaker, Stripe (carte) d'abord. */
export function payMethods(userId) {
  const v = sellerView(userId);
  return [v.stripe && 'stripe', v.paypal && 'paypal'].filter(Boolean);
}

// account : un compte branché par « Se connecter avec Stripe », au nom duquel la plateforme ONIRIQUE parle (Stripe Connect).
async function stripeCall(key, method, route, params, account = '') {
  const response = await fetch(`https://api.stripe.com/v1${route}`, {
    method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded', ...(account ? { 'Stripe-Account': account } : {}) },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(502, `Stripe : ${json.error?.message || response.status}`);
  return json;
}
const paypalBase = (sandbox) => (sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com');
async function paypalCall(seller, method, route, body) {
  const auth = await fetch(`${paypalBase(seller.sandbox)}/v1/oauth2/token`, {
    method: 'POST', body: 'grant_type=client_credentials',
    headers: { Authorization: `Basic ${Buffer.from(`${seller.clientId}:${seller.secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const token = await auth.json().catch(() => ({}));
  if (!auth.ok || !token.access_token) throw new HttpError(502, 'PayPal refuse ces identifiants : vérifie le Client ID, le secret et le mode (sandbox ou réel).');
  if (!route) return null;
  const response = await fetch(paypalBase(seller.sandbox) + route, {
    method, headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(502, `PayPal : ${json.message || json.details?.[0]?.description || response.status}`);
  return json;
}
// Le webhook créé chez Stripe pour un beatmaker est retiré quand il change de compte ou se débranche.
async function dropHook(userId) {
  const s = sellerRow(userId);
  if (s?.webhook_id && s.secret && s.provider === 'stripe') await stripeCall(unseal(s.secret), 'DELETE', `/webhook_endpoints/${s.webhook_id}`).catch(() => {});
  run(`UPDATE sound_sellers SET webhook_secret = NULL, webhook_id = '' WHERE user_id = ?`, userId);
}
// Le compte d'un beatmaker avec sa clé en clair, pour parler au prestataire ; null s'il n'est pas branché.
function sellerKeys(userId, provider) {
  const s = sellerRow(userId);
  if (provider === 'paypal') return s?.paypal_secret ? { provider, clientId: s.paypal_client_id, secret: unseal(s.paypal_secret), sandbox: !!s.paypal_sandbox } : null;
  if (s?.connect_account && s.provider === 'stripe') return connectAvailable() ? { provider: 'stripe', secret: config.stripeConnectSecretKey, account: s.connect_account, sandbox: !!s.sandbox } : null;
  return s?.secret && s.provider === 'stripe' ? { provider: 'stripe', secret: unseal(s.secret), sandbox: !!s.sandbox } : null;
}

//------------------------------------------------------------------------------ Fichiers livrés et offres
// Le fichier d'une prod pour un format : celui déposé par le beatmaker, sinon la version écoutée si elle est déjà
// dans ce format (un WAV envoyé sert de WAV, un MP3 de MP3).
function fileFor(trackId, kind) {
  const d = get('SELECT * FROM sound_deliverables WHERE track_id = ? AND kind = ?', trackId, kind);
  if (d) return d;
  if (kind === 'stems') return null;
  return get(`SELECT v.filename, v.stored_as, v.mime, v.size FROM sound_tracks t JOIN sound_versions v ON v.id = t.current_id
    WHERE t.id = ? AND v.mime = ?`, trackId, kind === 'wav' ? 'audio/wav' : 'audio/mpeg') || null;
}
/** Les fichiers d'une prod, par format : { mp3: { filename, size, auto } }. */
export function filesOf(trackId) {
  return Object.fromEntries(Object.keys(FILE_KINDS).map((k) => [k, fileFor(trackId, k)]).filter(([, f]) => f)
    .map(([k, f]) => [k, { filename: f.filename, size: f.size, auto: !f.kind }]));
}
/**
 * Les licences qu'on peut acheter pour une prod : en vente, pas vendue en exclusivité, tous leurs fichiers présents, au
 * prix réglé pour cette prod s'il y en a un (0 : licence pas proposée pour elle).
 */
export function offersOf(track, sellerId, simulate = false) {
  if (!track.for_sale || track.sold || !(simulate || payMethods(sellerId).length)) return [];
  const have = filesOf(track.id), custom = parse(track.license_prices || '{}', {});
  return licensesOf(sellerId).filter((l) => custom[l.id] !== 0 && l.files.length && l.files.every((k) => have[k]))
    .map((l) => (custom[l.id] ? { ...l, price: custom[l.id] } : l));
}
/** Les prix d'une prod envoyés par le beatmaker ({ idLicence: centimes | 0 | null }), vérifiés, prêts à être gardés. */
export function licensePricesOf(value, sellerId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Prix des licences invalides.');
  const mine = new Set(licensesOf(sellerId).map((l) => String(l.id))), out = {};
  for (const [key, cents] of Object.entries(value)) {
    if (!mine.has(key) || cents === null || cents === undefined || cents === '') continue;
    const n = Math.round(Number(cents));
    if (!Number.isInteger(n) || (n !== 0 && (n < 100 || n > 100000_00))) throw new HttpError(400, 'Le prix d\'une licence va de 1 € à 100 000 €.');
    out[key] = n;
  }
  return JSON.stringify(out);
}

//------------------------------------------------------------------------------ Commandes
const orderLicense = (o) => parse(o.license, { name: '', files: [], terms: '', exclusive: false });
const shopUrl = (o) => `${config.siteUrl}/achat.html?o=${o.token}`;
//------------------------------------------------------------------------------ Contrat de licence
// Chaque beatmaker règle son contrat : titre, son nom légal et un contact, l'introduction, les clauses générales (communes
// à toutes ses licences), la conclusion et le bas de page ; les clauses propres à chaque licence sont ses conditions. Les
// textes acceptent des champs remplis à l'achat : {prod}, {beatmaker}, {acheteur}, {licence}, {prix}, {date}, {commande},
// {fichiers}. Le modèle est copié dans la commande au moment de l'achat : le modifier ensuite ne change pas les contrats signés.
export const CONTRACT_DEFAULT = {
  title: 'Contrat de licence « {licence} »',
  legalName: '',
  contact: '',
  intro: 'Le présent contrat est conclu entre {beatmaker} (le concédant) et {acheteur} (le licencié). Il porte sur l\'utilisation de la prod « {prod} » selon la licence {licence}, achetée {prix} le {date}.',
  clauses: [
    'Le concédant garantit être l\'auteur de la prod et détenir les droits nécessaires pour accorder cette licence.',
    'Le licencié ne peut ni revendre, ni louer, ni redistribuer la prod seule, même modifiée.',
    'Le licencié ne peut pas enregistrer la prod à son nom auprès d\'une société de gestion de droits ni d\'un service d\'identification de contenu.',
    'Toute utilisation qui dépasse les limites de cette licence demande l\'achat d\'une licence supérieure.',
  ].join('\n'),
  closing: 'Fait en ligne le {date}. Le paiement de la commande n° {commande} vaut acceptation du présent contrat par les deux parties.',
  footer: '',
  signatures: true,
};
const CONTRACT_LIMITS = { title: 140, legalName: 120, contact: 300, intro: 3000, clauses: 10000, closing: 2000, footer: 200 };
/** Le modèle de contrat d'un beatmaker, complété par celui de départ. */
export function contractTemplate(userId) {
  const saved = parse(sellerRow(userId)?.contract || '{}', {});
  return Object.fromEntries(Object.entries(CONTRACT_DEFAULT).map(([k, v]) => [k, typeof saved[k] === typeof v ? saved[k] : v]));
}
/** Le modèle envoyé par le beatmaker, vérifié : textes coupés à leur longueur, champs inconnus ignorés. */
export function contractFields(body) {
  const out = {};
  for (const [k, max] of Object.entries(CONTRACT_LIMITS)) {
    if (body?.[k] !== undefined) out[k] = String(body[k]).replace(/\r\n?/g, '\n').trim().slice(0, max);
  }
  if (body?.signatures !== undefined) out.signatures = !!body.signatures;
  return out;
}
const lines = (text) => String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
/**
 * Le contrat d'une commande, prêt à mettre en page (PDF sur la page d'achat) ou en texte : les champs remplis, les
 * clauses de la licence puis les clauses générales, une par ligne.
 */
export function contractOf(o) {
  const l = orderLicense(o), t = { ...CONTRACT_DEFAULT, ...(l.contract || {}) };
  const seller = t.legalName || o.artist, buyer = [o.buyer_name, o.buyer_email && `<${o.buyer_email}>`].filter(Boolean).join(' ') || 'l\'acheteur';
  const date = new Date(o.paid_at || o.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const files = l.files.map((k) => FILE_KINDS[k]).join(', ');
  const values = { prod: o.track_title, beatmaker: seller, acheteur: buyer, licence: l.name, prix: eurosFr(o.amount), date, commande: String(o.id), fichiers: files };
  const fill = (text) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => values[k] ?? m);
  return {
    title: fill(t.title), intro: fill(t.intro), closing: fill(t.closing), footer: fill(t.footer), signatures: !!t.signatures,
    parties: [['Concédant (beatmaker)', seller + (t.legalName && t.legalName !== o.artist ? ` (${o.artist})` : '')], ...(t.contact ? [['Contact du concédant', fill(t.contact)]] : []), ['Licencié', buyer]],
    details: [['Commande', `n° ${o.id}, payée le ${date}`], ['Prod', `« ${o.track_title} »`], ['Licence', `${l.name} (${l.exclusive ? 'exclusive' : 'non exclusive'})`],
      ['Fichiers fournis', files], ['Prix payé', eurosFr(o.amount)]],
    licenseClauses: lines(fill(l.terms)), generalClauses: lines(fill(t.clauses)),
    seller, buyer,
  };
}
/** Le même contrat en texte simple. */
function contractText(o) {
  const c = contractOf(o), numbered = (list, from = 1) => list.map((x, i) => `${i + from}. ${x}`);
  return [c.title.toUpperCase(), '', ...c.parties.map(([k, v]) => `${k} : ${v}`), '', c.intro, '', ...c.details.map(([k, v]) => `${k} : ${v}`), '',
    'Conditions de la licence :', ...numbered(c.licenseClauses), '', 'Clauses générales :', ...numbered(c.generalClauses, c.licenseClauses.length + 1), '',
    c.closing, ...(c.signatures ? ['', `Le concédant : ${c.seller}`, `Le licencié : ${c.buyer}`] : []), ...(c.footer ? ['', c.footer] : []),
  ].join('\n');
}
function orderView(o) {
  const l = orderLicense(o), paid = o.status === 'paid';
  return {
    status: o.status, number: o.id, trackTitle: o.track_title, artist: o.artist, amount: o.amount, sandbox: !!o.sandbox, simulated: o.provider === 'simulation', paidAt: o.paid_at,
    license: { name: l.name, terms: l.terms, exclusive: l.exclusive, files: l.files.map((k) => FILE_KINDS[k]) },
    buyerEmail: paid ? o.buyer_email : '',
    files: paid ? l.files.map((k) => ({ kind: k, label: FILE_KINDS[k], available: !!(o.track_id && fileFor(o.track_id, k)), url: `/api/sounds/orders/${o.token}/files/${k}` })) : [],
    contract: paid ? contractOf(o) : null, contractUrl: paid ? `/api/sounds/orders/${o.token}/licence.txt` : null,
  };
}
const sellerOrderView = (o) => ({ id: o.id, status: o.status, trackTitle: o.track_title, license: orderLicense(o).name, amount: o.amount, sandbox: !!o.sandbox,
  provider: o.provider, buyerEmail: o.buyer_email, buyerName: o.buyer_name, createdAt: o.created_at, paidAt: o.paid_at });

/**
 * Une commande PayPal : encaissée par le serveur si l'acheteur l'a approuvée ; la première vérification qui constate le
 * paiement la livre. Une commande Stripe ne change pas ici : seul le webhook signé la confirme.
 */
export async function verifyOrder(order) {
  if (order.status !== 'pending' || !order.provider_ref) return order;
  if (order.provider === 'stripe') {
    // Un compte branché par Stripe Connect : la plateforme relit la session chez Stripe, le webhook n'est qu'un raccourci.
    const k = sellerKeys(order.seller_id, 'stripe');
    if (!k?.account || k.account !== order.connect_account) return order;
    try {
      const session = await stripeCall(k.secret, 'GET', `/checkout/sessions/${encodeURIComponent(order.provider_ref)}`, null, k.account);
      if (session.payment_status === 'paid' && session.amount_total === order.amount && session.currency === order.currency) {
        return markPaid(order, session.customer_details?.email || '', session.customer_details?.name || '');
      }
    } catch (error) { console.error(`[ventes] commande ${order.id} : ${error.message}`); }
    return order;
  }
  if (order.provider !== 'paypal') return order;
  const s = sellerKeys(order.seller_id, 'paypal');
  if (!s) return order;
  let paid = false, email = '', name = '';
  try {
    let o = await paypalCall(s, 'GET', `/v2/checkout/orders/${encodeURIComponent(order.provider_ref)}`);
    if (o.status === 'APPROVED') o = await paypalCall(s, 'POST', `/v2/checkout/orders/${encodeURIComponent(order.provider_ref)}/capture`, {});
    const capture = o.purchase_units?.[0]?.payments?.captures?.[0];
    paid = o.status === 'COMPLETED' && capture?.status === 'COMPLETED' && capture.amount?.value === euros(order.amount) && capture.amount?.currency_code === 'EUR';
    email = o.payer?.email_address || ''; name = [o.payer?.name?.given_name, o.payer?.name?.surname].filter(Boolean).join(' ');
  } catch (error) {
    console.error(`[ventes] commande ${order.id} : ${error.message}`);
    return order;
  }
  return paid ? markPaid(order, email, name) : order;
}
// Une seule fois par commande, même si deux confirmations arrivent ensemble : la livraison suit.
function markPaid(order, email, name) {
  const changed = run(`UPDATE sound_orders SET status = 'paid', paid_at = ?, buyer_email = ?, buyer_name = ? WHERE id = ? AND status = 'pending'`,
    now(), str(email, 200), str(name, 120), order.id).changes;
  const done = get('SELECT * FROM sound_orders WHERE id = ?', order.id);
  if (changed) {
    // Une simulation ne retire pas une prod de la vente.
    if (orderLicense(done).exclusive && done.track_id && done.provider !== 'simulation') run('UPDATE sound_tracks SET sold = 1, for_sale = 0 WHERE id = ?', done.track_id);
    deliver(done);
  }
  return done;
}
function deliver(o) {
  const l = orderLicense(o), price = eurosFr(o.amount);
  if (o.buyer_email) sendMail(o.buyer_email, `Ta licence ${l.name} : « ${o.track_title} »`, [
    'Bonjour,', '', `Merci pour ton achat de « ${o.track_title} » de ${o.artist}, en licence ${l.name} (${price}).`, '',
    'Tes fichiers et ton contrat de licence t\'attendent ici :', shopUrl(o), '', 'Garde ce message : le lien reste valable.',
  ].join('\n')).catch((error) => console.error(`[ventes] e-mail de la commande ${o.id} : ${error.message}`));
  const seller = o.provider !== 'simulation' && get('SELECT email FROM users WHERE id = ?', o.seller_id);
  if (seller) sendMail(seller.email, `Vente : « ${o.track_title} » en ${l.name}`, [
    'Bonjour,', '', `« ${o.track_title} » vient d'être achetée en licence ${l.name} pour ${price}${o.buyer_email ? ` par ${o.buyer_email}` : ''}.`,
    l.exclusive ? 'C\'était l\'exclusivité : la prod est retirée de la vente.' : '', '', 'Le détail est dans le panneau Ventes de ton pack, sur ONIRIQUE CLOUD.',
  ].filter((line, i, a) => line || a[i - 1]).join('\n')).catch(() => {});
}
// Les paiements laissés en route (acheteur parti avant le retour sur la page d'achat) : vérifiés toutes les cinq minutes
// pendant deux jours.
setInterval(() => {
  for (const o of all(`SELECT * FROM sound_orders WHERE status = 'pending' AND provider IN ('paypal', 'stripe') AND provider_ref != '' AND created_at > ? ORDER BY created_at DESC LIMIT 30`, now() - 2 * 86400_000)) verifyOrder(o);
}, 5 * 60_000).unref();

// Les connexions à Stripe en cours (state → beatmaker), et le retrait de l'accès quand il débranche son compte.
const connecting = new Map();
async function deauthorize(s) {
  if (!s?.connect_account || !connectAvailable()) return;
  await fetch('https://connect.stripe.com/oauth/deauthorize', { method: 'POST',
    headers: { Authorization: `Bearer ${config.stripeConnectSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.stripeConnectClientId, stripe_user_id: s.connect_account }) }).catch(() => {});
}

//------------------------------------------------------------------------------ Routes
const STRIPE_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
const hookUrl = (userId) => `${config.publicUrl}/api/sounds/stripe/webhook/${userId}`;
/**
 * Le webhook Stripe de chaque beatmaker. Monté avant le parseur JSON : la signature porte sur le corps brut, vérifiée
 * avec le secret de son compte. Seul un paiement de ce montant, pour une commande de ce beatmaker, la confirme.
 */
export function mountBeatStoreHooks(app, { express, wrap }) {
  // Le webhook des comptes connectés (Stripe Connect) : un seul pour la plateforme, chaque événement dit de quel compte
  // il vient. Un paiement confirme la commande ; un beatmaker qui retire l'accès chez Stripe est débranché.
  app.post('/api/sounds/stripe/connect-webhook', express.raw({ type: '*/*', limit: '1mb' }), wrap(async (req, res) => {
    if (!config.stripeConnectWebhookSecret) throw new HttpError(404, 'Introuvable.');
    const raw = req.body.toString('utf8');
    verifyStripeSignature(raw, req.headers['stripe-signature'], config.stripeConnectWebhookSecret);
    const event = JSON.parse(raw), s = event.account && get(`SELECT * FROM sound_sellers WHERE connect_account = ?`, String(event.account));
    if (s && event.type === 'account.application.deauthorized') {
      run(`UPDATE sound_sellers SET provider = '', connect_account = '', account = '', updated_at = ? WHERE user_id = ?`, now(), s.user_id);
    } else if (s && STRIPE_EVENTS.includes(event.type) && event.data?.object?.payment_status === 'paid') {
      const session = event.data.object;
      const o = get(`SELECT * FROM sound_orders WHERE seller_id = ? AND provider = 'stripe' AND provider_ref = ?`, s.user_id, String(session.id || ''));
      if (o && session.amount_total === o.amount && session.currency === o.currency) markPaid(o, session.customer_details?.email || '', session.customer_details?.name || '');
    }
    res.json({ received: true });
  }));
  app.post('/api/sounds/stripe/webhook/:seller', express.raw({ type: '*/*', limit: '1mb' }), wrap(async (req, res) => {
    const s = sellerRow(id(req.params.seller));
    if (!s?.webhook_secret || s.provider !== 'stripe') throw new HttpError(404, 'Introuvable.');
    const raw = req.body.toString('utf8');
    verifyStripeSignature(raw, req.headers['stripe-signature'], unseal(s.webhook_secret));
    const event = JSON.parse(raw), session = event.data?.object || {};
    if (STRIPE_EVENTS.includes(event.type) && session.payment_status === 'paid') {
      const o = get(`SELECT * FROM sound_orders WHERE seller_id = ? AND provider = 'stripe' AND provider_ref = ?`, s.user_id, String(session.id || ''));
      if (o && session.amount_total === o.amount && session.currency === o.currency) {
        markPaid(o, session.customer_details?.email || session.customer_email || '', session.customer_details?.name || '');
      }
    }
    res.json({ received: true });
  }));
}

export function mountBeatStore(app, { me, track, room, receiveFile, openLink, linkTracks, linkProject, soundsDir, audioType, wrap }) {
  // Le panneau Ventes d'un beatmaker : compte de paiement, licences, commandes (celles en attente revérifiées).
  app.get('/api/me/sounds/store', ...me, wrap(async (req, res) => {
    const licenses = licensesOf(req.user.id);
    const pending = all(`SELECT * FROM sound_orders WHERE seller_id = ? AND status = 'pending' AND provider_ref != '' AND created_at > ? LIMIT 10`, req.user.id, now() - 2 * 86400_000);
    await Promise.all(pending.map(verifyOrder));
    res.json({ seller: sellerView(req.user.id), licenses, kinds: FILE_KINDS, contract: contractTemplate(req.user.id),
      instagram: get('SELECT instagram FROM users WHERE id = ?', req.user.id).instagram,
      orders: all('SELECT * FROM sound_orders WHERE seller_id = ? ORDER BY created_at DESC LIMIT 200', req.user.id).map(sellerOrderView) });
  }));
  // Brancher son compte : la clé est essayée chez le prestataire avant d'être gardée (chiffrée).
  app.put('/api/me/sounds/store/seller', ...me, wrap(async (req, res) => {
    rateLimit(`sounds-seller:${req.user.id}`, 20);
    licensesOf(req.user.id);
    const b = req.body || {};
    if (b.provider === 'stripe') {
      const key = String(b.secret || '').trim();
      if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(key)) throw new HttpError(400, 'Colle ta clé secrète Stripe : elle commence par sk_live_ (ou sk_test_ pour essayer).');
      const account = await stripeCall(key, 'GET', '/account').catch(() => stripeCall(key, 'GET', '/balance').then(() => ({})));
      // Le webhook qui confirme les paiements : créé chez Stripe, ou celui dont le beatmaker colle le secret (par exemple
      // celui de « stripe listen » pour essayer en local, où Stripe ne peut pas joindre le site).
      let hook = { secret: String(b.webhookSecret || '').trim(), id: '' };
      if (hook.secret && !/^whsec_[A-Za-z0-9]{10,}$/.test(hook.secret)) throw new HttpError(400, 'Le secret du webhook commence par whsec_.');
      await dropHook(req.user.id);
      if (!hook.secret) {
        hook = await stripeCall(key, 'POST', '/webhook_endpoints', { url: hookUrl(req.user.id), ...Object.fromEntries(STRIPE_EVENTS.map((e, i) => [`enabled_events[${i}]`, e])) })
          .catch(() => { throw new HttpError(400, `Stripe n'a pas pu créer le webhook qui confirme les paiements. Crée-le dans ton tableau de bord Stripe (adresse : ${hookUrl(req.user.id)}, événement checkout.session.completed) et colle son secret whsec_.`); });
      }
      await deauthorize(sellerRow(req.user.id));
      run(`UPDATE sound_sellers SET provider = 'stripe', client_id = '', connect_account = '', secret = ?, sandbox = ?, account = ?, webhook_secret = ?, webhook_id = ?, updated_at = ? WHERE user_id = ?`,
        seal(key), key.includes('_test_') ? 1 : 0, str(account.business_profile?.name || account.settings?.dashboard?.display_name || account.email || 'Compte Stripe', 120),
        seal(hook.secret), hook.id || '', now(), req.user.id);
    } else if (b.provider === 'paypal') {
      const seller = { clientId: str(b.clientId, 200), secret: String(b.secret || '').trim().slice(0, 300), sandbox: !!b.sandbox };
      if (!seller.clientId || !seller.secret) throw new HttpError(400, 'Il faut le Client ID et le secret de ton application PayPal.');
      await paypalCall(seller);
      run('UPDATE sound_sellers SET paypal_client_id = ?, paypal_secret = ?, paypal_sandbox = ?, updated_at = ? WHERE user_id = ?',
        seller.clientId, seal(seller.secret), seller.sandbox ? 1 : 0, now(), req.user.id);
    } else throw new HttpError(400, 'Choisis Stripe ou PayPal.');
    res.json(sellerView(req.user.id));
  }));
  // « Se connecter avec Stripe » (Stripe Connect, comptes Standard) : le beatmaker se connecte à son propre compte Stripe
  // (ou en crée un), autorise ONIRIQUE, et revient sur son pack ; aucune clé à copier. L'argent va sur son compte.
  app.post('/api/me/sounds/store/stripe-connect', ...me, (req, res) => {
    if (!connectAvailable()) throw new HttpError(503, "« Se connecter avec Stripe » n'est pas encore réglé sur le serveur.");
    licensesOf(req.user.id);
    for (const [k, v] of connecting) if (v.expires < now()) connecting.delete(k);
    const state = crypto.randomBytes(24).toString('base64url');
    connecting.set(state, { userId: req.user.id, back: /^#\/p\/\d+$/.test(str(req.body?.back, 20)) ? str(req.body.back, 20) : '', expires: now() + 15 * 60_000 });
    res.json({ url: 'https://connect.stripe.com/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: config.stripeConnectClientId,
      scope: 'read_write', state, redirect_uri: `${config.publicUrl}/api/sounds/stripe/connect/callback` }) });
  });
  app.get('/api/sounds/stripe/connect/callback', wrap(async (req, res) => {
    const entry = connecting.get(str(req.query.state, 100));
    connecting.delete(str(req.query.state, 100));
    let result = 'ok';
    try {
      if (!entry || entry.expires < now()) throw new HttpError(400, 'Connexion à Stripe expirée : recommence depuis le panneau Ventes.');
      if (req.query.error) throw new HttpError(400, req.query.error === 'access_denied' ? 'Connexion à Stripe annulée.' : `Stripe refuse : ${str(req.query.error_description, 200) || req.query.error}`);
      const token = await fetch('https://connect.stripe.com/oauth/token', { method: 'POST',
        headers: { Authorization: `Bearer ${config.stripeConnectSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: str(req.query.code, 200) }) }).then((r) => r.json());
      if (!token.stripe_user_id) throw new HttpError(502, `Stripe n'a pas relié le compte : ${token.error_description || token.error || 'réponse inattendue'}.`);
      const account = await stripeCall(config.stripeConnectSecretKey, 'GET', `/accounts/${token.stripe_user_id}`).catch(() => ({}));
      await dropHook(entry.userId);
      run(`UPDATE sound_sellers SET provider = 'stripe', client_id = '', secret = NULL, connect_account = ?, sandbox = ?, account = ?, updated_at = ? WHERE user_id = ?`,
        token.stripe_user_id, token.livemode === false ? 1 : 0,
        str(account.business_profile?.name || account.settings?.dashboard?.display_name || account.email || 'Compte Stripe', 120), now(), entry.userId);
    } catch (error) { result = error.message; }
    res.redirect(`${config.siteUrl}/mes-sons?stripe=${encodeURIComponent(result)}${entry?.back || ''}`);
  }));

  // Débrancher l'un des deux (?provider=stripe ou paypal) ; sans précision, les deux.
  app.delete('/api/me/sounds/store/seller', ...me, wrap(async (req, res) => {
    const which = String(req.query.provider || '');
    if (which !== 'paypal') {
      await dropHook(req.user.id);
      await deauthorize(sellerRow(req.user.id));
      run(`UPDATE sound_sellers SET provider = '', client_id = '', secret = NULL, sandbox = 0, account = '', connect_account = '', updated_at = ? WHERE user_id = ?`, now(), req.user.id);
    }
    if (which !== 'stripe') run(`UPDATE sound_sellers SET paypal_client_id = '', paypal_secret = NULL, paypal_sandbox = 0, updated_at = ? WHERE user_id = ?`, now(), req.user.id);
    res.json(sellerView(req.user.id));
  }));

  const licenseFields = (b, l = {}) => {
    const name = b.name !== undefined ? str(b.name, 60) : l.name;
    const price = b.price !== undefined ? Math.round(Number(b.price)) : l.price;
    const files = b.files !== undefined ? (Array.isArray(b.files) ? [...new Set(b.files.filter((k) => FILE_KINDS[k]))] : null) : parse(l.files, []);
    if (!name) throw new HttpError(400, 'Donne un nom à la licence.');
    if (!Number.isInteger(price) || price < 100 || price > 100000_00) throw new HttpError(400, 'Le prix d\'une licence va de 1 € à 100 000 €.');
    if (!files?.length) throw new HttpError(400, 'Une licence livre au moins un fichier.');
    return { name, price, files: JSON.stringify(Object.keys(FILE_KINDS).filter((k) => files.includes(k))),
      terms: b.terms !== undefined ? String(b.terms).replace(/\r\n?/g, '\n').trim().slice(0, 5000) : l.terms ?? '',
      exclusive: b.exclusive !== undefined ? (b.exclusive ? 1 : 0) : l.exclusive ?? 0 };
  };
  const ownLicense = (req) => {
    const l = get('SELECT * FROM sound_licenses WHERE id = ? AND user_id = ?', id(req.params.id), req.user.id);
    if (!l) throw new HttpError(404, 'Licence introuvable.');
    return l;
  };
  app.post('/api/me/sounds/store/licenses', ...me, (req, res) => {
    licensesOf(req.user.id);
    if (get('SELECT COUNT(*) AS n FROM sound_licenses WHERE user_id = ?', req.user.id).n >= 12) throw new HttpError(400, '12 licences au plus.');
    const f = licenseFields(req.body || {});
    const position = get('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM sound_licenses WHERE user_id = ?', req.user.id).n;
    run('INSERT INTO sound_licenses (user_id, name, price, files, terms, exclusive, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      req.user.id, f.name, f.price, f.files, f.terms, f.exclusive, position, now());
    res.status(201).json(licensesOf(req.user.id));
  });
  app.patch('/api/me/sounds/store/licenses/:id', ...me, (req, res) => {
    const f = licenseFields(req.body || {}, ownLicense(req));
    run('UPDATE sound_licenses SET name = ?, price = ?, files = ?, terms = ?, exclusive = ? WHERE id = ?', f.name, f.price, f.files, f.terms, f.exclusive, id(req.params.id));
    res.json(licensesOf(req.user.id));
  });
  // Une licence retirée ne se vend plus ; les commandes passées gardent leur copie de ses conditions.
  app.delete('/api/me/sounds/store/licenses/:id', ...me, (req, res) => {
    run('DELETE FROM sound_licenses WHERE id = ?', ownLicense(req).id);
    res.json(licensesOf(req.user.id));
  });
  // Le modèle de contrat du beatmaker, et son aperçu sur une commande fictive (avec ses réglages pas encore enregistrés).
  app.put('/api/me/sounds/store/contract', ...me, (req, res) => {
    licensesOf(req.user.id);
    run('UPDATE sound_sellers SET contract = ?, updated_at = ? WHERE user_id = ?', JSON.stringify({ ...contractTemplate(req.user.id), ...contractFields(req.body) }), now(), req.user.id);
    res.json(contractTemplate(req.user.id));
  });
  app.post('/api/me/sounds/store/contract/preview', ...me, (req, res) => {
    const l = licensesOf(req.user.id).find((x) => x.id === id(req.body.licenseId)) || licensesOf(req.user.id)[0];
    if (!l) throw new HttpError(400, 'Crée d\'abord une licence.');
    const contract = { ...contractTemplate(req.user.id), ...contractFields(req.body.contract) };
    res.json(contractOf({ id: 1234, track_title: 'Titre de la prod', artist: req.user.name || 'Beatmaker', buyer_name: 'Prénom Nom', buyer_email: 'acheteur@exemple.fr',
      amount: l.price, created_at: now(), paid_at: now(), license: JSON.stringify({ ...l, terms: req.body.terms ?? l.terms, contract }) }));
  });
  app.post('/api/me/sounds/store/orders/:id/check', ...me, wrap(async (req, res) => {
    const o = get('SELECT * FROM sound_orders WHERE id = ? AND seller_id = ?', id(req.params.id), req.user.id);
    if (!o) throw new HttpError(404, 'Commande introuvable.');
    res.json(sellerOrderView(await verifyOrder(o)));
  }));

  // Les fichiers livrés avec une prod : MP3 et WAV (sons reconnus), stems en ZIP ou RAR. Ils comptent dans l'espace du
  // propriétaire du pack.
  app.put('/api/me/sounds/tracks/:id/files/:kind', ...me, wrap(async (req, res) => {
    const t = track(req, req.params.id), kind = req.params.kind;
    if (!FILE_KINDS[kind]) throw new HttpError(404, 'Format inconnu.');
    rateLimit(`sounds-upload:${req.user.id}`, 200, 3600_000);
    const length = Number(req.headers['content-length']);
    if (!Number.isFinite(length) || length <= 0) throw new HttpError(411, 'Taille du fichier inconnue.');
    if (length > MAX_FILE[kind]) throw new HttpError(413, `Fichier trop volumineux : ${MAX_FILE[kind] / 1024 ** 2 >= 1024 ? MAX_FILE[kind] / 1024 ** 3 + ' Go' : MAX_FILE[kind] / 1024 ** 2 + ' Mo'} au plus.`);
    const old = get('SELECT * FROM sound_deliverables WHERE track_id = ? AND kind = ?', t.id, kind);
    const file = await receiveFile(req, soundsDir, Math.min(MAX_FILE[kind], room(req, length - (old?.size || 0), t.owner_id) + (old?.size || 0)));
    const stored = path.join(soundsDir, file.storedAs);
    const head = Buffer.alloc(12), fd = fs.openSync(stored, 'r');
    fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd);
    const magic = head.toString('latin1', 0, 4);
    const mime = kind === 'stems' ? (magic === 'PK\x03\x04' ? 'application/zip' : magic === 'Rar!' ? 'application/vnd.rar' : null)
      : audioType(head) === (kind === 'mp3' ? 'audio/mpeg' : 'audio/wav') ? audioType(head) : null;
    if (!mime) {
      fs.rmSync(stored, { force: true });
      throw new HttpError(400, kind === 'stems' ? 'Les stems se déposent dans un fichier ZIP (ou RAR).' : `Ce fichier n'est pas un ${FILE_KINDS[kind]}.`);
    }
    run(`INSERT INTO sound_deliverables (track_id, kind, filename, stored_as, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (track_id, kind) DO UPDATE SET filename = excluded.filename, stored_as = excluded.stored_as, mime = excluded.mime, size = excluded.size, created_at = excluded.created_at`,
      t.id, kind, str(req.query.filename, 200) || `${kind}`, file.storedAs, mime, file.size, now());
    if (old) fs.rmSync(path.join(soundsDir, old.stored_as), { force: true });
    res.json({ files: filesOf(t.id) });
  }));
  app.delete('/api/me/sounds/tracks/:id/files/:kind', ...me, (req, res) => {
    const t = track(req, req.params.id);
    const old = get('SELECT * FROM sound_deliverables WHERE track_id = ? AND kind = ?', t.id, String(req.params.kind));
    if (old) {
      run('DELETE FROM sound_deliverables WHERE track_id = ? AND kind = ?', t.id, old.kind);
      fs.rmSync(path.join(soundsDir, old.stored_as), { force: true });
    }
    res.json({ files: filesOf(t.id) });
  });

  // Les listes de contacts d'un membre (nom et adresse), pour les mails de ses packs : importées d'un CSV ou collées. Chaque
  // contact vient avec ce qu'il a fait du dernier mail reçu (suivi).
  const ownList = (req) => {
    const l = get('SELECT * FROM sound_mail_lists WHERE id = ? AND user_id = ?', id(req.params.id), req.user.id);
    if (!l) throw new HttpError(404, 'Liste introuvable.');
    return l;
  };
  // Une liste partagée par un fondateur se lit (et sert aux mails) chez tous les membres ONIRIQUE, sans se modifier.
  const seesShared = (user) => ['vip', 'founder'].includes(user.role);
  const readableList = (req) => {
    const l = get('SELECT * FROM sound_mail_lists WHERE id = ? AND (user_id = ? OR (shared = 1 AND ?))', id(req.params.id), req.user.id, seesShared(req.user) ? 1 : 0);
    if (!l) throw new HttpError(404, 'Liste introuvable.');
    return l;
  };
  // Le suivi et les désinscriptions sont ceux de celui qui regarde : chacun envoie depuis sa boîte.
  const listView = (l, full = false, viewer = l.user_id) => {
    const contacts = listContacts(l), head = { id: l.id, name: l.name, count: contacts.length, createdAt: l.created_at, shared: !!l.shared, mine: l.user_id === viewer };
    if (!full) return head;
    const last = new Map(all(`SELECT * FROM sound_mail_recipients WHERE user_id = ? AND status != 'wait' ORDER BY created_at`, viewer).map((r) => [r.email, r]));
    const unsubscribed = new Set(all('SELECT email FROM sound_mail_unsubs WHERE user_id = ?', viewer).map((x) => x.email));
    return { ...head, emails: contacts.map((c) => c.email),
      contacts: contacts.map((c) => {
        const r = last.get(c.email);
        return { ...c, unsubscribed: unsubscribed.has(c.email), last: r ? { sentAt: r.sent_at, status: r.status, openedAt: r.opened_at, clickedAt: r.clicked_at, plays: r.plays, downloads: r.downloads, lastAt: r.last_at } : null };
      }) };
  };
  const listEmails = (text) => {
    const contacts = contactsOf(text);
    if (contacts.length > 3000) throw new HttpError(400, '3 000 contacts au plus par liste.');
    return JSON.stringify(contacts);
  };
  app.get('/api/me/sounds/mail-lists', ...me, (req, res) => {
    res.json(all('SELECT * FROM sound_mail_lists WHERE user_id = ? OR (shared = 1 AND ?) ORDER BY shared DESC, created_at DESC', req.user.id, seesShared(req.user) ? 1 : 0)
      .map((l) => listView(l, false, req.user.id)));
  });
  app.get('/api/me/sounds/mail-lists/:id', ...me, (req, res) => res.json(listView(readableList(req), true, req.user.id)));
  app.post('/api/me/sounds/mail-lists', ...me, (req, res) => {
    rateLimit(`sounds-lists:${req.user.id}`, 100);
    const name = str(req.body.name, 80);
    if (!name) throw new HttpError(400, 'Donne un nom à la liste.');
    if (get('SELECT COUNT(*) AS n FROM sound_mail_lists WHERE user_id = ?', req.user.id).n >= 50) throw new HttpError(400, '50 listes au plus.');
    const emails = listEmails(req.body.emails);
    if (emails === '[]') throw new HttpError(400, 'Aucune adresse e-mail dans cette liste.');
    const lid = run('INSERT INTO sound_mail_lists (user_id, name, emails, created_at) VALUES (?, ?, ?, ?)', req.user.id, name, emails, now()).lastInsertRowid;
    res.status(201).json(listView(get('SELECT * FROM sound_mail_lists WHERE id = ?', lid), true));
  });
  app.patch('/api/me/sounds/mail-lists/:id', ...me, (req, res) => {
    const l = ownList(req);
    if (req.body.name !== undefined) run('UPDATE sound_mail_lists SET name = ? WHERE id = ?', str(req.body.name, 80) || l.name, l.id);
    if (req.body.emails !== undefined) run('UPDATE sound_mail_lists SET emails = ? WHERE id = ?', listEmails(req.body.emails), l.id);
    if (req.body.shared !== undefined) {
      if (req.user.role !== 'founder') throw new HttpError(403, 'Seul un fondateur partage une liste avec les membres ONIRIQUE.');
      run('UPDATE sound_mail_lists SET shared = ? WHERE id = ?', req.body.shared ? 1 : 0, l.id);
    }
    res.json(listView(get('SELECT * FROM sound_mail_lists WHERE id = ?', l.id), true));
  });
  app.delete('/api/me/sounds/mail-lists/:id', ...me, (req, res) => {
    run('DELETE FROM sound_mail_lists WHERE id = ?', ownList(req).id);
    res.json({ ok: true });
  });

  // L'achat depuis la page d'écoute : la commande est créée, puis l'acheteur part payer chez le prestataire.
  // La commande d'une licence choisie sur la page d'écoute ; ses conditions sont copiées telles qu'au moment de l'achat.
  const newOrder = (req, simulate) => {
    const link = openLink(req), p = linkProject(link);
    const t = p.kind === 'pack' && linkTracks(link).find((x) => x.id === id(req.body.trackId));
    if (!t) throw new HttpError(404, 'Prod introuvable.');
    const l = offersOf(t, p.user_id, simulate).find((x) => x.id === id(req.body.licenseId));
    if (!l) throw new HttpError(400, 'Cette licence n\'est plus disponible pour cette prod.');
    // Le moyen de paiement choisi par l'acheteur (carte par Stripe, ou PayPal), s'il est branché ; sinon le premier qui l'est.
    const methods = payMethods(p.user_id);
    if (!simulate && !methods.length) throw new HttpError(400, 'Ce beatmaker n\'a pas encore branché de moyen de paiement.');
    const s = simulate ? { provider: 'simulation', sandbox: true } : sellerKeys(p.user_id, methods.includes(req.body.provider) ? req.body.provider : methods[0]);
    const token = crypto.randomBytes(24).toString('base64url');
    const artist = p.artist || p.author_name || 'ONIRIQUE';
    const oid = run(`INSERT INTO sound_orders (token, seller_id, track_id, link_id, track_title, artist, license, amount, provider, sandbox, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, token, p.user_id, t.id, link.id, t.title, artist,
      JSON.stringify({ id: l.id, name: l.name, files: l.files, terms: l.terms, exclusive: l.exclusive, contract: contractTemplate(p.user_id) }), l.price, s.provider, s.sandbox ? 1 : 0, now()).lastInsertRowid;
    return { link, t, l, s, token, artist, oid };
  };
  // Un fondateur simule l'achat : la commande est payée tout de suite, sans prestataire, et livrée à son adresse.
  app.post('/api/sounds/share/:token/simulate', (req, res) => {
    const founder = optionalUser(req);
    if (founder?.role !== 'founder') throw new HttpError(403, 'Réservé aux fondateurs.');
    rateLimit(`sounds-simulate:${founder.id}`, 60);
    const { oid, token } = newOrder(req, true);
    markPaid(get('SELECT * FROM sound_orders WHERE id = ?', oid), founder.email, founder.name || '');
    res.json({ url: `${config.siteUrl}/achat.html?o=${token}` });
  });
  app.post('/api/sounds/share/:token/buy', wrap(async (req, res) => {
    rateLimit(`sounds-buy:${req.ip}`, 30);
    const { link, t, l, s, token, artist, oid } = newOrder(req, false);
    const back = `${config.siteUrl}/ecoute?t=${link.token}`, done = `${config.siteUrl}/achat.html?o=${token}`;
    const label = `${t.title} — licence ${l.name}`.slice(0, 120);
    try {
      let url, ref;
      if (s.provider === 'stripe') {
        const session = await stripeCall(s.secret, 'POST', '/checkout/sessions', {
          mode: 'payment', success_url: done, cancel_url: back, locale: 'fr', client_reference_id: String(oid), 'metadata[onirique_order]': String(oid),
          'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'eur', 'line_items[0][price_data][unit_amount]': String(l.price),
          'line_items[0][price_data][product_data][name]': label,
        }, s.account);
        url = session.url; ref = session.id;
      } else {
        const order = await paypalCall(s, 'POST', '/v2/checkout/orders', {
          intent: 'CAPTURE',
          purchase_units: [{ reference_id: String(oid), description: label, amount: { currency_code: 'EUR', value: euros(l.price) } }],
          payment_source: { paypal: { experience_context: { return_url: done, cancel_url: back, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', brand_name: artist.slice(0, 127) } } },
        });
        url = order.links?.find((x) => x.rel === 'payer-action' || x.rel === 'approve')?.href; ref = order.id;
      }
      if (!url || !ref) throw new HttpError(502, 'Le paiement n\'a pas pu démarrer.');
      run('UPDATE sound_orders SET provider_ref = ?, connect_account = ? WHERE id = ?', ref, s.account || '', oid);
      res.json({ url });
    } catch (error) {
      run('DELETE FROM sound_orders WHERE id = ?', oid);
      throw error;
    }
  }));
  // La page d'achat : l'état de la commande (vérifié chez le prestataire tant qu'elle attend), puis la livraison.
  const orderOf = (req) => {
    const o = get('SELECT * FROM sound_orders WHERE token = ?', str(req.params.token, 64));
    if (!o) throw new HttpError(404, 'Commande introuvable.');
    return o;
  };
  app.get('/api/sounds/orders/:token', wrap(async (req, res) => {
    rateLimit(`sounds-order:${req.ip}`, 300);
    res.set('Cache-Control', 'no-store');
    res.json(orderView(await verifyOrder(orderOf(req))));
  }));
  app.get('/api/sounds/orders/:token/files/:kind', (req, res) => {
    const o = orderOf(req), kind = String(req.params.kind);
    if (o.status !== 'paid' || !orderLicense(o).files.includes(kind)) throw new HttpError(403, 'Ce fichier ne fait pas partie de ta licence.');
    const f = o.track_id && fileFor(o.track_id, kind);
    if (!f) throw new HttpError(404, 'Ce fichier n\'est plus disponible : écris au beatmaker.');
    res.set({ 'Content-Type': f.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    res.attachment(`${o.track_title} (${FILE_KINDS[kind]})${path.extname(f.filename) || ''}`);
    res.sendFile(path.join(soundsDir, f.stored_as));
  });
  app.get('/api/sounds/orders/:token/licence.txt', (req, res) => {
    const o = orderOf(req);
    if (o.status !== 'paid') throw new HttpError(403, 'La commande n\'est pas encore payée.');
    res.attachment(`Licence ${orderLicense(o).name} - ${o.track_title}.txt`);
    res.type('text/plain; charset=utf-8').send(contractText(o));
  });
}
