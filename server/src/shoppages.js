// Une vraie adresse par plugin (onirique.store/boutique/<slug>) : la page de la boutique, servie avec le titre, la
// description, l'aperçu et les données produit de ce plugin, pour que chaque plugin existe dans les moteurs de recherche.
// Et le sitemap : les pages du site plus une ligne par plugin en vente.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { all, get } from './db.js';

const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };
const readSite = (name) => fs.readFileSync(path.join(config.siteDir, name), 'utf8');
const visible = () => all('SELECT * FROM products WHERE published = 1 AND founders_only = 0 ORDER BY position, created_at');

/** La page d'un plugin : boutique.html avec sa propre tête (titre, description, canonique, aperçu, JSON-LD). */
export function productPage(p, html = readSite('boutique.html')) {
  const url = `${config.siteUrl}/boutique/${encodeURIComponent(p.slug)}`;
  const title = `${p.name} — plugin audio · ONIRIQUE`;
  const desc = clip(`${p.tagline || ''} ${p.description || ''}`, 158);
  const image = p.image ? `${config.siteUrl}/api/media/${p.image}` : `${config.siteUrl}/assets/og-image.png`;
  const mac = !!get(`SELECT 1 FROM versions WHERE product_id = ? AND platform = 'mac'`, p.id);
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'SoftwareApplication', name: p.name, url, image, description: clip(p.description || p.tagline, 500),
      applicationCategory: 'MultimediaApplication', applicationSubCategory: 'Plugin audio VST3',
      operatingSystem: mac ? 'Windows 10, Windows 11, macOS 10.15+' : 'Windows 10, Windows 11 (64 bits)',
      offers: { '@type': 'Offer', price: ((p.price_cents || 0) / 100).toFixed(2), priceCurrency: 'EUR', availability: 'https://schema.org/InStock', url },
      publisher: { '@id': `${config.siteUrl}/#org` } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${config.siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: 'Boutique', item: `${config.siteUrl}/boutique` },
      { '@type': 'ListItem', position: 3, name: p.name, item: url }] },
  ] };
  const head = `<base href="/">\n<title>${esc(title)}</title>`;
  return html
    .replace(/<title>[^<]*<\/title>/, head)
    .replace(/(<meta name="description" content=")[^"]*"/, `$1${esc(desc)}"`)
    .replace(/(<link rel="canonical" href=")[^"]*"/, `$1${esc(url)}"`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${esc(title)}"`)
    .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${esc(desc)}"`)
    .replace(/(<meta property="og:url" content=")[^"]*"/, `$1${esc(url)}"`)
    .replace(/(<meta property="og:image" content=")[^"]*"/, `$1${esc(image)}"`)
    .replace(/\n<meta property="og:image:(width|height)"[^>]*>/g, '')
    // Avec <base href="/">, un lien « #ancre » partirait vers l'accueil : il garde la page du plugin.
    .replace(/href="#/g, `href="/boutique/${esc(encodeURIComponent(p.slug))}#`)
    .replace(/(<link rel="canonical"[^>]*>)/, `$1\n<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
}

export function sitemap(base = readSite('sitemap.xml')) {
  // lastmod : la dernière version publiée du plugin, sinon sa mise en vente.
  const day = (p) => new Date(get('SELECT MAX(created_at) AS t FROM versions WHERE product_id = ?', p.id)?.t || p.created_at).toISOString().slice(0, 10);
  const rows = visible().map((p) => `  <url><loc>${config.siteUrl}/boutique/${encodeURIComponent(p.slug)}</loc><lastmod>${day(p)}</lastmod></url>`).join('\n');
  return base.replace('</urlset>', `${rows}\n</urlset>`);
}

export function mountShopPages(app, { wrap }) {
  app.get('/boutique/:slug', wrap(async (req, res) => {
    const p = get('SELECT * FROM products WHERE slug = ? AND published = 1 AND founders_only = 0', String(req.params.slug));
    if (!p) return res.status(404).type('html').send(`<!doctype html><meta charset="utf-8"><title>Plugin introuvable — ONIRIQUE</title><p>Ce plugin n'existe pas ou n'est plus en vente. <a href="/boutique">Voir tous les plugins</a></p>`);
    res.set('Cache-Control', 'no-cache').type('html').send(productPage(p));
  }));
  app.get('/sitemap.xml', (_req, res) => res.set('Cache-Control', 'public, max-age=3600').type('application/xml').send(sitemap()));
}
