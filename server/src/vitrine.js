// La vitrine des graphistes : covers et visuels publiés par un membre qui a une page de profil, chacun avec un prix s'il le
// veut. Le public ne voit qu'une copie réduite et filigranée, faite à l'envoi ; l'original reste dans data/vitrine/, hors
// de media/, et ne sort que pour une commande payée. L'achat suit la vente des prods (beatstore.js) : ONIRIQUE encaisse
// par Stripe Checkout, la vente s'ajoute au solde du graphiste, qui en demande le versement.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { db, get, all, run, now } from './db.js';
import { HttpError, rateLimit, optionalUser } from './auth.js';
import { platformStripe, stripeCall, markPaid, balanceOf, askPayout, verifyOrder, offersOf } from './beatstore.js';
import { publicPlaylists } from './ratings.js';

db.exec(`CREATE TABLE IF NOT EXISTS vitrine_visuals (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL DEFAULT 0,
  unique_sale INTEGER NOT NULL DEFAULT 0,
  sold        INTEGER NOT NULL DEFAULT 0,
  hidden      INTEGER NOT NULL DEFAULT 0,
  original    TEXT NOT NULL,
  preview     TEXT NOT NULL,
  format      TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vitrine_by_user ON vitrine_visuals (user_id, created_at);`);
// Une commande de visuel est une commande de la boutique des prods (même solde, même page d'achat) qui porte ce visuel.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('sound_orders') WHERE name = 'visual_id'`).get()) {
  db.exec('ALTER TABLE sound_orders ADD COLUMN visual_id INTEGER');
}

export const vitrineDir = path.join(config.dataDir, 'vitrine');
fs.mkdirSync(vitrineDir, { recursive: true });
const MAX_FILE = 25 * 1024 * 1024;
const PREVIEW = 1200;
const FORMATS = { png: 'png', jpeg: 'jpg', webp: 'webp' };
const str = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const id = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0);
const xml = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** La copie publique : réduite à 1200 px et couverte d'un filigrane en biais (texte et traits, lisibles même sans police). */
export async function watermark(source, handle) {
  const { data, info } = await sharp(source).rotate().resize({ width: PREVIEW, height: PREVIEW, fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  const label = xml(`ONIRIQUE · @${handle}`), size = Math.max(16, Math.round(Math.max(info.width, info.height) / 28));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}">
    <defs><pattern id="w" width="${size * 16}" height="${size * 5}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
      <text x="0" y="${size * 2}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${size}" fill="#fff" fill-opacity=".42" stroke="#000" stroke-opacity=".3" stroke-width="1">${label}</text>
      <path d="M0 ${size * 3.4}H${size * 16}" stroke="#fff" stroke-opacity=".28" stroke-width="${Math.max(2, size / 8)}" stroke-dasharray="${size} ${size / 2}"/>
    </pattern></defs>
    <rect width="100%" height="100%" fill="url(#w)"/></svg>`;
  return sharp(data).composite([{ input: Buffer.from(svg) }]).webp({ quality: 78 }).toBuffer();
}

const sellerName = (userId) => { const u = get('SELECT name, email FROM users WHERE id = ?', userId); return u?.name || 'Graphiste'; };
const canBuy = (v) => v.price > 0 && !v.sold && !!platformStripe();
function view(v) {
  return { id: v.id, title: v.title, description: v.description, price: v.price, unique: !!v.unique_sale, sold: !!v.sold, forSale: canBuy(v),
    width: v.width, height: v.height, image: `/api/vitrine/${v.id}/image?v=${v.preview.slice(0, 8)}`, createdAt: v.created_at,
    author: { handle: v.handle, name: v.name || 'Membre', avatar: v.avatar ? `/api/media/${v.avatar}` : null } };
}
const PUBLIC = `SELECT v.*, p.handle, u.name, u.avatar FROM vitrine_visuals v JOIN users u ON u.id = v.user_id JOIN user_profiles p ON p.user_id = v.user_id
  WHERE v.hidden = 0`;
const publicVisual = (vid) => {
  const v = get(`${PUBLIC} AND v.id = ?`, id(vid));
  if (!v) throw new HttpError(404, 'Visuel introuvable.');
  return v;
};
function removeFiles(v) {
  for (const f of [v.original, v.preview]) fs.rmSync(path.join(vitrineDir, f), { force: true });
}

export function mountVitrine(app, { requireUser, receiveFile, wrap }) {
  // La vitrine publique, la plus récente d'abord ; ?u= : celle d'un graphiste (onglet Vitrine de sa page de profil).
  app.get('/api/vitrine', (req, res) => {
    const handle = str(req.query.u, 40).toLowerCase();
    // shortcut: les 200 derniers visuels sans pagination, à paginer quand la vitrine en aura plus.
    const rows = handle ? all(`${PUBLIC} AND p.handle = ? ORDER BY v.created_at DESC LIMIT 200`, handle) : all(`${PUBLIC} ORDER BY v.created_at DESC LIMIT 200`);
    res.set('Cache-Control', 'no-store').json(rows.map(view));
  });
  // simulate : un fondateur peut essayer l'achat sans payer.
  app.get('/api/vitrine/:id', (req, res) => {
    const v = publicVisual(req.params.id);
    res.set('Cache-Control', 'no-store').json({ ...view(v), simulate: optionalUser(req)?.role === 'founder' && v.price > 0 && !v.sold });
  });
  // La marketplace : tout ce qui s'achète, réuni. Les visuels en vente (copie filigranée seulement) et les packs de prods
  // publics dont au moins une prod a une licence achetable, au prix le plus bas (« dès »).
  app.get('/api/marketplace', (_req, res) => {
    const visuals = all(`${PUBLIC} AND v.price > 0 AND v.sold = 0 ORDER BY v.created_at DESC LIMIT 200`).filter(canBuy).map((v) => ({
      type: 'visual', id: v.id, title: v.title, image: view(v).image, price: v.price, from: false, at: v.created_at,
      seller: { name: v.name || 'Membre', handle: v.handle }, url: `/vitrine?u=${encodeURIComponent(v.handle)}&v=${v.id}` }));
    // shortcut: les 200 derniers packs publics, relus à chaque visite ; à mettre en cache si la liste grossit.
    const packs = publicPlaylists(0, { kind: 'pack', limit: 200 }).map((p) => {
      const owner = get('SELECT user_id FROM sound_projects WHERE id = ?', p.id).user_id;
      const prices = all('SELECT * FROM sound_tracks WHERE project_id = ? AND private = 0 AND for_sale = 1 AND sold = 0', p.id)
        .flatMap((t) => offersOf(t, owner).map((o) => o.price));
      return prices.length && { type: 'pack', id: p.id, title: p.title, image: p.cover ? `${p.cover}?w=480` : null, price: Math.min(...prices), from: true, at: p.at,
        tracks: p.tracks, seller: { name: p.owner, handle: p.ownerHandle }, url: p.url };
    }).filter(Boolean);
    res.set('Cache-Control', 'no-store').json([...visuals, ...packs].sort((a, b) => b.at - a.at));
  });
  // Seule la copie filigranée est servie au public.
  app.get('/api/vitrine/:id/image', (req, res, next) => {
    const v = get('SELECT preview FROM vitrine_visuals WHERE id = ?', id(req.params.id));
    if (!v) return next(new HttpError(404, 'Introuvable.'));
    res.set({ 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.sendFile(path.join(vitrineDir, v.preview), (error) => error && next(new HttpError(404, 'Introuvable.')));
  });

  // Sa vitrine : ses visuels (même retirés de la vente), ses ventes de visuels et son solde.
  app.get('/api/me/vitrine', requireUser, wrap(async (req, res) => {
    const pending = all(`SELECT * FROM sound_orders WHERE seller_id = ? AND visual_id IS NOT NULL AND status = 'pending' AND provider_ref != '' AND created_at > ? LIMIT 10`,
      req.user.id, now() - 2 * 86400_000);
    await Promise.all(pending.map(verifyOrder));
    const handle = get('SELECT handle FROM user_profiles WHERE user_id = ?', req.user.id)?.handle || null;
    res.json({ handle, platform: !!platformStripe(), balance: balanceOf(req.user.id),
      visuals: all(`SELECT v.*, ? AS handle, u.name, u.avatar FROM vitrine_visuals v JOIN users u ON u.id = v.user_id WHERE v.user_id = ? AND v.hidden = 0 ORDER BY v.created_at DESC`, handle, req.user.id).map(view),
      orders: all(`SELECT * FROM sound_orders WHERE seller_id = ? AND visual_id IS NOT NULL AND status = 'paid' ORDER BY created_at DESC LIMIT 200`, req.user.id)
        .map((o) => ({ id: o.id, title: o.track_title, amount: o.amount, buyerEmail: o.buyer_email, paidAt: o.paid_at, simulated: o.provider === 'simulation' })) });
  }));
  // Publier un visuel : l'image en corps brut (PNG, JPEG ou WebP, 25 Mo au plus), le titre et le prix dans l'adresse.
  app.post('/api/me/vitrine', requireUser, wrap(async (req, res) => {
    const profile = get('SELECT handle FROM user_profiles WHERE user_id = ?', req.user.id);
    if (!profile) throw new HttpError(409, 'Crée d\'abord ta page de profil : c\'est par elle qu\'on te contacte.');
    rateLimit(`vitrine-upload:${req.user.id}`, 60, 3600_000);
    if (get('SELECT COUNT(*) AS n FROM vitrine_visuals WHERE user_id = ? AND hidden = 0', req.user.id).n >= 300) throw new HttpError(400, '300 visuels au plus.');
    const fields = visualFields(req.query);
    if (!fields.title) throw new HttpError(400, 'Donne un titre au visuel.');
    const length = Number(req.headers['content-length']);
    if (Number.isFinite(length) && length > MAX_FILE) throw new HttpError(413, 'Image trop lourde : 25 Mo au plus.');
    const file = await receiveFile(req, vitrineDir, MAX_FILE), original = path.join(vitrineDir, file.storedAs);
    let meta, preview;
    try {
      meta = await sharp(original).metadata();
      if (!FORMATS[meta.format]) throw new Error();
      preview = await watermark(original, profile.handle);
    } catch {
      fs.rmSync(original, { force: true });
      throw new HttpError(400, 'Image attendue : PNG, JPEG ou WebP.');
    }
    const previewName = `${crypto.randomBytes(16).toString('hex')}.webp`;
    fs.writeFileSync(path.join(vitrineDir, previewName), preview);
    const vid = run(`INSERT INTO vitrine_visuals (user_id, title, description, price, unique_sale, original, preview, format, width, height, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, req.user.id, fields.title, fields.description, fields.price, fields.unique, file.storedAs, previewName,
      meta.format, meta.width, meta.height, now()).lastInsertRowid;
    res.status(201).json(view(publicVisual(vid)));
  }));
  const own = (req) => {
    const v = get('SELECT * FROM vitrine_visuals WHERE id = ? AND user_id = ? AND hidden = 0', id(req.params.id), req.user.id);
    if (!v) throw new HttpError(404, 'Visuel introuvable.');
    return v;
  };
  app.patch('/api/me/vitrine/:id', requireUser, (req, res) => {
    const v = own(req), f = visualFields(req.body || {}, v);
    run('UPDATE vitrine_visuals SET title = ?, description = ?, price = ?, unique_sale = ? WHERE id = ?', f.title || v.title, f.description, f.price, f.unique, v.id);
    res.json(view(publicVisual(v.id)));
  });
  // Un visuel déjà acheté est seulement retiré de la vitrine : ses acheteurs gardent l'accès à l'original.
  app.delete('/api/me/vitrine/:id', requireUser, (req, res) => {
    const v = own(req);
    if (get(`SELECT 1 AS x FROM sound_orders WHERE visual_id = ? AND status = 'paid'`, v.id)) run('UPDATE vitrine_visuals SET hidden = 1 WHERE id = ?', v.id);
    else { run('DELETE FROM vitrine_visuals WHERE id = ?', v.id); removeFiles(v); }
    res.json({ ok: true });
  });
  app.post('/api/me/vitrine/payout-request', requireUser, (req, res) => res.json(askPayout(req.user)));

  // L'achat : la commande copie le titre et le prix du moment, puis l'acheteur paie sur Stripe Checkout (compte d'ONIRIQUE).
  const newOrder = (v, provider, sandbox) => {
    const token = crypto.randomBytes(24).toString('base64url');
    const oid = run(`INSERT INTO sound_orders (token, seller_id, visual_id, track_title, artist, license, amount, provider, sandbox, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, token, v.user_id, v.id, v.title, sellerName(v.user_id),
      JSON.stringify({ name: 'Visuel', files: [], terms: '', exclusive: !!v.unique_sale }), v.price, provider, sandbox ? 1 : 0, now()).lastInsertRowid;
    return { token, oid };
  };
  const buyable = (req) => {
    const v = publicVisual(req.params.id);
    if (!(v.price > 0) || v.sold) throw new HttpError(400, 'Ce visuel n\'est pas en vente.');
    return v;
  };
  app.post('/api/vitrine/:id/buy', wrap(async (req, res) => {
    rateLimit(`vitrine-buy:${req.ip}`, 30);
    const v = buyable(req), stripe = platformStripe();
    if (!stripe) throw new HttpError(503, 'La vente n\'est pas encore ouverte : contacte le graphiste.');
    const { token, oid } = newOrder(v, 'onirique', stripe.test);
    try {
      const session = await stripeCall(stripe.key, 'POST', '/checkout/sessions', {
        mode: 'payment', success_url: `${config.siteUrl}/achat?o=${token}`, cancel_url: `${config.siteUrl}/vitrine?v=${v.id}`, locale: 'fr',
        client_reference_id: String(oid), 'metadata[onirique_order]': String(oid),
        'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'eur', 'line_items[0][price_data][unit_amount]': String(v.price),
        'line_items[0][price_data][product_data][name]': `${v.title} — visuel de ${sellerName(v.user_id)}`.slice(0, 120),
      });
      if (!session.url || !session.id) throw new HttpError(502, 'Le paiement n\'a pas pu démarrer.');
      run('UPDATE sound_orders SET provider_ref = ? WHERE id = ?', session.id, oid);
      res.json({ url: session.url });
    } catch (error) {
      run('DELETE FROM sound_orders WHERE id = ?', oid);
      throw error;
    }
  }));
  // Un fondateur simule l'achat : payé tout de suite, sans argent, livré à son adresse.
  app.post('/api/vitrine/:id/simulate', (req, res) => {
    const founder = optionalUser(req);
    if (founder?.role !== 'founder') throw new HttpError(403, 'Réservé aux fondateurs.');
    rateLimit(`vitrine-simulate:${founder.id}`, 60);
    const { token, oid } = newOrder(buyable(req), 'simulation', true);
    markPaid(get('SELECT * FROM sound_orders WHERE id = ?', oid), founder.email, founder.name || '');
    res.json({ url: `${config.siteUrl}/achat?o=${token}` });
  });
  // L'original sans filigrane : seulement par le lien d'une commande payée.
  app.get('/api/vitrine/orders/:token/original', (req, res, next) => {
    const o = get('SELECT * FROM sound_orders WHERE token = ? AND visual_id IS NOT NULL', str(req.params.token, 64));
    if (!o) throw new HttpError(404, 'Commande introuvable.');
    if (o.status !== 'paid') throw new HttpError(403, 'La commande n\'est pas encore payée.');
    const v = get('SELECT * FROM vitrine_visuals WHERE id = ?', o.visual_id);
    if (!v) throw new HttpError(404, 'Ce visuel n\'est plus disponible : écris au graphiste.');
    res.set({ 'Content-Type': `image/${v.format}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    res.attachment(`${o.track_title.replace(/[\\/:*?"<>|]/g, '')}.${FORMATS[v.format]}`);
    res.sendFile(path.join(vitrineDir, v.original), (error) => error && next(new HttpError(404, 'Introuvable.')));
  });
}

// Titre, description, prix (centimes ; 0 : pas en vente) et vente unique, vérifiés.
function visualFields(b, v = {}) {
  const price = b.price !== undefined && b.price !== '' ? Math.round(Number(b.price)) : v.price ?? 0;
  if (!Number.isInteger(price) || (price !== 0 && (price < 100 || price > 100000_00))) throw new HttpError(400, 'Le prix va de 1 € à 100 000 € (0 : pas en vente).');
  const flag = (x) => x === true || x === 1 || x === '1' || x === 'true';
  return { title: b.title !== undefined ? str(b.title, 100) : v.title, description: b.description !== undefined ? String(b.description).replace(/\r\n?/g, '\n').trim().slice(0, 1000) : v.description ?? '',
    price, unique: b.unique !== undefined ? (flag(b.unique) ? 1 : 0) : v.unique_sale ?? 0 };
}
