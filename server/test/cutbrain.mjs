// L'arborescence de ONIRIQUE CUT (cutbrain.js), sur une base jetable : node test/cutbrain.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Une fausse IA du VPS (API d'Ollama) pour le superviseur : elle note la demande et répond ce qu'on lui dit.
import http from 'node:http';
const fake = { calls: [], reply: null };
const claude = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => { fake.calls.push({ headers: req.headers, body: JSON.parse(body) }); const [code, json] = fake.reply; res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); });
});
await new Promise((resolve) => claude.listen(0, resolve));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-cutbrain-'));
Object.assign(process.env, { CUT_AGENT_URL: `http://127.0.0.1:${claude.address().port}`, DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test' });

const { createApp } = await import('../src/app.js');
const { db, run, get, setSetting } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { cleanSettings, tally, proposalsOf, published, importCloudRecipes, importCloudContent, cleanContent, cleanThumbs, learnFromContent, STRONG } = await import('../src/cutbrain.js');

// ——— Les fonctions pures ———
assert.deepEqual(cleanSettings({ transition: 'flash', duration: 28, glow: 47, iColor: '#FF0000', rhyme: true, introLyrics: 'texte privé', artist: 'Moi',
  frame: 'nimporte', coldDrop: 'oui', rhymeColor: ['#ffffff'] }),
  { duration: 30, rhyme: true, glow: 50, iColor: '#ff0000', transition: 'flash' }, 'seules les feuilles, propres et arrondies');
assert.deepEqual(cleanSettings(null), {});
const rows = (n, settings, kind = 'export', changed = []) => Array.from({ length: n }, () => ({ kind, settings: JSON.stringify(settings), changed: JSON.stringify(changed) }));
const stats = tally([...rows(4, { transition: 'flash' }), ...rows(1, { transition: 'cut' }), ...rows(9, { transition: 'zoom' }, 'auto')]);
assert.equal(stats.transition.n, 5, 'les TikToks d’AUTOMATIQUE ne votent pas');
assert.deepEqual(proposalsOf({ leaves: {} }, stats), [{ key: 'transition', value: 'flash', from: 'cut', share: 0.8, n: 5 }], 'une proposition nette');
assert.deepEqual(proposalsOf({ leaves: {}, refused: { 'transition|"flash"': Date.now() } }, stats), [], 'refusée : pas avant 30 jours');
assert.deepEqual(proposalsOf({ leaves: { transition: { value: 'flash' } } }, stats), [], 'déjà le réglage de l’arbre');
assert.deepEqual(proposalsOf({ leaves: {} }, tally(rows(STRONG.tiktoks - 1, { transition: 'flash' }))), [], 'pas assez de TikToks');
// Une correction après AUTOMATIQUE pèse triple : 2 corrections vers « cut » battent 3 exports « flash ».
const fixed = tally([...rows(3, { transition: 'flash' }), ...rows(2, { transition: 'cut' }, 'correction', [{ key: 'transition', from: 'flash', to: 'cut' }])]);
assert.equal(fixed.transition.values['"cut"'], 6);
const tree = published({ leaves: { iSize: { value: 90, from: 'note', by: 'euhZ' } } }, fixed);
assert.equal(tree.values.iSize, 90, 'la leçon passe avant la recette');
assert.equal(tree.values.preset, 'drop', 'la recette du dépôt');
assert.equal(tree.branches.find((b) => b.id === 'film').leaves.find((l) => l.key === 'transition').stats.values[0].value, 'cut');
assert.deepEqual(tree.branches[0].leaves[0].buckets, [8, 15, 30, 60], 'les cases de la durée, pour le formulaire');

// ——— Le contenu : des mesures bornées, des textes coupés, des images JPEG seulement ———
assert.deepEqual(cleanContent({ sound: { bpm: 999, drop: 'oui', envelope: [2, -1, .5] }, text: { replica: '  Tu crois ?  ', evil: 'x' }, other: 1 }),
  { sound: { bpm: 260, envelope: [1, 0, .5] }, image: {}, text: { replica: 'Tu crois ?' } });
const jpg = 'data:image/jpeg;base64,' + Buffer.from('jpeg').toString('base64');
assert.deepEqual(cleanThumbs([jpg, 'data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)', jpg + 'A'.repeat(50_000)]), [jpg]);
const seen = learnFromContent([
  { kind: 'export', content: JSON.stringify({ sound: { bpm: 140, drop: true }, text: { replica: 'Tu me trahis encore ?', replicaLen: 9, caption: '« x » #undergroundmusic #harrypotter' }, image: { names: ['Harry Potter - Sirius.mp4'] } }) },
  { kind: 'export', content: JSON.stringify({ sound: { bpm: 150, drop: true }, text: { replica: 'La trahison, toujours.', replicaLen: 7, caption: '#undergroundmusic' }, image: { names: ['harry potter.mp4'] } }) },
  { kind: 'auto', content: JSON.stringify({ sound: { bpm: 90, drop: false } }) },
]);
assert.equal(seen.n, 2, 'AUTOMATIQUE ne s’apprend pas lui-même');
assert.equal(seen.dropShare, 1);
assert.equal(seen.replicaLen, 9);
assert.equal(seen.questions, .5);
assert.deepEqual(seen.tags[0], { value: '#undergroundmusic', n: 2 });
assert.deepEqual(seen.films.slice(0, 2).map((f) => f.value).sort(), ['harry', 'potter']);

// ——— Les routes ———
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = (token, method, url, body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) });
async function account(name, role) {
  const email = `${name}@test.local`;
  const { token } = await (await call('', 'POST', '/api/auth/register', { email, password: 'motdepasse1', name })).json();
  const link = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await call('', 'POST', '/api/auth/verify', { token: link });
  if (role) run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}

try {
  const user = await account('simple'), vip = await account('membre', 'vip'), boss = await account('fonda', 'founder');
  assert.equal((await call('', 'POST', '/api/cut/learn', { settings: { transition: 'cut' } })).status, 401);
  assert.equal((await call(user.token, 'POST', '/api/cut/learn', { settings: { transition: 'cut' } })).status, 403, 'compte sans CLOUD');
  assert.ok((await (await call(vip.token, 'GET', '/api/cut/learn')).json()).keys.includes('transition'));
  assert.equal((await call(vip.token, 'POST', '/api/cut/learn', { settings: { artist: 'x' } })).status, 400, 'aucun réglage connu');
  for (let k = 0; k < 5; k++) assert.equal((await call(vip.token, 'POST', '/api/cut/learn', { settings: { transition: 'flash', introLyrics: 'privé' } })).status, 200);
  assert.equal(get('SELECT settings FROM cut_learn ORDER BY id DESC LIMIT 1').settings, '{"transition":"flash"}', 'rien d’autre que les réglages');
  assert.equal(get('SELECT role FROM cut_learn ORDER BY id DESC LIMIT 1').role, 'vip', 'le rôle, jamais qui');
  // « auto » seulement pour un fondateur ; un membre reste un export
  assert.equal((await (await call(vip.token, 'POST', '/api/cut/learn', { kind: 'auto', settings: { transition: 'flash' } })).json()).kind, 'export');
  assert.equal((await (await call(boss.token, 'POST', '/api/cut/learn', { kind: 'auto', settings: { transition: 'cut', filmVol: 150 } })).json()).kind, 'auto');
  const fix = await (await call(boss.token, 'POST', '/api/cut/learn', { settings: { transition: 'cut', filmVol: 100 }, auto: { transition: 'cut', filmVol: 150 } })).json();
  assert.equal(fix.kind, 'correction');
  assert.equal(get("SELECT changed FROM cut_learn WHERE kind = 'correction'").changed, '[{"key":"filmVol","from":150,"to":100}]');
  assert.equal((await call(vip.token, 'POST', '/api/cut/learn', { settings: { transition: 'flash' }, content: { sound: { bpm: 140, drop: true }, text: { replica: 'Encore ?' } }, thumbs: [jpg] })).status, 200);
  assert.equal(get('SELECT thumbs FROM cut_learn ORDER BY id DESC LIMIT 1').thumbs, JSON.stringify([jpg]));

  assert.equal((await call(vip.token, 'GET', '/api/cut/brain')).status, 403, 'réservé aux fondateurs');
  let brain = await (await call(boss.token, 'GET', '/api/cut/brain')).json();
  assert.equal(brain.counts.export, 7);
  assert.equal(brain.counts.auto, 1);
  assert.equal(brain.counts.correction, 1);
  assert.equal(brain.founders, 1, 'la correction est d’un fondateur');
  assert.ok(brain.proposals.some((p) => p.key === 'transition' && p.value === 'flash'), 'les membres préfèrent le flash');
  assert.equal(brain.content.bpm, 140, 'ce que l’arbre a entendu');
  assert.equal(brain.gallery[0].thumbs[0], jpg, 'ce qu’il a vu');
  assert.equal(brain.values.transition, 'cut');

  // Valider la proposition, puis une leçon qui règle une feuille, puis la retirer
  assert.equal((await call(boss.token, 'POST', '/api/cut/brain/proposals', { key: 'transition', value: 'flash', decision: 'approve' })).status, 200);
  brain = await (await call(boss.token, 'GET', '/api/cut/brain')).json();
  assert.equal(brain.values.transition, 'flash');
  assert.ok(!brain.proposals.some((p) => p.key === 'transition'));
  assert.equal((await call(boss.token, 'POST', '/api/cut/brain/notes', { leaf: 'iSize', value: 999 })).status, 201, 'borné à 200');
  assert.equal((await call(boss.token, 'POST', '/api/cut/brain/notes', { leaf: 'iSize', value: 'gros' })).status, 400);
  assert.equal((await call(boss.token, 'POST', '/api/cut/brain/notes', { leaf: 'inconnue', text: 'x' })).status, 400);
  assert.equal((await call(boss.token, 'POST', '/api/cut/brain/notes', { leaf: 'film', text: 'x', link: 'javascript:alert(1)' })).status, 400);
  const lesson = await (await call(boss.token, 'POST', '/api/cut/brain/notes', { leaf: 'iSize', value: 70, text: 'Encore plus petit.', link: 'https://www.tiktok.com/@x/video/1' })).json();
  assert.equal((await call(boss.token, 'POST', '/api/cut/brain/notes', { leaf: 'film', text: 'Une scène de prison marche bien.' })).status, 201, 'une leçon sur une branche');
  brain = await (await call(boss.token, 'GET', '/api/cut/brain')).json();
  assert.equal(brain.values.iSize, 70);
  assert.equal(brain.lessons.length, 3);
  assert.equal(brain.journal[0].kind, 'note');
  assert.equal((await call(vip.token, 'DELETE', '/api/cut/brain/notes/' + lesson.id)).status, 403);
  assert.equal((await call(boss.token, 'DELETE', '/api/cut/brain/notes/' + lesson.id)).status, 200);
  assert.equal((await (await call(boss.token, 'GET', '/api/cut/brain')).json()).values.iSize, 80, 'retirée, la leçon emporte son réglage');

  // Les recettes du cloud CUT, reprises une fois
  run("INSERT INTO cut_videos (user_id, name, stored_as, size, created_at, edit) VALUES (?, 'DEAD', 'x.mp4', 1, 1, ?)", boss.id,
    JSON.stringify({ v: 1, prefs: { preset: 'drop', transition: 'cut', introLyrics: 'privé' } }));
  setSetting('cut_brain_import', 0);
  assert.equal(importCloudRecipes(), 1);
  assert.equal(importCloudRecipes(), 0, 'une seule fois');
  assert.equal(get("SELECT settings FROM cut_learn WHERE created_at = 1").settings, '{"preset":"drop","transition":"cut"}');
  // leur contenu, pour les montages des fondateurs : textes, tempo, fonds, aperçu
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-cutlib-'));
  fs.writeFileSync(path.join(lib, 'x.mp4.jpg'), Buffer.from('jpeg'));
  run("UPDATE cut_videos SET caption = '« Tu crois ? » #undergroundmusic', edit = ? WHERE stored_as = 'x.mp4'",
    JSON.stringify({ bpm: 140, title: 'DEAD', clips: [{ name: 'Sirius.mp4' }], prefs: { introOn: true, introLen: 8, introLyrics: '[00:00.10] <00:00.10>Tu <00:00.40>crois ?' } }));
  setSetting('cut_brain_import_content', 0);
  assert.equal(importCloudContent(lib), 1);
  const archive = get("SELECT content, thumbs FROM cut_learn WHERE kind = 'archive'");
  assert.equal(JSON.parse(archive.content).text.replica, 'Tu crois ?');
  assert.equal(JSON.parse(archive.thumbs).length, 1);
  assert.equal(importCloudContent(lib), 0, 'une seule fois');
  fs.rmSync(lib, { recursive: true, force: true });
  // ——— Le superviseur : son avis, nettoyé ; une panne ne casse rien et garde le dernier avis ———
  const opinion = { resume: 'Les membres poussent le flash.', propositions: [{ key: 'transition', value: 'flash', avis: 'prudence', pourquoi: 'Un seul compte.' },
    { key: 'inconnue', value: 1, avis: 'pour', pourquoi: 'x' }, { key: 'iSize', value: 70, avis: 'génial', pourquoi: 'x' }],
    alertes: [{ niveau: 'grave', texte: 'Réplique sensible.', feuille: 'transition' }, { niveau: 'pire', texte: 'Niveau inconnu.' }], branches: { film: 'Solide.', autre: 'x' }, lecons: ['Une scène de trahison.'] };
  fake.reply = [404, { error: 'model "gemma3:4b" not found, try pulling it first' }];
  assert.equal((await call(boss.token, 'POST', '/api/cut/brain/agent')).status, 202);
  const missing = await (async () => { for (let k = 0; k < 50; k++) { const b = await (await call(boss.token, 'GET', '/api/cut/brain')).json(); if (b.agent.status !== 'jamais') return b.agent; await new Promise((r) => setTimeout(r, 100)); } })();
  assert.equal(missing.status, 'sans-ia', 'modèle pas téléchargé : le menu dit comment l’installer');
  fake.reply = [200, { model: 'gemma3:4b', message: { role: 'assistant', content: JSON.stringify(opinion) }, done: true }];
  assert.equal((await call(vip.token, 'POST', '/api/cut/brain/agent')).status, 403);
  assert.equal((await call(boss.token, 'POST', '/api/cut/brain/agent')).status, 202);
  const until = async (ok) => { for (let k = 0; k < 50; k++) { const b = await (await call(boss.token, 'GET', '/api/cut/brain')).json(); if (ok(b.agent)) return b.agent; await new Promise((r) => setTimeout(r, 100)); } throw new Error('le superviseur ne répond pas'); };
  let agent = await until((a) => a.status === 'ok');
  assert.equal(agent.resume, 'Les membres poussent le flash.');
  assert.deepEqual(agent.propositions, [{ key: 'transition', value: 'flash', avis: 'prudence', pourquoi: 'Un seul compte.' }], 'clés et avis inconnus écartés');
  assert.deepEqual(agent.alertes.map((a) => a.niveau), ['grave', 'info']);
  assert.deepEqual(agent.branches, { film: 'Solide.' });
  const sent = fake.calls.at(-1);
  assert.equal(sent.body.model, 'gemma3:4b');
  assert.equal(sent.body.keep_alive, 0, 'le modèle quitte la mémoire après la réponse');
  assert.equal(sent.body.options.num_thread, 3, 'et ne prend que 3 cœurs');
  assert.ok(sent.body.messages[1].images.length > 0, 'les images des montages partent avec');
  assert.ok(sent.body.messages[1].content.includes('Encore ?'), 'et leurs textes');
  fake.reply = [500, { error: 'out of memory' }];
  assert.equal((await call(boss.token, 'POST', '/api/cut/brain/agent')).status, 202);
  agent = await until((a) => a.status === 'erreur');
  assert.match(agent.error, /500/);
  assert.equal(agent.resume, 'Les membres poussent le flash.', 'le dernier avis reste');
  assert.equal((await call(boss.token, 'GET', '/api/cut/brain')).status, 200, 'le menu marche toujours');
  console.log('cutbrain : ok');
} finally {
  server.close(); claude.close(); db.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows : la base peut rester verrouillée un instant */ }
}
