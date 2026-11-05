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
    seen = { url: req.url, headers: req.headers, body: JSON.parse(body) };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(GEMINI ? { candidates: [{ content: { parts: [{ text: 'pensée', thought: true }, { text: 'Bien bien bien, ami !' }] } }] }
      : { content: [{ type: 'text', text: 'Bien bien bien, ami !' }] }));
  });
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-rocky-')), PAYMENTS_MODE: 'demo', PORT: '0',
  ADMIN_EMAIL: '', ADMIN_PASSWORD: '', FOUNDER_EMAILS: '', ANTHROPIC_API_KEY: 'cle-test', ANTHROPIC_API: `http://127.0.0.1:${fake.address().port}`,
  ...(GEMINI ? { GEMINI_API_KEY: 'gem-test', GEMINI_API: `http://127.0.0.1:${fake.address().port}`, GEMINI_MODEL: 'modele' } : {}) });
const { createApp } = await import('../src/app.js');
const { cleanMessages } = await import('../src/rocky.js');
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
assert.match(system, /VocalBox/); // llms.txt est bien dans ce qu'il sait
r = await ask([]);
assert.equal(r.status, 400);

console.log(`  ok  rocky${GEMINI ? ' (gemini)' : ''}`);
server.close();
fake.close();
