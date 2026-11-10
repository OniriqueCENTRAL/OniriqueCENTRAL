// Fiches plugins à leur propre adresse et sitemap, sur une base jetable : node test/shoppages.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-shoppages-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test' });

const { createApp } = await import('../src/app.js');
const { run } = await import('../src/db.js');
const add = (slug, extra = {}) => run(`INSERT INTO products (id, slug, name, tagline, description, price_cents, published, founders_only, created_at)
  VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?)`, slug, `NOM ${slug} <b>`, 'Une phrase.', 'Une longue description "piégée".', 4999, extra.published ?? 1, extra.founders ?? 0, Date.now());
add('verb'); add('cache', { published: 0 }); add('fondateurs', { founders: 1 });

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const r = await fetch(`${base}/boutique/verb`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('<base href="/">') && html.indexOf('<base href="/">') < html.indexOf('<script'), 'base avant les scripts');
  assert.match(html, /<title>NOM verb &lt;b&gt; — plugin audio · ONIRIQUE<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/site.test\/boutique\/verb">/);
  assert.match(html, /"price":"49.99"/);
  assert.match(html, /&quot;piégée&quot;/);
  assert.doesNotMatch(html, /href="#/);
  for (const slug of ['cache', 'fondateurs', 'inconnu']) assert.equal((await fetch(`${base}/boutique/${slug}`)).status, 404, slug);
  const sm = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.match(sm, /<loc>https:\/\/site.test\/boutique\/verb<\/loc><lastmod>\d{4}-\d\d-\d\d<\/lastmod><\/url>\n<\/urlset>/);
  assert.doesNotMatch(sm, /cache|fondateurs/);
  console.log('  ok  fiches plugins et sitemap');
} finally { server.close(); }
