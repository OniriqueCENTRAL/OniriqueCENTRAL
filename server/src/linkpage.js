// Page de liens des membres ONIRIQUE et des fondateurs (onirique.store/l/<pseudo>), façon « link in bio » : profil, liens vers leurs
// plateformes et apparence entièrement réglable. Le serveur garde la page telle que l'éditeur l'envoie, une fois
// chaque champ vérifié : rien d'autre que des couleurs, des choix connus, du texte et des liens http(s), mailto ou tel.
// Il sert aussi la page publique elle-même, avec son titre, sa description et son image d'aperçu (lues par Instagram,
// WhatsApp, iMessage… qui n'exécutent pas le JavaScript), et compte les visites et les clics.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { config } from './config.js';
import { all, get, run, now } from './db.js';
import { HttpError, rateLimit, rolesWith } from './auth.js';
import { alternatives, ORDER } from './music.js';

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
  const links = (Array.isArray(input.links) ? input.links : []).slice(0, MAX_LINKS).map((l, i) => {
    const link = {
      id: str(l?.id, 20).replace(/[^\w-]/g, '') || `l${i}`,
      label: str(l?.label, 80),
      url: safeUrl(l?.url),
      kind: pick(l?.kind, ['button', 'icon', 'music'], 'button'), // music : le visiteur choisit sa plateforme d'écoute
      on: l?.on !== false,
    };
    // Lien « Musique » : les liens du fondateur sur les autres plateformes, qui passent avant la recherche automatique.
    const custom = link.kind === 'music' ? Object.fromEntries(ORDER.map((id) => [id, safeUrl(l?.custom?.[id])]).filter(([, url]) => url)) : {};
    return Object.keys(custom).length ? { ...link, custom } : link;
  }).filter((l) => l.url);
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
const publicRow = (handle) => get(`SELECT p.* FROM link_pages p JOIN users u ON u.id = p.user_id WHERE p.handle = ? AND u.role IN (${rolesWith('links').map((r) => `'${r}'`).join(', ')})`,
  String(handle).toLowerCase());

//==============================================================================
//  Statistiques : une ligne par lien et par jour ; link_id '' compte les visites de la page.
//==============================================================================
const BOTS = /bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|whatsapp|telegram|discord|slack|embedly|preview|skype|vkshare|pinterest|headless|lighthouse|curl|wget/i;
const recent = new Map(); // une visite ou un clic par adresse IP, compté une fois par fenêtre
setInterval(() => { const t = now(); for (const [key, until] of recent) if (until < t) recent.delete(key); }, 60_000).unref();
const day = (ms = now()) => new Date(ms).toISOString().slice(0, 10);

function count(userId, linkId, key, windowMs) {
  if (recent.get(key) > now()) return;
  recent.set(key, now() + windowMs);
  run(`INSERT INTO link_stats (user_id, link_id, day, n) VALUES (?, ?, ?, 1)
       ON CONFLICT(user_id, link_id, day) DO UPDATE SET n = n + 1`, userId, linkId, day());
}

/** Les chiffres des `days` derniers jours, aujourd'hui compris. */
export function linkStats(userId, days) {
  const since = day(now() - (days - 1) * 86_400_000);
  const rows = all('SELECT link_id, day, n FROM link_stats WHERE user_id = ? AND day >= ?', userId, since);
  const daily = Array.from({ length: days }, (_, i) => ({ day: day(now() - (days - 1 - i) * 86_400_000), views: 0, clicks: 0 }));
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const links = {};
  for (const r of rows) {
    const d = byDay.get(r.day);
    if (!d) continue;
    if (r.link_id) { d.clicks += r.n; links[r.link_id] = (links[r.link_id] || 0) + r.n; } else d.views += r.n;
  }
  return { days, views: daily.reduce((s, d) => s + d.views, 0), clicks: daily.reduce((s, d) => s + d.clicks, 0), daily, links };
}

//==============================================================================
//  Image d'aperçu (1200 × 630) : les couleurs, la photo, le nom et la bio de la page, aux polices de la charte.
//==============================================================================
const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');
const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

export async function textImage(text, font, fontfile, size, fill, width, alpha = '100%') {
  const { data, info } = await sharp({ text: { text: `<span foreground="${fill}" fgalpha="${alpha}">${escapeXml(text)}</span>`, font: `${font} ${size}`,
    fontfile: path.join(FONT_DIR, fontfile), width, rgba: true, wrap: 'word' } }).png().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function previewImage(row) {
  const { page } = view(row);
  const t = page.theme;
  const W = 1200, H = 630;
  const file = (name) => (name ? path.join(config.mediaDir, path.basename(name)) : null);
  // Le fond : l'image de la page (assombrie comme sur la page), sinon sa couleur ou son dégradé.
  // Une image illisible est laissée de côté : l'aperçu se fait quand même, avec la couleur ou sans la photo.
  const readable = (promise) => promise.catch(() => null);
  let base = t.bg === 'image' && row.background && fs.existsSync(file(row.background))
    ? await readable(sharp(file(row.background)).resize(W, H, { fit: 'cover' })
      .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}"><rect width="100%" height="100%" fill="#000" fill-opacity="${t.dim / 100}"/></svg>`) }])
      .png().toBuffer())
    : null;
  if (!base) {
    const a = (t.angle * Math.PI) / 180; // angle CSS : 0° vers le haut, dans le sens des aiguilles
    const [x1, y1, x2, y2] = [0.5 - Math.sin(a) / 2, 0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2, 0.5 - Math.cos(a) / 2];
    const second = t.bg === 'gradient' ? t.bg2 : t.bg1;
    base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
      <stop offset="0" stop-color="${t.bg1}"/><stop offset="1" stop-color="${second}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  }
  const layers = [];
  let left = 90;
  if (row.avatar && fs.existsSync(file(row.avatar))) {
    const size = 260;
    const mask = Buffer.from(t.avatarShape === 'square'
      ? `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="44" fill="#fff"/></svg>`
      : `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
    const avatar = await readable(sharp(file(row.avatar)).resize(size, size, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer());
    if (avatar) {
      layers.push({ input: avatar, left, top: Math.round((H - size) / 2) });
      left += size + 70;
    }
  }
  const width = W - left - 80;
  const name = await textImage(page.name || row.handle, 'Unbounded', 'Unbounded800.ttf', page.name.length > 18 ? 46 : 60, t.text, width);
  const bio = page.bio ? await textImage(page.bio.split('\n').slice(0, 3).join('\n').slice(0, 140), 'Hanken Grotesk', 'HankenGrotesk600.ttf', 26, t.text, width) : null;
  const address = await textImage(`onirique.store/l/${row.handle}`, 'JetBrains Mono', 'JetBrainsMono500.ttf', 22, t.button.color, width);
  const block = name.height + (bio ? 26 + Math.min(bio.height, 150) : 0) + 34 + address.height;
  let top = Math.max(60, Math.round((H - block) / 2));
  layers.push({ input: name.data, left, top });
  top += name.height + 26;
  if (bio) {
    layers.push({ input: bio.height > 150 ? await sharp(bio.data).extract({ left: 0, top: 0, width: bio.width, height: 150 }).png().toBuffer() : bio.data, left, top });
    top += Math.min(bio.height, 150) + 34;
  } else top += 8;
  layers.push({ input: address.data, left, top: Math.min(top, H - address.height - 40) });
  const mark = await textImage('✦ ONIRIQUE', 'JetBrains Mono', 'JetBrainsMono500.ttf', 18, t.text, 300, '60%');
  layers.push({ input: mark.data, left: W - mark.width - 50, top: H - mark.height - 40 });
  return sharp(base).composite(layers).png({ compressionLevel: 9 }).toBuffer();
}

//==============================================================================
//  La page publique, servie avec ses balises de partage (titre, description, image).
//==============================================================================
const escapeHtml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
const previewKey = (row) => crypto.createHash('sha1').update(`${row.data}|${row.avatar}|${row.background}|${row.handle}`).digest('hex').slice(0, 12);

function pageHtml(row) {
  const data = row && view(row);
  const site = config.siteUrl;
  const title = data ? `${data.page.name || data.handle} · ONIRIQUE` : 'ONIRIQUE';
  const description = data ? (data.page.bio || `Tous les liens de ${data.page.name || data.handle} : musique, réseaux, contact.`).replace(/\s+/g, ' ').slice(0, 200) : '';
  const url = data ? `${site}/l/${data.handle}` : site;
  const image = data ? `${site}/api/links/${data.handle}/apercu.png?v=${previewKey(row)}` : '';
  const json = JSON.stringify(data || null).replace(/</g, '\\u003c');
  const meta = data ? `
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="ONIRIQUE">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeHtml(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">` : '';
  const bg = data ? data.page.theme.bg1 : '#0d0809';
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>${meta}
<meta name="robots" content="${data ? 'index, follow' : 'noindex'}">
<meta name="theme-color" content="${bg}">
<link rel="icon" type="image/png" href="/assets/favicon.png">
<link rel="stylesheet" href="/assets/fonts.css">
<style>
html, body { margin: 0; min-height: 100%; background: ${bg}; }
body { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
#page { flex: 1; display: flex; flex-direction: column; }
#page > .lp { flex: 1; }
.missing { margin: auto; padding: 40px 20px; text-align: center; color: #f6eeee; font: 500 16px/1.5 'Hanken Grotesk', sans-serif; }
.missing a { color: #e23444; }
</style>
</head>
<body>
<main id="page">${data ? '' : '<p class="missing">Cette page de liens n\'existe pas, ou plus.<br><a href="https://onirique.store">onirique.store</a></p>'}</main>
<script src="/assets/deeplink.js?v=3"></script>
<script src="/assets/linkpage.js?v=4"></script>
<script>
const data = ${json};
if (data) OniriqueLinkPage.render(document.getElementById("page"), data.page, data, false, data.handle);
</script>
</body>
</html>`;
}

/** Les routes : la page publique (et son image), l'éditeur et les statistiques réservés aux fondateurs. */
export function mountLinkPages(app, { requireUser, receiveImage, removeMedia, wrap }) {
  const founderOnly = (req) => { if (!rolesWith('links').includes(req.user.role)) throw new HttpError(403, 'La page de liens est réservée aux membres ONIRIQUE.'); };
  const own = (userId) => get('SELECT * FROM link_pages WHERE user_id = ?', userId);

  // La page publique elle-même. Une visite par personne et par demi-heure, sans les robots (aperçus des messageries).
  app.get('/l/:handle', (req, res) => {
    const row = publicRow(req.params.handle);
    if (row && !BOTS.test(req.get('user-agent') || '')) count(row.user_id, '', `v:${req.ip}:${row.user_id}`, 30 * 60_000);
    res.status(row ? 200 : 404).set('Cache-Control', 'no-cache').type('html').send(pageHtml(row));
  });

  // L'image d'aperçu : fabriquée une fois par version de la page, puis gardée.
  app.get('/api/links/:handle/apercu.png', wrap(async (req, res) => {
    const row = publicRow(req.params.handle);
    if (!row) throw new HttpError(404, "Cette page de liens n'existe pas.");
    const dir = path.join(config.mediaDir, 'apercus');
    const target = path.join(dir, `${row.user_id}-${previewKey(row)}.png`);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(dir, { recursive: true });
      for (const old of fs.readdirSync(dir)) if (old.startsWith(`${row.user_id}-`)) fs.rmSync(path.join(dir, old), { force: true });
      fs.writeFileSync(target, await previewImage(row));
    }
    res.set('Cache-Control', 'public, max-age=86400').type('png').sendFile(target);
  }));

  // Les données de la page, pour l'éditeur et les essais.
  app.get('/api/links/:handle', (req, res) => {
    const row = publicRow(req.params.handle);
    if (!row) throw new HttpError(404, 'Cette page de liens n\'existe pas.');
    res.set('Cache-Control', 'public, max-age=30');
    res.json(view(row));
  });

  // Un clic sur un lien de la page (navigator.sendBeacon) : compté une fois par personne et par minute.
  app.post('/api/links/:handle/click', (req, res) => {
    rateLimit(`link-click:${req.ip}`, 300);
    const row = publicRow(req.params.handle);
    const id = str(req.body?.id, 20);
    if (row && id && JSON.parse(row.data).links.some((l) => l.id === id) && !BOTS.test(req.get('user-agent') || '')) {
      count(row.user_id, id, `c:${req.ip}:${row.user_id}:${id}`, 60_000);
    }
    res.status(204).end();
  });

  app.get('/api/me/links/stats', requireUser, (req, res) => {
    founderOnly(req);
    res.json(linkStats(req.user.id, [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30));
  });

  app.get('/api/me/links', requireUser, (req, res) => {
    founderOnly(req);
    const row = own(req.user.id);
    res.json(row ? view(row) : { handle: null, page: cleanPage({ name: req.user.engineer_name || req.user.name || '' }), avatar: null, background: null });
  });

  /** Les liens « Musique » : leurs plateformes, reprises de la page enregistrée si le lien n'a pas changé, sinon cherchées. */
  async function withMusic(page, before) {
    const known = new Map((before?.links || []).filter((l) => l.music).map((l) => [l.url, l.music]));
    let lookups = 0;
    await Promise.all(page.links.filter((l) => l.kind === 'music').map(async (link) => {
      if (known.has(link.url)) { link.music = known.get(link.url); return; }
      if (++lookups > 10) return; // shortcut: 10 recherches par enregistrement, les suivantes au prochain enregistrement
      const found = await alternatives(link.url).catch(() => null);
      if (!found) return;
      const platforms = found.platforms.map((p) => ({ id: p.id, url: safeUrl(p.url), exact: !!p.exact })).filter((p) => p.url);
      link.music = { type: found.type, title: str(found.title, 120), artist: str(found.artist, 120), cover: found.cover, platforms };
    }));
    return page;
  }

  app.put('/api/me/links', requireUser, wrap(async (req, res) => {
    founderOnly(req);
    rateLimit(`links:${req.user.id}`, 120);
    const handle = str(req.body.handle, 30).toLowerCase();
    if (!HANDLE.test(handle)) throw new HttpError(400, 'Adresse de la page : 2 à 30 caractères, lettres minuscules, chiffres, point, tiret ou tiret bas.');
    if (RESERVED.has(handle)) throw new HttpError(409, 'Cette adresse est réservée : choisissez-en une autre.');
    const taken = get('SELECT user_id FROM link_pages WHERE handle = ?', handle);
    if (taken && taken.user_id !== req.user.id) throw new HttpError(409, 'Cette adresse est déjà prise : choisissez-en une autre.');
    const previous = own(req.user.id);
    const page = await withMusic(cleanPage(req.body.page), previous && JSON.parse(previous.data));
    run(`INSERT INTO link_pages (user_id, handle, data, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET handle = excluded.handle, data = excluded.data, updated_at = excluded.updated_at`,
      req.user.id, handle, JSON.stringify(page), now());
    res.json(view(own(req.user.id)));
  }));

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
