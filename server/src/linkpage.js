// Page de liens des fondateurs (onirique.store/l/<pseudo>), façon « link in bio » : profil, liens vers leurs
// plateformes et apparence entièrement réglable. Le serveur garde la page telle que l'éditeur l'envoie, une fois
// chaque champ vérifié : rien d'autre que des couleurs, des choix connus, du texte et des liens http(s), mailto ou tel.
import { get, run, now } from './db.js';
import { HttpError, rateLimit } from './auth.js';

export const HANDLE = /^[a-z0-9][a-z0-9._-]{1,29}$/;
const RESERVED = new Set(['admin', 'api', 'assets', 'onirique', 'compte', 'boutique', 'support', 'www', 'l', 'liens', 'central']);
export const FONTS = ['unbounded', 'grenze', 'hanken', 'mono', 'system', 'serif'];
const MAX_LINKS = 40;

const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const color = (value, fallback) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback);
const number = (value, min, max, fallback) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback);

/** Un lien ouvrable : http(s), mailto ou tel. Tout le reste (javascript:, data:…) est refusé. */
export function safeUrl(value) {
  const text = str(value, 2000);
  if (!text) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

/** La page envoyée par l'éditeur, champ par champ ; une valeur inconnue reprend celle par défaut. */
export function cleanPage(input = {}) {
  const t = input.theme || {};
  const b = t.button || {};
  const links = (Array.isArray(input.links) ? input.links : []).slice(0, MAX_LINKS).map((l, i) => ({
    id: str(l?.id, 20).replace(/[^\w-]/g, '') || `l${i}`,
    label: str(l?.label, 80),
    url: safeUrl(l?.url),
    kind: pick(l?.kind, ['button', 'icon'], 'button'),
    on: l?.on !== false,
  })).filter((l) => l.url);
  return {
    name: str(input.name, 60),
    bio: str(input.bio, 300),
    theme: {
      bg: pick(t.bg, ['color', 'gradient', 'image'], 'gradient'),
      bg1: color(t.bg1, '#0d0809'),
      bg2: color(t.bg2, '#4a0d16'),
      angle: number(t.angle, 0, 360, 160),
      dim: number(t.dim, 0, 90, 45),
      text: color(t.text, '#f6eeee'),
      font: pick(t.font, FONTS, 'hanken'),
      titleFont: pick(t.titleFont, FONTS, 'unbounded'),
      avatarShape: pick(t.avatarShape, ['circle', 'square'], 'circle'),
      button: {
        style: pick(b.style, ['fill', 'outline', 'glass'], 'glass'),
        shape: pick(b.shape, ['square', 'round', 'pill'], 'pill'),
        color: color(b.color, '#e23444'),
        text: color(b.text, '#ffffff'),
        shadow: b.shadow !== false,
      },
    },
    links,
  };
}

const media = (name) => (name ? `/api/media/${name}` : null);
const view = (row) => ({ handle: row.handle, page: JSON.parse(row.data), avatar: media(row.avatar), background: media(row.background) });

/** Les routes : la page publique, et l'éditeur réservé aux fondateurs. */
export function mountLinkPages(app, { requireUser, receiveImage, removeMedia, wrap }) {
  const founderOnly = (req) => { if (req.user.role !== 'founder') throw new HttpError(403, 'La page de liens est réservée aux fondateurs.'); };
  const own = (userId) => get('SELECT * FROM link_pages WHERE user_id = ?', userId);

  // La page publique : seulement tant que son auteur est fondateur.
  app.get('/api/links/:handle', (req, res) => {
    const row = get(`SELECT p.* FROM link_pages p JOIN users u ON u.id = p.user_id WHERE p.handle = ? AND u.role = 'founder'`,
      String(req.params.handle).toLowerCase());
    if (!row) throw new HttpError(404, 'Cette page de liens n\'existe pas.');
    res.set('Cache-Control', 'public, max-age=30');
    res.json(view(row));
  });

  app.get('/api/me/links', requireUser, (req, res) => {
    founderOnly(req);
    const row = own(req.user.id);
    res.json(row ? view(row) : { handle: null, page: cleanPage({ name: req.user.engineer_name || req.user.name || '' }), avatar: null, background: null });
  });

  app.put('/api/me/links', requireUser, (req, res) => {
    founderOnly(req);
    rateLimit(`links:${req.user.id}`, 120);
    const handle = str(req.body.handle, 30).toLowerCase();
    if (!HANDLE.test(handle)) throw new HttpError(400, 'Adresse de la page : 2 à 30 caractères, lettres minuscules, chiffres, point, tiret ou tiret bas.');
    if (RESERVED.has(handle)) throw new HttpError(409, 'Cette adresse est réservée : choisissez-en une autre.');
    const taken = get('SELECT user_id FROM link_pages WHERE handle = ?', handle);
    if (taken && taken.user_id !== req.user.id) throw new HttpError(409, 'Cette adresse est déjà prise : choisissez-en une autre.');
    const page = cleanPage(req.body.page);
    run(`INSERT INTO link_pages (user_id, handle, data, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET handle = excluded.handle, data = excluded.data, updated_at = excluded.updated_at`,
      req.user.id, handle, JSON.stringify(page), now());
    res.json(view(own(req.user.id)));
  });

  // La photo et l'image de fond de la page : la page doit déjà exister (enregistrée une fois).
  const kindOf = (req) => {
    const kind = req.query.kind === 'background' ? 'background' : req.query.kind === 'avatar' ? 'avatar' : null;
    if (!kind) throw new HttpError(400, 'Image inconnue.');
    if (!own(req.user.id)) throw new HttpError(400, "Enregistrez d'abord la page, puis ajoutez l'image.");
    return kind;
  };
  app.put('/api/me/links/image', requireUser, wrap(async (req, res) => {
    founderOnly(req);
    rateLimit(`links-image:${req.user.id}`, 30);
    const kind = kindOf(req);
    const name = await receiveImage(req, kind === 'background' ? 5 * 1024 * 1024 : 2 * 1024 * 1024);
    const before = own(req.user.id)[kind];
    run(`UPDATE link_pages SET ${kind} = ? WHERE user_id = ?`, name, req.user.id);
    if (before) removeMedia(before);
    res.json(view(own(req.user.id)));
  }));
  app.delete('/api/me/links/image', requireUser, (req, res) => {
    founderOnly(req);
    const kind = kindOf(req);
    const before = own(req.user.id)[kind];
    run(`UPDATE link_pages SET ${kind} = NULL WHERE user_id = ?`, req.user.id);
    if (before) removeMedia(before);
    res.json(view(own(req.user.id)));
  });
}
