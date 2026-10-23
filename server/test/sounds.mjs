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
const { soundsDir, remindReleases } = await import('../src/sounds.js');

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
    assert.match(outbox.at(-1).subject, /Sam a commenté « Intro »/);
    const data = await call('GET', '/api/me/sounds', { token: member.token });
    assert.equal(data.links[0].plays, 2);
    assert.equal(data.projects[0].tracks[0].comments[0].author, 'Sam');
    // Le suivi d'écoute : deux personnes (le compte connecté, un navigateur anonyme), l'une va au bout, l'autre part à 30 %.
    const anon = await call('POST', `/api/sounds/share/${t}/play`, { body: { pass: share.pass, trackId, listener: 'nav-1' } });
    await call('POST', `/api/sounds/share/${t}/progress`, { body: { pass: share.pass, play: anon.play, reached: 30, length: 100 } });
    await call('POST', `/api/sounds/share/${t}/progress`, { body: { pass: share.pass, play: anon.play, reached: 12, length: 100 } });
    await call('POST', `/api/sounds/share/${t}/progress`, { body: { pass: share.pass, play: anon.play, reached: 5, length: 0 }, expect: 400 });
    const full = await call('POST', `/api/sounds/share/${t}/play`, { token: listener.token, body: { pass: share.pass, trackId } });
    await call('POST', `/api/sounds/share/${t}/progress`, { body: { pass: share.pass, play: full.play, reached: 100, length: 100 } });
    const stats = (await call('GET', '/api/me/sounds', { token: member.token })).projects[0].tracks[0].stats;
    assert.deepEqual([stats.listeners, stats.followed, stats.average, stats.complete], [2, 2, 0.65, 0.5]);
    assert.deepEqual(stats.curve.slice(0, 4), [1, 1, 1, 0.5]);
    // Un retour coché « Réglé », puis remis à régler ; un autre compte ne peut pas y toucher.
    const cid = data.projects[0].tracks[0].comments[0].id;
    assert.equal(data.projects[0].tracks[0].comments[0].resolved, false);
    assert.equal((await call('PATCH', `/api/me/sounds/comments/${cid}`, { token: member.token, body: { resolved: true } })).resolved, true);
    await call('PATCH', `/api/me/sounds/comments/${cid}`, { token: listener.token, body: { resolved: false }, expect: 403 });
    assert.equal((await call('GET', '/api/me/sounds', { token: member.token })).projects[0].tracks[0].comments[0].resolved, true);
    assert.equal((await call('PATCH', `/api/me/sounds/comments/${cid}`, { token: member.token, body: { resolved: false } })).resolved, false);
    // Tout le projet en .zip, par un lien signé : un fichier valide, aux bons noms ; un lien trafiqué est refusé.
    const { url: zipUrl } = await call('POST', `/api/me/sounds/projects/${data.projects[0].id}/zip`, { token: member.token });
    assert.equal((await fetch(base + zipUrl.replace(/s=[^&]+/, 's=abc'))).status, 403);
    await call('POST', `/api/me/sounds/projects/${data.projects[0].id}/zip`, { token: listener.token, expect: 403 });
    const zipped = await fetch(base + zipUrl);
    const zip = Buffer.from(await zipped.arrayBuffer());
    assert.equal(zipped.headers.get('content-type'), 'application/zip');
    assert.equal(Number(zipped.headers.get('content-length')), zip.length);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    const names = [];
    for (let at = zip.readUInt32LE(zip.length - 6), n = 0; n < zip.readUInt16LE(zip.length - 12); n++) {
      const len = zip.readUInt16LE(at + 28);
      names.push(zip.subarray(at + 46, at + 46 + len).toString());
      at += 46 + len;
    }
    assert.ok(names.some((x) => x.endsWith('/Infos du projet.txt')) && names.some((x) => /\/01 - Intro\/v2 - /.test(x)), names.join(', '));
    fs.writeFileSync(path.join(os.tmpdir(), 'onirique-test-projet.zip'), zip);
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
    // L'étape du titre : maquette, V2, final ou un texte libre ; plus de 40 caractères est refusé.
    await call('PATCH', `/api/me/sounds/tracks/${t}`, { token: member.token, body: { stage: 'V2' } });
    await call('PATCH', `/api/me/sounds/tracks/${t}`, { token: member.token, body: { stage: 'x'.repeat(41) }, expect: 400 });
    const staged = await call('POST', `/api/sounds/share/${shareToken(fresh.url)}`, { token: listener.token, body: {} });
    assert.equal(staged.tracks[0].stage, 'v2');
    // La répartition : des parts de 0 à 100 % qui ne dépassent pas 100 % en tout ; une ligne sans nom est ignorée.
    await call('PATCH', `/api/me/sounds/tracks/${t}`, { token: member.token, body: { splits: [{ name: 'A', master: 60 }, { name: 'B', master: 50 }] }, expect: 400 });
    await call('PATCH', `/api/me/sounds/tracks/${t}`, { token: member.token, body: { splits: [{ name: 'A', master: -1 }] }, expect: 400 });
    await call('PATCH', `/api/me/sounds/tracks/${t}`, { token: member.token, body: { splits: [{ name: ' Kay ', role: 'Beatmaker', master: '33,335', publishing: 50 }, { name: '', master: 10 }] } });
    assert.deepEqual((await call('GET', '/api/me/sounds', { token: member.token })).projects.flatMap((x) => x.tracks).find((x) => x.id === t).splits,
      [{ name: 'Kay', role: 'Beatmaker', master: 33.34, publishing: 50 }]);
    // Un texte libre est gardé tel quel.
    await call('PATCH', `/api/me/sounds/tracks/${t}`, { token: member.token, body: { stage: '  Mix  chez Thomas ' } });
    assert.equal((await call('POST', `/api/sounds/share/${shareToken(fresh.url)}`, { token: listener.token, body: {} })).tracks[0].stage, 'Mix chez Thomas');
    // La date du titre : une vraie date seulement, '' l'efface.
    await call('PATCH', `/api/me/sounds/tracks/${t}`, { token: member.token, body: { day: '2026-13-01' }, expect: 400 });
    await call('PATCH', `/api/me/sounds/tracks/${t}`, { token: member.token, body: { day: '2026-05-06' } });
    assert.equal((await call('POST', `/api/sounds/share/${shareToken(fresh.url)}`, { token: listener.token, body: {} })).tracks[0].day, '2026-05-06');
    // Les crédits du titre (un rôle inconnu est ignoré) et l'auteur de la pochette, vus par l'auditeur.
    await call('PATCH', `/api/me/sounds/tracks/${t}`, { token: member.token, body: { credits: { beat: ' Kanni ', mix: 'Gry', master: '', pirate: 'x' } } });
    await call('PATCH', `/api/me/sounds/projects/${a}`, { token: member.token, body: { coverBy: 'Shurby' } });
    const credited = await call('POST', `/api/sounds/share/${shareToken(fresh.url)}`, { token: listener.token, body: {} });
    assert.deepEqual(credited.tracks[0].credits, { beat: 'Kanni', mix: 'Gry' });
    assert.equal(credited.coverBy, 'Shurby');
    // Les paroles : les sauts de ligne restent, les espaces de trop et les \r partent.
    await call('PATCH', `/api/me/sounds/tracks/${t}`, { token: member.token, body: { lyrics: '[00:01.50]  Première   ligne \r\n\r\nDeuxième\n' } });
    const lyrics = (await call('GET', '/api/me/sounds', { token: member.token })).projects.flatMap((x) => x.tracks).find((x) => x.id === t).lyrics;
    assert.equal(lyrics, '[00:01.50] Première ligne\n\nDeuxième');
    // La fiche « À propos de l'artiste » : lien complété en https, lien invalide refusé, masquée mais visible par son auteur.
    await call('PATCH', '/api/me/sounds/about', { token: member.token, body: { link: 'pas un lien' }, expect: 400 });
    const about = await call('PATCH', '/api/me/sounds/about', { token: member.token, body: { bio: ' Rappeur   de Paris \r\n\r\n\r\nDepuis 2020 ', link: 'onirique.store/x', visible: false } });
    assert.deepEqual([about.bio, about.link, about.visible], ['Rappeur de Paris\n\nDepuis 2020', 'https://onirique.store/x', false]);
    assert.equal((await call('GET', '/api/me/sounds', { token: member.token })).projects[0].about.visible, false);
    assert.equal((await call('POST', `/api/sounds/share/${shareToken(fresh.url)}`, { token: listener.token, body: {} })).about, null);
    await call('PATCH', '/api/me/sounds/about', { token: member.token, body: { visible: true } });
    const heard = await call('POST', `/api/sounds/share/${shareToken(fresh.url)}`, { token: listener.token, body: {} });
    assert.equal(heard.about.bio, 'Rappeur de Paris\n\nDepuis 2020');
    assert.ok(heard.tracks.some((x) => x.lyrics === '[00:01.50] Première ligne\n\nDeuxième'));
    // La date de sortie du projet : une date réelle seulement, '' l'efface.
    await call('PATCH', `/api/me/sounds/projects/${a}`, { token: member.token, body: { releaseDate: '2026-02-30' }, expect: 400 });
    await call('PATCH', `/api/me/sounds/projects/${a}`, { token: member.token, body: { releaseDate: '2026-12-04' } });
    assert.equal((await call('POST', `/api/sounds/share/${shareToken(fresh.url)}`, { token: listener.token, body: {} })).releaseDate, '2026-12-04');
    // La préparation de la sortie : des tâches autour de la date, et un rappel sept jours avant puis la veille, une fois chacun.
    await call('PATCH', `/api/me/sounds/projects/${a}`, { token: member.token, body: { plan: { items: Array(41).fill({ label: 'x' }) } }, expect: 400 });
    await call('PATCH', `/api/me/sounds/projects/${a}`, { token: member.token, body: { plan: { items: [{ label: 'Master validé', days: -30, done: true }, { label: 'Clip', days: -2.4 }, { label: '' }] } } });
    const planned = (await call('GET', '/api/me/sounds', { token: member.token })).projects.find((x) => x.id === a).plan;
    assert.deepEqual(planned, { items: [{ label: 'Master validé', note: '', days: -30, done: true }, { label: 'Clip', note: '', days: -2, done: false }], remind: true });
    const inDays = (n) => new Date(Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()) + 'T12:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
    await call('PATCH', `/api/me/sounds/projects/${a}`, { token: member.token, body: { releaseDate: inDays(7) } });
    const mailsBefore = outbox.length;
    assert.equal(await remindReleases({ force: true }), 1);
    assert.match(outbox.at(-1).subject, /sort dans 7 jours/);
    assert.ok(outbox.at(-1).text.includes('- Clip') && !outbox.at(-1).text.includes('Master validé'));
    assert.equal(await remindReleases({ force: true }), 0, 'un seul rappel à J-7');
    await call('PATCH', `/api/me/sounds/projects/${a}`, { token: member.token, body: { releaseDate: inDays(1) } });
    assert.equal(await remindReleases({ force: true }), 1);
    assert.match(outbox.at(-1).subject, /sort demain/);
    await call('PATCH', `/api/me/sounds/projects/${a}`, { token: member.token, body: { releaseDate: inDays(7), plan: { items: planned.items, remind: false } } });
    assert.equal(await remindReleases({ force: true }), 0, 'rappels coupés');
    assert.equal(outbox.length, mailsBefore + 2);
    await call('PATCH', `/api/me/sounds/projects/${a}`, { token: member.token, body: { plan: null } });
    assert.equal((await call('GET', '/api/me/sounds', { token: member.token })).projects.find((x) => x.id === a).plan, null);
    await call('PATCH', `/api/me/sounds/projects/${a}`, { token: member.token, body: { releaseDate: '' } });
  });

  await step('dossiers, et projet d\'un autre membre enregistré dans Mes sons (le lien coupé, il disparaît)', async () => {
    const other = await account('second', 'vip');
    const theirs = (await call('POST', '/api/me/sounds/projects', { token: other.token, body: { title: 'UNRELEASED' }, expect: 201 })).id;
    await call('POST', `/api/me/sounds/projects/${theirs}/tracks?filename=x.wav`, { token: other.token, raw: wav(), expect: 201 });
    const link = await call('POST', '/api/me/sounds/links', { token: other.token, body: { projectId: theirs, password: 'secret1' }, expect: 201 });
    const t = shareToken(link.url);
    // Un simple client ne peut pas enregistrer ; un membre, une fois le mot de passe donné.
    const pass = (await call('POST', `/api/sounds/share/${t}`, { token: listener.token, body: { password: 'secret1' } })).pass;
    await call('POST', `/api/sounds/share/${t}/save`, { token: listener.token, body: { pass }, expect: 403 });
    await call('POST', `/api/sounds/share/${t}/save`, { token: member.token, body: {}, expect: 401 });
    const seen = await call('POST', `/api/sounds/share/${t}`, { token: member.token, body: { pass } });
    assert.equal(seen.canSave, true);
    assert.equal(seen.saved, false);
    await call('POST', `/api/sounds/share/${t}/save`, { token: member.token, body: { pass }, expect: 201 });
    await call('POST', `/api/sounds/share/${t}/save`, { token: other.token, body: { pass }, expect: 400 });

    const folder = (await call('POST', '/api/me/sounds/folders', { token: member.token, body: { title: 'Collabs' }, expect: 201 })).id;
    let data = await call('GET', '/api/me/sounds', { token: member.token });
    const saved = data.saved[0];
    assert.equal(saved.title, 'UNRELEASED');
    assert.equal(saved.owner, 'second');
    assert.equal(saved.available, true);
    assert.equal(saved.pass, pass, 'le mot de passe déjà donné reste valable');
    await call('PATCH', `/api/me/sounds/saves/${saved.id}`, { token: member.token, body: { folderId: folder } });
    const mine = data.projects[0].id;
    await call('PATCH', `/api/me/sounds/projects/${mine}`, { token: member.token, body: { folderId: folder } });
    // Le dossier d'un autre est refusé.
    const foreign = (await call('POST', '/api/me/sounds/folders', { token: other.token, body: { title: 'X' }, expect: 201 })).id;
    await call('PATCH', `/api/me/sounds/projects/${mine}`, { token: member.token, body: { folderId: foreign }, expect: 404 });
    data = await call('GET', '/api/me/sounds', { token: member.token });
    assert.equal(data.saved[0].folderId, folder);
    assert.equal(data.projects.find((x) => x.id === mine).folderId, folder);
    // Le dossier supprimé : ses projets reviennent à la racine.
    await call('DELETE', `/api/me/sounds/folders/${folder}`, { token: member.token });
    data = await call('GET', '/api/me/sounds', { token: member.token });
    assert.equal(data.folders.length, 0);
    assert.equal(data.projects.find((x) => x.id === mine).folderId, null);
    assert.equal(data.saved[0].folderId, null);
    // L'auteur coupe son lien : le projet disparaît de la page du membre.
    await call('DELETE', `/api/me/sounds/links/${link.id}`, { token: other.token });
    assert.equal((await call('GET', '/api/me/sounds', { token: member.token })).saved.length, 0);
  });

  await step('aperçu d\'un lien (Discord…) : titre et image du projet ; un lien protégé ne dévoile rien', async () => {
    const pid = (await call('POST', '/api/me/sounds/projects', { token: member.token, body: { title: 'ONI SEMINAIRE <4>' }, expect: 201 })).id;
    await call('POST', `/api/me/sounds/projects/${pid}/tracks?filename=a.wav`, { token: member.token, raw: wav(), expect: 201 });
    const open = await call('POST', '/api/me/sounds/links', { token: member.token, body: { projectId: pid }, expect: 201 });
    const locked = await call('POST', '/api/me/sounds/links', { token: member.token, body: { projectId: pid, password: 'secret1' }, expect: 201 });
    const page = (url) => fetch(`${base}/ecoute?t=${shareToken(url)}`).then((r) => r.text());
    const html = await page(open.url);
    assert.match(html, /<meta property="og:title" content="membre — ONI SEMINAIRE &lt;4&gt;">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/site\.test\/api\/sounds\/share\/[\w-]+\/apercu\.png\?v=\w+">/);
    assert.match(html, /id="room"/, 'le reste de la page est celui du site');
    const hidden = await page(locked.url);
    assert.ok(!hidden.includes('SEMINAIRE'), 'un lien protégé ne montre pas le nom du projet');
    const image = await fetch(`${base}/api/sounds/share/${shareToken(open.url)}/apercu.png`);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.ok((await image.arrayBuffer()).byteLength > 5000);
    // Le nom d'artiste du projet remplace celui du compte, sur la page d'écoute comme dans l'aperçu.
    await call('PATCH', `/api/me/sounds/projects/${pid}`, { token: member.token, body: { artist: 'dias7am & Nay' } });
    assert.equal((await call('POST', `/api/sounds/share/${shareToken(open.url)}`, { body: {} })).owner, 'dias7am & Nay');
    assert.match(await page(open.url), /<meta property="og:title" content="dias7am &amp; Nay — ONI SEMINAIRE/);
    await call('PATCH', `/api/me/sounds/projects/${pid}`, { token: member.token, body: { artist: '' } });
    assert.equal((await call('POST', `/api/sounds/share/${shareToken(open.url)}`, { body: {} })).owner, 'membre');
  });

  await step('collaboration : lien d\'invitation, accepter, ce que fait un collaborateur, quitter, lien coupé', async () => {
    const owner = await account('auteur-collab', 'vip');
    const friend = await account('ami-collab', 'vip');
    const pid = (await call('POST', '/api/me/sounds/projects', { token: owner.token, body: { title: 'SEMINAIRE' }, expect: 201 })).id;
    await call('POST', `/api/me/sounds/projects/${pid}/tracks?filename=a.wav`, { token: owner.token, raw: wav(), expect: 201 });
    // Seul l'auteur crée l'invitation.
    await call('POST', `/api/me/sounds/projects/${pid}/invite`, { token: friend.token, expect: 404 });
    const { url } = await call('POST', `/api/me/sounds/projects/${pid}/invite`, { token: owner.token });
    const invite = url.split('#/invite/')[1];
    const seen = await call('GET', `/api/sounds/invite/${invite}`, { token: friend.token });
    assert.equal(seen.project, 'SEMINAIRE');
    assert.equal(seen.already, false);
    await call('POST', `/api/sounds/invite/${invite}/accept`, { token: owner.token, expect: 400 });
    await call('POST', `/api/sounds/invite/${invite}/accept`, { token: friend.token });
    // Le projet est dans sa page, avec l'auteur ; il ajoute un titre (compté chez l'auteur) et le renomme.
    let theirs = (await call('GET', '/api/me/sounds', { token: friend.token })).projects.find((x) => x.id === pid);
    assert.equal(theirs.mine, false);
    assert.equal(theirs.owner.name, 'auteur-collab');
    const added = await call('POST', `/api/me/sounds/projects/${pid}/tracks?filename=b.wav`, { token: friend.token, raw: wav(3000), expect: 201 });
    await call('PATCH', `/api/me/sounds/tracks/${added.id}`, { token: friend.token, body: { title: 'Couplet', stage: 'v2' } });
    assert.equal((await call('GET', '/api/me/sounds', { token: owner.token })).quota.used, wav().length + wav(3000).length);
    assert.equal((await call('GET', '/api/me/sounds', { token: friend.token })).quota.used, 0);
    // Il partage le projet et un titre par ses propres liens, montrés au nom de l'auteur ; les écoutes comptent chez les deux.
    const shared = await call('POST', '/api/me/sounds/links', { token: friend.token, body: { projectId: pid }, expect: 201 });
    await call('POST', '/api/me/sounds/links', { token: friend.token, body: { trackId: added.id }, expect: 201 });
    const heard = await call('POST', `/api/sounds/share/${shareToken(shared.url)}`);
    assert.equal(heard.owner, 'auteur-collab');
    assert.equal(heard.canSave, false);
    // La fiche du collaborateur s'affiche sous celle de l'auteur, seulement s'il a choisi de la montrer.
    assert.deepEqual(heard.collabAbouts, []);
    await call('PATCH', '/api/me/sounds/about', { token: friend.token, body: { bio: 'Beatmaker', visible: false } });
    assert.deepEqual((await call('POST', `/api/sounds/share/${shareToken(shared.url)}`)).collabAbouts, []);
    await call('PATCH', '/api/me/sounds/about', { token: friend.token, body: { visible: true } });
    assert.deepEqual((await call('POST', `/api/sounds/share/${shareToken(shared.url)}`)).collabAbouts.map((x) => [x.name, x.bio]), [['ami-collab', 'Beatmaker']]);
    assert.equal((await call('GET', '/api/me/sounds', { token: owner.token })).projects.find((x) => x.id === pid).collabAbouts[0].bio, 'Beatmaker');
    await call('POST', `/api/sounds/share/${shareToken(shared.url)}/play`, { body: { trackId: added.id } });
    assert.equal((await call('GET', '/api/me/sounds', { token: owner.token })).projects.find((x) => x.id === pid).tracks.find((t) => t.id === added.id).plays, 1);
    assert.equal((await call('GET', '/api/me/sounds', { token: friend.token })).links.length, 2);
    // Mais ni supprimer le projet, ni le ranger, ni gérer l'invitation.
    await call('DELETE', `/api/me/sounds/projects/${pid}`, { token: friend.token, expect: 403 });
    await call('DELETE', `/api/me/sounds/projects/${pid}/invite`, { token: friend.token, expect: 403 });
    // L'auteur voit son collaborateur ; le collaborateur quitte le projet, qui disparaît de sa page.
    assert.equal((await call('GET', '/api/me/sounds', { token: owner.token })).projects.find((x) => x.id === pid).collaborators[0].name, 'ami-collab');
    await call('DELETE', `/api/me/sounds/projects/${pid}/collabs/${friend.id}`, { token: friend.token });
    assert.ok(!(await call('GET', '/api/me/sounds', { token: friend.token })).projects.some((x) => x.id === pid));
    await call('POST', `/api/me/sounds/projects/${pid}/tracks?filename=c.wav`, { token: friend.token, raw: wav(), expect: 404 });
    // Ses liens ne s'ouvrent plus une fois parti.
    await call('POST', `/api/sounds/share/${shareToken(shared.url)}`, { expect: 404 });
    // L'invitation coupée ne s'ouvre plus.
    await call('DELETE', `/api/me/sounds/projects/${pid}/invite`, { token: owner.token });
    await call('GET', `/api/sounds/invite/${invite}`, { token: friend.token, expect: 404 });
  });

  await step('dossiers dans des dossiers : créer, déplacer, pas de boucle, la suppression fait remonter le contenu', async () => {
    const me = await account('rangement', 'vip');
    const folder = (title, parentId) => call('POST', '/api/me/sounds/folders', { token: me.token, body: { title, parentId }, expect: 201 }).then((r) => r.id);
    const albums = await folder('Albums'), a1 = await folder('Album 1', albums), demos = await folder('Démos', a1);
    const pid = (await call('POST', '/api/me/sounds/projects', { token: me.token, body: { title: 'Intro' }, expect: 201 })).id;
    await call('PATCH', `/api/me/sounds/projects/${pid}`, { token: me.token, body: { folderId: demos } });
    const tree = async () => Object.fromEntries((await call('GET', '/api/me/sounds', { token: me.token })).folders.map((f) => [f.title, f.parentId]));
    assert.deepEqual(await tree(), { Albums: null, 'Album 1': albums, 'Démos': a1 });
    // Ni dans lui-même, ni dans l'un de ses sous-dossiers ; le dossier d'un autre membre est introuvable.
    await call('PATCH', `/api/me/sounds/folders/${albums}`, { token: me.token, body: { parentId: albums }, expect: 400 });
    await call('PATCH', `/api/me/sounds/folders/${albums}`, { token: me.token, body: { parentId: demos }, expect: 400 });
    await call('PATCH', `/api/me/sounds/folders/${demos}`, { token: member.token, body: { parentId: null }, expect: 404 });
    // Déplacé à la racine, puis renommé sans bouger.
    await call('PATCH', `/api/me/sounds/folders/${demos}`, { token: me.token, body: { parentId: null } });
    await call('PATCH', `/api/me/sounds/folders/${demos}`, { token: me.token, body: { title: 'Maquettes' } });
    assert.equal((await tree()).Maquettes, null);
    // Supprimer « Album 1 » remet « Maquettes » rangé dedans, et le projet, dans « Albums ».
    await call('PATCH', `/api/me/sounds/folders/${demos}`, { token: me.token, body: { parentId: a1 } });
    await call('PATCH', `/api/me/sounds/projects/${pid}`, { token: me.token, body: { folderId: a1 } });
    await call('DELETE', `/api/me/sounds/folders/${a1}`, { token: me.token });
    assert.deepEqual(await tree(), { Albums: null, Maquettes: albums });
    assert.equal((await call('GET', '/api/me/sounds', { token: me.token })).projects.find((x) => x.id === pid).folderId, albums);
    // Pas plus de 8 niveaux.
    let at = albums;
    for (let i = 2; i <= 8; i++) at = await folder('Niveau ' + i, at);
    await call('POST', '/api/me/sounds/folders', { token: me.token, body: { title: 'Trop bas', parentId: at }, expect: 400 });
  });

  await step('réglages : notifications par e-mail et sur l\'appareil, ouverture des nouveaux liens', async () => {
    const prefs = await call('GET', '/api/me/notifications', { token: member.token });
    assert.equal(prefs.mail.comment, true);
    assert.equal(prefs.links.download, false);
    const saved = await call('PUT', '/api/me/notifications', { token: member.token, body: { mail: { comment: false, inconnu: true }, links: { download: true } } });
    assert.equal(saved.mail.comment, false);
    assert.equal(saved.mail.inconnu, undefined);
    assert.equal(saved.push.comment, true);
    const pid = (await call('POST', '/api/me/sounds/projects', { token: member.token, body: { title: 'Réglages' }, expect: 201 })).id;
    const tid = (await call('POST', `/api/me/sounds/projects/${pid}/tracks?filename=Essai.wav`, { token: member.token, raw: wav(), expect: 201 })).id;
    const { url } = await call('POST', '/api/me/sounds/links', { token: member.token, body: { trackId: tid }, expect: 201 });
    const share = await call('POST', `/api/sounds/share/${shareToken(url)}`, { body: {} });
    assert.ok(share.tracks[0].version.downloadUrl, 'téléchargement autorisé par défaut');
    const before = outbox.length;
    await call('POST', `/api/sounds/share/${shareToken(url)}/comments`, { body: { trackId: tid, body: 'Encore', name: 'Lou' }, expect: 201 });
    assert.equal(outbox.length, before, 'plus d\'e-mail pour les commentaires');
    // Le téléchargement par le lien : l'adresse est signée avec le lien, qu'on ne peut pas retirer.
    assert.ok((await call('GET', share.tracks[0].version.downloadUrl)).length > 0);
    await call('GET', share.tracks[0].version.downloadUrl.replace(/&l=\d+/, ''), { expect: 403 });
    assert.ok((await call('GET', '/api/push/key')).key.length > 40);
    await call('POST', '/api/me/push', { token: member.token, body: { endpoint: 'http://x', keys: { p256dh: 'a', auth: 'b' } }, expect: 400 });
    await call('POST', '/api/me/push', { token: member.token, body: { endpoint: 'https://push.test/abc', keys: { p256dh: 'a', auth: 'b' } }, expect: 201 });
    assert.equal(get('SELECT user_id FROM push_subscriptions WHERE endpoint = ?', 'https://push.test/abc').user_id, member.id);
    await call('DELETE', '/api/me/push', { token: member.token, body: { endpoint: 'https://push.test/abc' } });
    assert.equal(get('SELECT 1 AS x FROM push_subscriptions'), undefined);
  });

  await step('pack de prods : BPM et clé lus dans le nom du fichier, vente, brouillon du mail', async () => {
    const { prodFromFilename, musicKey } = await import('../src/sounds.js');
    assert.deepEqual(prodFromFilename('Nightfall_140bpm_C#min.wav'), { title: 'Nightfall', bpm: 140, key: 'C# min' });
    assert.deepEqual(prodFromFilename('DARK - 92 BPM - Am.mp3'), { title: 'DARK', bpm: 92, key: 'A min' });
    assert.deepEqual(prodFromFilename('I Am Legend.wav'), { title: 'I Am Legend', bpm: 0, key: '' });
    assert.equal(musicKey('bb majeur'), 'Bb maj');
    assert.equal(musicKey('H'), null);
    const pack = (await call('POST', '/api/me/sounds/projects', { token: member.token, body: { title: 'Pack', kind: 'pack' }, expect: 201 })).id;
    const tid = (await call('POST', `/api/me/sounds/projects/${pack}/tracks?filename=Ghost%20150bpm%20Fmin.wav`, { token: member.token, raw: wav(), expect: 201 })).id;
    await call('PATCH', `/api/me/sounds/tracks/${tid}`, { token: member.token, body: { key: 'zz' }, expect: 400 });
    await call('PATCH', `/api/me/sounds/tracks/${tid}`, { token: member.token, body: { forSale: true } });
    await call('PATCH', `/api/me/sounds/projects/${pack}`, { token: member.token, body: { mail: { to: 'a@b.fr, nope', subject: 'Nouveau pack', trackIds: [tid], colors: { bg: 'red' } } } });
    await call('PATCH', `/api/me/sounds/projects/${projectId}`, { token: member.token, body: { mail: {} }, expect: 400 });
    const p = (await call('GET', '/api/me/sounds', { token: member.token })).projects.find((x) => x.id === pack);
    assert.equal(p.kind, 'pack');
    assert.deepEqual([p.tracks[0].title, p.tracks[0].bpm, p.tracks[0].key, p.tracks[0].forSale], ['Ghost', 150, 'F min', true]);
    assert.equal(p.mail.colors.bg, '#0D0809');
    const { html } = await call('POST', `/api/me/sounds/projects/${pack}/mail/preview`, { token: member.token, body: { ...p.mail, title: '<script>' } });
    assert.ok(html.includes('1 PROD<') && !html.includes('150 BPM') && !html.includes('<script>'));
  });

  await step('un projet passe en pack de prods : BPM et clé lus dans les noms de fichiers ; et retour', async () => {
    const pid = (await call('POST', '/api/me/sounds/projects', { token: member.token, body: { title: 'Instrus' }, expect: 201 })).id;
    await call('POST', `/api/me/sounds/projects/${pid}/tracks?filename=Nightfall_140bpm_C%23min.wav`, { token: member.token, raw: wav(), expect: 201 });
    const kept = (await call('POST', `/api/me/sounds/projects/${pid}/tracks?filename=Sans%20infos.wav`, { token: member.token, raw: wav(), expect: 201 })).id;
    await call('PATCH', `/api/me/sounds/tracks/${kept}`, { token: member.token, body: { bpm: 90 } });
    await call('PATCH', `/api/me/sounds/projects/${pid}`, { token: other.token, body: { kind: 'pack' }, expect: 403 });
    await call('PATCH', `/api/me/sounds/projects/${pid}`, { token: member.token, body: { kind: 'pack' } });
    let p = (await call('GET', '/api/me/sounds', { token: member.token })).projects.find((x) => x.id === pid);
    assert.equal(p.kind, 'pack');
    assert.ok(p.mail);
    assert.deepEqual(p.tracks.map((t) => [t.title, t.bpm, t.key]), [['Nightfall', 140, 'C# min'], ['Sans infos', 90, '']]);
    await call('PATCH', `/api/me/sounds/projects/${pid}`, { token: member.token, body: { kind: '' } });
    p = (await call('GET', '/api/me/sounds', { token: member.token })).projects.find((x) => x.id === pid);
    assert.deepEqual([p.kind, p.mail, p.tracks[0].bpm], ['', null, 140]);
  });

  await step('VANISH : un fondateur voit les projets de tous les comptes, en lecture seule', async () => {
    const boss = await account('fondateur-vanish', 'founder');
    const all = await call('GET', '/api/me/sounds?vanish=1', { token: boss.token });
    assert.equal(all.vanish, true);
    const theirs = all.projects.find((x) => x.owner.id === member.id);
    assert.ok(theirs && !theirs.mine && theirs.tracks.length);
    assert.equal((await call('GET', '/api/me/sounds', { token: boss.token })).projects.length, 0);
    const mine = await call('GET', '/api/me/sounds?vanish=1', { token: member.token });
    assert.ok(!mine.vanish && !mine.projects.some((x) => x.owner.id !== member.id && !x.collaborators.some((c) => c.id === member.id)));
    await call('PATCH', `/api/me/sounds/projects/${theirs.id}`, { token: boss.token, body: { title: 'x' }, expect: 404 });
  });

  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
