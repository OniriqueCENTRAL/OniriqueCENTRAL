// « Mes sons » (projets, versions, liens d'écoute, quota, disque plein), sur une base jetable : node test/sounds.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-sounds-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test' });

const { createApp } = await import('../src/app.js');
const { run, get, setSetting } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { soundsDir } = await import('../src/sounds.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, route, { token, body, raw, expect = 200 } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const isJson = response.headers.get('content-type')?.includes('json');
  const data = isJson ? await response.json() : Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, expect, `${method} ${route} → ${response.status} ${isJson ? JSON.stringify(data) : ''}`);
  return Object.assign(data, { headers: response.headers });
}

let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

async function account(name, role) {
  const email = `${name}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  const link = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await call('POST', '/api/auth/verify', { body: { token: link } });
  if (role) run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}

// Un petit WAV : l'en-tête RIFF/WAVE suffit à le reconnaître.
const wav = (bytes = 4000) => Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.alloc(bytes)]);
// Le seuil du disque ne dépend pas de la machine qui lance le test.
setSetting('sounds_disk_max', 1);
const shareToken = (url) => new URL(url).searchParams.get('t');

let member, other, listener, projectId, trackId, v2;
try {
  await step('réservé aux membres ONIRIQUE et aux fondateurs', async () => {
    member = await account('membre', 'vip');
    other = await account('client');
    listener = await account('auditeur');
    await call('GET', '/api/me/sounds', { token: other.token, expect: 403 });
    const empty = await call('GET', '/api/me/sounds', { token: member.token });
    assert.deepEqual(empty.projects, []);
  });

  await step('projet, titre et versions : la dernière envoyée est celle qu\'on écoute', async () => {
    projectId = (await call('POST', '/api/me/sounds/projects', { token: member.token, body: { title: 'Album' }, expect: 201 })).id;
    await call('POST', `/api/me/sounds/projects/${projectId}/tracks?filename=pas-un-son.wav`, { token: member.token, raw: Buffer.from('bonjour tout le monde'), expect: 400 });
    trackId = (await call('POST', `/api/me/sounds/projects/${projectId}/tracks?filename=Intro.wav`, { token: member.token, raw: wav(), expect: 201 })).id;
    v2 = (await call('POST', `/api/me/sounds/tracks/${trackId}/versions?filename=Intro%20v2.wav&note=mix`, { token: member.token, raw: wav(5000), expect: 201 })).id;
    await call('PATCH', `/api/me/sounds/versions/${v2}`, { token: member.token, body: { peaks: [0.5, 2, -1], duration: 12.5 } });
    const data = await call('GET', '/api/me/sounds', { token: member.token });
    const t = data.projects[0].tracks[0];
    assert.equal(t.title, 'Intro');
    assert.equal(t.versions.length, 2);
    assert.equal(t.currentId, v2);
    assert.deepEqual(t.versions[1].peaks, [0.5, 1, 0]);
    assert.equal(data.quota.used, wav().length + wav(5000).length);
    // Le projet d'un autre est introuvable.
    await call('POST', `/api/me/sounds/projects/${projectId}/tracks?filename=x.wav`, { token: (await account('autre', 'vip')).token, raw: wav(), expect: 404 });
  });

  await step('le fichier audio : adresse signée, lecture par morceaux, signature fausse refusée', async () => {
    const data = await call('GET', '/api/me/sounds', { token: member.token });
    const url = data.projects[0].tracks[0].versions[1].url;
    const response = await fetch(base + url, { headers: { Range: 'bytes=0-3' } });
    assert.equal(response.status, 206);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString('latin1'), 'RIFF');
    assert.equal((await fetch(base + url.replace(/s=[^&]+/, 's=faux'))).status, 403);
  });

  await step('lien protégé : mot de passe, écoute comptée, auteur prévenu, commentaire à un moment du titre', async () => {
    const { url } = await call('POST', '/api/me/sounds/links', { token: member.token, body: { projectId, password: 'secret1', label: 'Label X' }, expect: 201 });
    const t = shareToken(url);
    await call('POST', `/api/sounds/share/${t}`, { body: {}, expect: 401 });
    await call('POST', `/api/sounds/share/${t}`, { body: { password: 'faux' }, expect: 401 });
    const share = await call('POST', `/api/sounds/share/${t}`, { body: { password: 'secret1' } });
    assert.equal(share.tracks.length, 1);
    assert.equal(share.tracks[0].version.id, v2);
    assert.equal(share.tracks[0].version.downloadUrl, null);
    const before = outbox.length;
    await call('POST', `/api/sounds/share/${t}/play`, { token: listener.token, body: { pass: share.pass, trackId } });
    await call('POST', `/api/sounds/share/${t}/play`, { token: listener.token, body: { pass: share.pass, trackId } });
    assert.equal(outbox.length, before + 1, 'un seul avis par jour');
    assert.match(outbox.at(-1).subject, /auditeur écoute « Intro »/);
    await call('POST', `/api/sounds/share/${t}/comments`, { body: { pass: share.pass, trackId, at: 4.2, body: 'Le refrain !' }, expect: 400 });
    await call('POST', `/api/sounds/share/${t}/comments`, { body: { pass: share.pass, trackId, at: 4.2, body: 'Le refrain !', name: 'Sam' }, expect: 201 });
    const data = await call('GET', '/api/me/sounds', { token: member.token });
    assert.equal(data.links[0].plays, 2);
    assert.equal(data.projects[0].tracks[0].comments[0].author, 'Sam');
    // Le lien supprimé ne s'ouvre plus.
    await call('DELETE', `/api/me/sounds/links/${data.links[0].id}`, { token: member.token });
    await call('POST', `/api/sounds/share/${t}`, { body: { pass: share.pass }, expect: 404 });
  });

  await step('lien expiré, et lien d\'un membre qui ne l\'est plus : fermés', async () => {
    await call('POST', '/api/me/sounds/links', { token: member.token, body: { trackId, expiresAt: Date.now() - 1000 }, expect: 400 });
    const { url } = await call('POST', '/api/me/sounds/links', { token: member.token, body: { trackId, download: true }, expect: 201 });
    const share = await call('POST', `/api/sounds/share/${shareToken(url)}`, { body: {} });
    assert.ok(share.tracks[0].version.downloadUrl);
    run('UPDATE users SET role = ? WHERE id = ?', 'user', member.id);
    await call('POST', `/api/sounds/share/${shareToken(url)}`, { body: {}, expect: 404 });
    run('UPDATE users SET role = ? WHERE id = ?', 'vip', member.id);
  });

  await step('quota du membre, puis disque rempli au-delà du seuil : plus aucun envoi', async () => {
    setSetting('sounds_quota_gb', 10000 / 1024 ** 3);
    await call('POST', `/api/me/sounds/projects/${projectId}/tracks?filename=gros.wav`, { token: member.token, raw: wav(20000), expect: 413 });
    setSetting('sounds_quota_gb', 10);
    setSetting('sounds_disk_max', 0.000001);
    const refused = await call('POST', `/api/me/sounds/projects/${projectId}/tracks?filename=b.wav`, { token: member.token, raw: wav(), expect: 507 });
    assert.match(refused.error, /plein/);
    assert.equal((await call('GET', '/api/me/sounds', { token: member.token })).quota.full, true);
    setSetting('sounds_disk_max', 1);
  });

  await step('supprimer une version, puis le projet : les fichiers partent avec', async () => {
    const files = () => fs.readdirSync(soundsDir).length;
    assert.equal(files(), 2);
    await call('DELETE', `/api/me/sounds/versions/${v2}`, { token: member.token });
    assert.equal(files(), 1);
    const left = (await call('GET', '/api/me/sounds', { token: member.token })).projects[0].tracks[0];
    assert.equal(left.currentId, left.versions[0].id);
    await call('DELETE', `/api/me/sounds/versions/${left.versions[0].id}`, { token: member.token, expect: 400 });
    await call('DELETE', `/api/me/sounds/projects/${projectId}`, { token: member.token });
    assert.equal(files(), 0);
  });

  await step('dupliquer, déplacer, réglages d\'un lien, nouvelle adresse, compte exigé, auditeurs', async () => {
    const a = (await call('POST', '/api/me/sounds/projects', { token: member.token, body: { title: 'A' }, expect: 201 })).id;
    const b = (await call('POST', '/api/me/sounds/projects', { token: member.token, body: { title: 'B' }, expect: 201 })).id;
    const t = (await call('POST', `/api/me/sounds/projects/${a}/tracks?filename=Son.wav`, { token: member.token, raw: wav(), expect: 201 })).id;
    const copy = (await call('POST', `/api/me/sounds/tracks/${t}/duplicate`, { token: member.token, expect: 201 })).id;
    await call('PATCH', `/api/me/sounds/tracks/${copy}`, { token: member.token, body: { projectId: b } });
    let data = await call('GET', '/api/me/sounds', { token: member.token });
    assert.equal(data.projects.find((p) => p.id === b).tracks[0].title, 'Son (copie)');
    assert.equal(fs.readdirSync(soundsDir).length, 2, 'le fichier est copié');

    const link = await call('POST', '/api/me/sounds/links', { token: member.token, body: { trackId: t }, expect: 201 });
    await call('PATCH', `/api/me/sounds/links/${link.id}`, { token: member.token, body: { requireAccount: true, download: true } });
    await call('POST', `/api/sounds/share/${shareToken(link.url)}`, { body: {}, expect: 401 });
    await call('POST', `/api/sounds/share/${shareToken(link.url)}/play`, { token: listener.token, body: { trackId: t } });
    const fresh = await call('POST', `/api/me/sounds/links/${link.id}/reset`, { token: member.token });
    assert.notEqual(fresh.url, link.url);
    await call('POST', `/api/sounds/share/${shareToken(link.url)}`, { token: listener.token, body: {}, expect: 404 });
    await call('POST', `/api/sounds/share/${shareToken(fresh.url)}`, { token: listener.token, body: {} });
    data = await call('GET', '/api/me/sounds', { token: member.token });
    const played = data.projects.find((p) => p.id === a).tracks[0];
    assert.equal(played.plays, 1);
    assert.equal(played.listeners[0].name, 'auditeur');
    assert.equal(data.links[0].requireAccount, true);
    // L'étape du titre : maquette, V2, final ; une autre valeur est refusée.
    await call('PATCH', `/api/me/sounds/tracks/${t}`, { token: member.token, body: { stage: 'V2' } });
    await call('PATCH', `/api/me/sounds/tracks/${t}`, { token: member.token, body: { stage: 'brouillon' }, expect: 400 });
    const staged = await call('POST', `/api/sounds/share/${shareToken(fresh.url)}`, { token: listener.token, body: {} });
    assert.equal(staged.tracks[0].stage, 'v2');
    // Les crédits du titre (un rôle inconnu est ignoré) et l'auteur de la pochette, vus par l'auditeur.
    await call('PATCH', `/api/me/sounds/tracks/${t}`, { token: member.token, body: { credits: { beat: ' Kanni ', mix: 'Gry', master: '', pirate: 'x' } } });
    await call('PATCH', `/api/me/sounds/projects/${a}`, { token: member.token, body: { coverBy: 'Shurby' } });
    const credited = await call('POST', `/api/sounds/share/${shareToken(fresh.url)}`, { token: listener.token, body: {} });
    assert.deepEqual(credited.tracks[0].credits, { beat: 'Kanni', mix: 'Gry' });
    assert.equal(credited.coverBy, 'Shurby');
  });

  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
