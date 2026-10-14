// Relève les textes français affichés par le site, l'application et le serveur, pour les traduire :
//
//   cd tools/i18n && npm install && node extract.mjs
//   → strings.json  { "texte français": ["fichier", …] }   et   missing.json (ceux qui n'ont pas encore de traduction)
//
// Les parties variables d'un texte (${…} d'un gabarit JavaScript) deviennent {} : la traduction garde les mêmes {}
// dans le même ordre (voir site/assets/i18n.js). Les traductions sont dans en/*.json (build.mjs les réunit).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const list = (dir, test) => fs.readdirSync(path.join(repo, dir)).filter(test).map((f) => `${dir}/${f}`);
const SOURCES = [
  ...list('site', (f) => f.endsWith('.html') && f !== 'index.html'),
  ...list('site/assets', (f) => f.endsWith('.js') && !/worker|i18n/.test(f)),
  'site/pages.mjs',
  ...list('app/renderer', (f) => f.endsWith('.js') && !/i18n/.test(f)),
  ...list('app/renderer/views', (f) => f.endsWith('.js')),
  'app/renderer/index.html',
  ...['main.js', 'installer.js', 'api.js', 'mac-update.js'].map((f) => `app/main/${f}`),
  ...list('server/src', (f) => f.endsWith('.js')),
];

const looksLikeText = (s) => {
  const t = s.trim();
  if (t.length < 2 || !/[a-zà-ÿ]/i.test(t)) return false;
  if (/^(https?:|mailto:|data:|\/|\.\/|#[\w-]+$)|^[\w-]+\.(html|js|css|png|jpg|webp|json|svg|mjs|zip|exe|dmg|vst3|wav|mp3)(\?.*)?$/i.test(t)) return false;
  if (/^[\w$.:-]+$/.test(t) && !/[à-ÿ]/i.test(t) && !/^[A-ZÀ-Ý][a-zà-ÿ]+$/.test(t) && !/^[A-ZÀ-Ý]{2,}$/.test(t)) return false; // identifiants
  if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|PRAGMA|BEGIN|COMMIT)\b/.test(t)) return false;
  if (/^[\d\s.,:;%+\-×x*/()#]+$/.test(t)) return false;
  if (/^(GET|POST|PUT|PATCH|DELETE)$|^(application|image|text|audio|video)\/|^utf-?8$/i.test(t)) return false;
  if (/^[\w-]+(\s*[:,]\s*[\w#.%()-]+)+;?$/.test(t) && !/\s[a-zà-ÿ]{3,}\s/.test(t)) return false; // CSS
  if (/^[\d.]+(px|em|rem|%|vh|vw|s|ms)(\s+[\d.-]+(px|em|rem|%)?)*$/.test(t)) return false;
  return true;
};

const found = new Map();
const add = (raw, file) => {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!looksLikeText(text)) return;
  if (!found.has(text)) found.set(text, new Set());
  found.get(text).add(file);
};

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&rarr;/g, '→').replace(/&larr;/g, '←').replace(/&times;/g, '×').replace(/&middot;/g, '·');

// Les morceaux de texte d'un fragment HTML (une page, ou une chaîne JavaScript qui en contient).
function fromHtml(html, file) {
  const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ');
  for (const m of body.matchAll(/\b(?:placeholder|title|aria-label|alt|content|data-tip)="([^"]*)"/g)) {
    if (!/^(width=|text\/html|noindex|dark|website|summary|#|https?:|light)/.test(m[1])) add(decode(m[1]), file);
  }
  for (const piece of body.replace(/<[^>]+>/g, '\u0000').split('\u0000')) add(decode(piece), file);
}

// Les chaînes d'un code JavaScript, lues par un vrai analyseur : les clés d'objet, les modules importés, les
// sélecteurs et les comparaisons ne sont pas des textes affichés.
const SKIP_CALLS = new Set(['querySelector', 'querySelectorAll', 'getElementById', 'getAttribute', 'setAttribute', 'removeAttribute',
  'addEventListener', 'removeEventListener', 'createElement', 'require', 'getItem', 'setItem', 'removeItem', 'matchMedia', 'prepare',
  'exec', 'join', 'split', 'replace', 'replaceAll', 'startsWith', 'endsWith', 'includes', 'indexOf', 'test', 'match', 'setProperty',
  'getPropertyValue', 'closest', 'matches', 'handle', 'invoke', 'on', 'once', 'emit', 'setHeader', 'toggle', 'contains', 'get', 'run', 'all',
  'call', 'api', 'request', 'fetch', 'getParameter', 'padStart', 'padEnd', 'toLocaleString', 'toLocaleDateString', 'Intl']);
function fromJs(code, file) {
  let ast = null;
  for (const sourceType of ['module', 'script']) {
    try { ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType, allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true }); break; } catch { /* essai suivant */ }
  }
  if (!ast) { console.error(`  ${file} : JavaScript illisible, ignoré`); return; }
  walk.fullAncestor(ast, (node, _state, ancestors) => {
    let text;
    if (node.type === 'Literal' && typeof node.value === 'string') text = node.value;
    else if (node.type === 'TemplateLiteral') text = node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('{}');
    else return;
    const parent = ancestors[ancestors.length - 2];
    if (!parent) return;
    if (parent.type === 'Property' && parent.key === node && !parent.computed) return;
    if (/Import|Export/.test(parent.type)) return;
    if (parent.type === 'MemberExpression' && parent.property === node) return;
    if (parent.type === 'BinaryExpression' && /^[!=]==?$/.test(parent.operator)) return;
    if (parent.type === 'SwitchCase') return;
    if (parent.type === 'CallExpression' && parent.arguments[0] === node) {
      const callee = parent.callee.type === 'MemberExpression' ? parent.callee.property?.name : parent.callee.name;
      if (callee && SKIP_CALLS.has(callee)) return;
    }
    if (/<[a-z][^>]*>/i.test(text)) fromHtml(text, file);
    else for (const part of text.split(/\n{2,}/)) add(part, file);
  });
}

for (const file of SOURCES) {
  const text = fs.readFileSync(path.join(repo, file), 'utf8');
  if (file.endsWith('.html')) {
    fromHtml(text, file);
    for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (m[1].trim()) fromJs(m[1], file);
  } else {
    fromJs(text, file);
  }
}

const done = {};
const enDir = path.join(here, 'en');
if (fs.existsSync(enDir)) for (const f of fs.readdirSync(enDir)) Object.assign(done, JSON.parse(fs.readFileSync(path.join(enDir, f), 'utf8')));
const out = Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b, 'fr')).map(([t, files]) => [t, [...files]]));
fs.writeFileSync(path.join(here, 'strings.json'), JSON.stringify(out, null, 1));
const missing = Object.keys(out).filter((t) => !(t in done));
fs.writeFileSync(path.join(here, 'missing.json'), JSON.stringify(missing, null, 1));
console.log(`${Object.keys(out).length} textes relevés, ${Object.keys(done).length} traduits, ${missing.length} à traduire`);
