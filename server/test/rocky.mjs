// ROCKY, le chatbot du site, face à une fausse API Claude locale : node test/rocky.mjs
// (node test/rocky.mjs gemini : face à une fausse API Gemini)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const GEMINI = process.argv[2] === 'gemini';
let seen;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const parsed = JSON.parse(body);
    const system = GEMINI ? parsed.systemInstruction.parts[0].text : parsed.system;
    // Une demande de traduction de fiches (traductions.js) : chaque phrase revient « en anglais », entre balises de code.
    let text = 'Bien bien bien, ami !';
    if (/Tu traduis/.test(system)) {
      const input = JSON.parse(GEMINI ? parsed.contents[0].parts[0].text : parsed.messages[0].content);
      text = '```json\n' + JSON.stringify(Object.fromEntries(Object.entries(input).map(([n, fr]) => [n, `EN ${fr}`]))) + '\n```';
    } else seen = { url: req.url, headers: req.headers, body: parsed };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(GEMINI ? { candidates: [{ content: { parts: [{ text: 'pensée', thought: true }, { text }] } }] }
      : { content: [{ type: 'text', text }] }));
  });
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-rocky-')), PAYMENTS_MODE: 'demo', PORT: '0',
  ADMIN_EMAIL: '', ADMIN_PASSWORD: '', FOUNDER_EMAILS: '', ANTHROPIC_API_KEY: 'cle-test', ANTHROPIC_API: `http://127.0.0.1:${fake.address().port}`,
  ...(GEMINI ? { GEMINI_API_KEY: 'gem-test', GEMINI_API: `http://127.0.0.1:${fake.address().port}`, GEMINI_MODEL: 'modele' } : {}) });
const { createApp } = await import('../src/app.js');
const { run } = await import('../src/db.js');
const { translateMissing, missingPieces } = await import('../src/traductions.js');
// Trois plugins en base : un connu de rocky-conseils.js, un tout nouveau (sans fiche conseil), un réservé aux fondateurs.
const addProduct = (slug, name, tagline, description, price, foundersOnly = 0, category = '') => run(
  'INSERT INTO products (slug, name, tagline, description, price_cents, published, founders_only, category, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0)',
  slug, name, tagline, description, price, foundersOnly, category);
addProduct('onirique-eclipse', 'ONIRIQUE ECLIPSE', 'Égaliseur de mastering.', 'Un EQ de mastering.', 12999, 0, 'master');
addProduct('nouveau-plugin', 'ONIRIQUE NOUVEAU', 'Un plugin tout neuf.', 'Premier paragraphe du nouveau.\n\nDeuxième paragraphe.', 0);
addProduct('secret', 'ONIRIQUE SECRET', 'Réservé.', 'Pour les fondateurs.', 100, 1);
const { cleanMessages, faqText } = await import('../src/rocky.js');
// ROCKY lit la FAQ de la page d'accueil : chaque question avec sa réponse, sans balises.
const faq = faqText(fs.readFileSync(new URL('../../site/onirique.html', import.meta.url), 'utf8'));
assert.ok(faq.split('\n\n').length >= 25, 'la FAQ doit compter au moins 25 questions');
assert.match(faq, /^Q : Avec quels logiciels[^\n]*\nR : Avec tout DAW/);
assert.ok(!/<[a-z]/.test(faq), 'pas de balise HTML dans le texte donné à ROCKY');
const server = createApp().listen(0);
const ask = (messages) => fetch(`http://127.0.0.1:${server.address().port}/api/rocky`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });

// Nettoyage : rôles inconnus retirés, messages du même rôle fusionnés, début par l'utilisateur, fin par l'utilisateur.
assert.deepEqual(cleanMessages([{ role: 'assistant', content: 'salut' }, { role: 'user', content: 'a' }, { role: 'system', content: 'x' }, { role: 'user', content: 'b' }]),
  [{ role: 'user', content: 'a\nb' }]);
assert.equal(cleanMessages([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]), null);
assert.equal(cleanMessages('nope'), null);
assert.equal(cleanMessages([{ role: 'user', content: 'x'.repeat(5000) }])[0].content.length, 1000);

let r = await ask([{ role: 'user', content: 'Tu fais quoi ?' }]);
assert.equal(r.status, 200);
assert.equal((await r.json()).reply, 'Bien bien bien, ami !');
const system = GEMINI ? seen.body.systemInstruction.parts[0].text : seen.body.system;
if (GEMINI) {
  assert.equal(seen.url, '/v1beta/models/modele:generateContent');
  assert.equal(seen.headers['x-goog-api-key'], 'gem-test');
  assert.deepEqual(seen.body.contents, [{ role: 'user', parts: [{ text: 'Tu fais quoi ?' }] }]);
} else assert.equal(seen.headers['x-api-key'], 'cle-test');
assert.match(system, /ROCKY/);
assert.match(system, /Outils gratuits/); // llms.txt est bien dans ce qu'il sait
// Les plugins viennent de la base : prix, catégorie, lien de la fiche, fiche conseil s'il en a une, texte sinon.
assert.match(system, /### ONIRIQUE ECLIPSE \(Mastering, 129,99 €, essai gratuit 7 jours\)/);
assert.match(system, /https:\/\/onirique\.store\/boutique\/onirique-eclipse/);
assert.match(system, /Ne fait pas : Pas un limiteur/);
assert.match(system, /### ONIRIQUE NOUVEAU \([^)]*gratuit\)[\s\S]*?Présentation : Premier paragraphe/);
assert.ok(!system.includes('ONIRIQUE SECRET'), 'un plugin réservé aux fondateurs reste caché à ROCKY');
assert.ok(!system.includes('{PLUGINS}'));

// Les fiches sans traduction anglaise sont traduites par l'IA, gardées, et servies au site et à l'application.
assert.ok(missingPieces().includes('Un plugin tout neuf.'));
assert.ok(await translateMissing() >= 4);
assert.ok(!missingPieces().includes('Un plugin tout neuf.'));
assert.equal(await translateMissing(), 0); // rien de nouveau : aucun appel
const js = await (await fetch(`http://127.0.0.1:${server.address().port}/api/i18n-fiches.js`)).text();
assert.match(js, /^window\.ONIRIQUE_EN_FICHES = \{/);
assert.match(js, /"Deuxième paragraphe\.":"EN Deuxième paragraphe\."/);
const catalog = await (await fetch(`http://127.0.0.1:${server.address().port}/api/catalog`)).json();
assert.equal(catalog.en['Un plugin tout neuf.'], 'EN Un plugin tout neuf.');
r = await ask([]);
assert.equal(r.status, 400);

// Le mini ROCKY de l'application : animé par défaut, coupé ou remis pour le compte dans les Paramètres.
const base = `http://127.0.0.1:${server.address().port}/api`;
const json = { 'Content-Type': 'application/json' };
const { token } = await (await fetch(`${base}/auth/register`, { method: 'POST', headers: json,
  body: JSON.stringify({ email: 'rocky@test.local', password: 'motdepasse1', name: 'Nov' }) })).json();
const auth = { ...json, Authorization: `Bearer ${token}` };
const me = async () => (await (await fetch(`${base}/me`, { headers: auth })).json()).user;
assert.equal((await me()).rocky, true);
await fetch(`${base}/me/profile`, { method: 'POST', headers: auth, body: JSON.stringify({ rocky: false }) });
assert.equal((await me()).rocky, false);
assert.equal((await me()).name, 'Nov'); // le nom n'a pas bougé
await fetch(`${base}/me/profile`, { method: 'POST', headers: auth, body: JSON.stringify({ rocky: 'non' }) });
assert.equal((await me()).rocky, false); // seul un vrai/faux change le réglage
await fetch(`${base}/me/profile`, { method: 'POST', headers: auth, body: JSON.stringify({ rocky: true }) });
assert.equal((await me()).rocky, true);

console.log(`  ok  rocky${GEMINI ? ' (gemini)' : ''}`);
server.close();
fake.close();
