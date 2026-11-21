// L'arborescence de ONIRIQUE CUT (cutbrain.js), sur une base jetable : node test/cutbrain.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-cutbrain-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test' });

const { createApp } = await import('../src/app.js');
const { db, run, get, setSetting } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { cleanSettings, tally, proposalsOf, published, importCloudRecipes, STRONG } = await import('../src/cutbrain.js');

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

  assert.equal((await call(vip.token, 'GET', '/api/cut/brain')).status, 403, 'réservé aux fondateurs');
  let brain = await (await call(boss.token, 'GET', '/api/cut/brain')).json();
  assert.equal(brain.counts.export, 6);
  assert.equal(brain.counts.auto, 1);
  assert.equal(brain.counts.correction, 1);
  assert.equal(brain.founders, 1, 'la correction est d’un fondateur');
  assert.ok(brain.proposals.some((p) => p.key === 'transition' && p.value === 'flash'), 'les membres préfèrent le flash');
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
  console.log('cutbrain : ok');
} finally {
  server.close(); db.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows : la base peut rester verrouillée un instant */ }
}
