// Mails des packs de prods : contacts lus dans un CSV, boîte mail du membre, envoi, suivi de chaque destinataire,
// désinscription, couleurs de la pochette et téléchargement d'office, sur une base jetable : node test/packmail.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-packmail-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test',
  GOOGLE_CLIENT_ID: 'client-google', GOOGLE_CLIENT_SECRET: 'secret-google' });

// Google simulé : l'échange du code contre un accès durable, puis l'envoi par l'API Gmail.
const google = { sent: [], revoked: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), reply = (json, status = 200) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  if (u === 'https://oauth2.googleapis.com/token') {
    const b = new URLSearchParams(init.body);
    if (b.get('grant_type') === 'refresh_token') return reply({ access_token: 'acces', expires_in: 3600 });
    if (b.get('code') !== 'bon-code') return reply({ error: 'invalid_grant' }, 400);
    const id = Buffer.from(JSON.stringify({ email: 'Kay.Beats@gmail.com' })).toString('base64url');
    return reply({ access_token: 'acces', refresh_token: 'durable', scope: 'openid email https://www.googleapis.com/auth/gmail.send', id_token: `x.${id}.y` });
  }
  if (u === 'https://oauth2.googleapis.com/revoke') { google.revoked++; return reply({}); }
  if (u === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send' && google.disabled) {
    return reply({ error: { message: 'Gmail API has not been used in project 1 before or it is disabled.' } }, 403);
  }
  if (u === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
    google.sent.push({ auth: init.headers.Authorization, raw: Buffer.from(JSON.parse(init.body).raw, 'base64url').toString() });
    return reply({ id: 'm1' });
  }
  return realFetch(url, init);
};

const { createApp } = await import('../src/app.js');
const { run, get, setSetting } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { contactsOf } = await import('../src/packsend.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, route, { token, body, raw, headers = {}, expect = 200, redirect = 'follow' } = {}) {
  const response = await fetch(route.startsWith('http') ? route : base + route, {
    method, redirect,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const isJson = response.headers.get('content-type')?.includes('json');
  const data = isJson ? await response.json() : Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, expect, `${method} ${route} → ${response.status} ${isJson ? JSON.stringify(data) : ''}`);
  return Object.assign(data, { headers: response.headers });
}
let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }
async function account(name, role) {
  const email = `${name}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  const link = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await call('POST', '/api/auth/verify', { body: { token: link } });
  if (role) run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}
const wav = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.alloc(2000)]);
setSetting('sounds_disk_max', 1);
// L'adresse d'un mail envoyé vers le site devient une adresse du serveur de test.
const local = (url) => url.replace('https://site.test', base);

let bm, pack, tid, list, mails;
try {
  await step('contacts : en-tête reconnu, séparateurs, guillemets, noms sans en-tête', async () => {
    assert.deepEqual(contactsOf('Artiste;Prénom;Nom;E-mail\nBooba;Élie;Yaffa;Booba@92i.fr\n"Niska, le vrai";;;niska@test.fr\nPas de mail;;;\n'),
      [{ email: 'booba@92i.fr', name: 'Booba' }, { email: 'niska@test.fr', name: 'Niska, le vrai' }]);
    assert.deepEqual(contactsOf('Prénom,Nom,Email\nWilliam,Kalubi,damso@test.fr\n'), [{ email: 'damso@test.fr', name: 'William Kalubi' }]);
    assert.deepEqual(contactsOf('Damso <damso@test.fr>, Niska <niska@test.fr>\nbooba@92i.fr;Booba\nseul@test.fr\nDamso;DAMSO@test.fr'),
      [{ email: 'damso@test.fr', name: 'Damso' }, { email: 'niska@test.fr', name: 'Niska' }, { email: 'booba@92i.fr', name: 'Booba' }, { email: 'seul@test.fr', name: '' }]);
    assert.deepEqual(contactsOf('Nom\tMail\nSCH\tsch@test.fr\n'), [{ email: 'sch@test.fr', name: 'SCH' }]);
  });

  await step('liste de contacts importée : noms et adresses, vue CONTACTS', async () => {
    bm = await account('beatmaker', 'vip');
    list = await call('POST', '/api/me/sounds/mail-lists', { token: bm.token, body: { name: 'Rappeurs', emails: 'Nom;Mail\nBooba;booba@92i.fr\nNiska;niska@test.fr\nDamso;damso@test.fr\n' }, expect: 201 });
    assert.deepEqual(list.contacts.map((c) => [c.name, c.email, c.last]), [['Booba', 'booba@92i.fr', null], ['Niska', 'niska@test.fr', null], ['Damso', 'damso@test.fr', null]]);
    assert.deepEqual(list.emails, ['booba@92i.fr', 'niska@test.fr', 'damso@test.fr']);
    // Une ancienne liste, qui ne gardait que les adresses, se lit toujours.
    run(`UPDATE sound_mail_lists SET emails = '["vieux@test.fr"]' WHERE id = ?`, list.id);
    assert.deepEqual((await call('GET', `/api/me/sounds/mail-lists/${list.id}`, { token: bm.token })).contacts.map((c) => [c.email, c.name]), [['vieux@test.fr', '']]);
    await call('PATCH', `/api/me/sounds/mail-lists/${list.id}`, { token: bm.token, body: { emails: 'Booba <booba@92i.fr>\nNiska <niska@test.fr>\nDamso <damso@test.fr>' } });
  });

  await step('pack : téléchargement d\'office sur la page d\'écoute, couleurs de la pochette dans le mail', async () => {
    pack = (await call('POST', '/api/me/sounds/projects', { token: bm.token, body: { title: 'Pack', kind: 'pack' }, expect: 201 })).id;
    tid = (await call('POST', `/api/me/sounds/projects/${pack}/tracks?filename=Ghost%20150bpm%20Fmin.wav`, { token: bm.token, raw: wav, expect: 201 })).id;
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 60, b: 200 } } }).png().toBuffer();
    await call('PUT', `/api/me/sounds/projects/${pack}/cover`, { token: bm.token, raw: png, headers: { 'Content-Type': 'image/png' } });
    const { url } = await call('POST', '/api/me/sounds/links', { token: bm.token, body: { projectId: pack, download: false }, expect: 201 });
    const share = await call('POST', `/api/sounds/share/${new URL(url).searchParams.get('t')}`, { body: {} });
    assert.ok(share.download && share.tracks[0].version.downloadUrl);
    const { palette, html } = await call('POST', `/api/me/sounds/projects/${pack}/mail/preview`, { token: bm.token, body: { subject: 'x' } });
    assert.ok(palette && html.includes(`background:${palette.bg}`));
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(palette.accent.slice(i, i + 2), 16));
    assert.ok(b > r && b > g, `accent bleu attendu : ${palette.accent}`);
    const manual = await call('POST', `/api/me/sounds/projects/${pack}/mail/preview`, { token: bm.token, body: { subject: 'x', coverColors: false, colors: { bg: '#123456' } } });
    assert.equal(manual.palette, null);
    assert.ok(manual.html.includes('background:#123456'));
  });

  await step('sans boîte mail connectée, rien ne part ; une boîte mal réglée est refusée', async () => {
    await call('PATCH', `/api/me/sounds/projects/${pack}`, { token: bm.token, body: { mail: { to: 'booba@92i.fr, niska@test.fr, damso@test.fr', subject: 'Salut {nom}, nouveau pack', text: 'Yo {nom} !', trackIds: [tid] } } });
    await call('POST', `/api/me/sounds/projects/${pack}/mail/send`, { token: bm.token, expect: 400 });
    assert.deepEqual(await call('GET', '/api/me/sounds/mailer', { token: bm.token }).then((m) => m.connected), false);
    for (const host of ['localhost', '127.0.0.1', 'pas un hôte']) {
      await call('PUT', '/api/me/sounds/mailer', { token: bm.token, body: { host, port: 465, login: 'kay@gmail.com', password: 'x' }, expect: 400 });
    }
    await call('PUT', '/api/me/sounds/mailer', { token: bm.token, body: { host: 'smtp.gmail.com', port: 8080, login: 'kay@gmail.com', password: 'x' }, expect: 400 });
    const m = await call('PUT', '/api/me/sounds/mailer', { token: bm.token, body: { host: 'smtp.gmail.com', port: 465, login: 'kay@gmail.com', password: 'mot-de-passe-app', fromName: 'Kay Beats' } });
    assert.deepEqual([m.connected, m.fromEmail, m.password], [true, 'kay@gmail.com', undefined]);
    assert.notEqual(get('SELECT secret FROM sound_mailers WHERE user_id = ?', bm.id).secret, 'mot-de-passe-app');
  });

  await step('envoi depuis la boîte du beatmaker : un mail par contact, à son nom, avec désinscription', async () => {
    const before = outbox.length;
    const sent = await call('POST', `/api/me/sounds/projects/${pack}/mail/send`, { token: bm.token, expect: 202 });
    assert.equal(sent.total, 3);
    mails = outbox.slice(before);
    assert.deepEqual(mails.map((m) => [m.from, m.to, m.subject]), [
      ['"Kay Beats" <kay@gmail.com>', '"Booba" <booba@92i.fr>', 'Salut Booba, nouveau pack'],
      ['"Kay Beats" <kay@gmail.com>', '"Niska" <niska@test.fr>', 'Salut Niska, nouveau pack'],
      ['"Kay Beats" <kay@gmail.com>', '"Damso" <damso@test.fr>', 'Salut Damso, nouveau pack']]);
    assert.ok(mails[2].html.includes('Yo Damso !') && mails[2].headers['List-Unsubscribe']);
  });

  await step('suivi de Damso : ouverture, clic, écoute et téléchargement, à son nom', async () => {
    const html = mails[2].html;
    const pixel = html.match(/src="([^"]+o\.gif)"/)[1];
    const listen = html.match(/href="(https:\/\/site\.test\/ecoute\?t=[^"]+&amp;r=[^"]+)"/)[1].replace(/&amp;/g, '&');
    const [t, r] = [new URL(listen).searchParams.get('t'), new URL(listen).searchParams.get('r')];
    await call('GET', local(pixel));
    await call('GET', local(pixel)); // une seconde ouverture dans l'heure ne compte pas
    const share = await call('POST', `/api/sounds/share/${t}`, { body: { r } });
    await call('POST', `/api/sounds/share/${t}/play`, { body: { trackId: tid, r } });
    const file = await call('GET', share.tracks[0].version.downloadUrl);
    assert.ok(file.equals(wav));
    // Un faux destinataire glissé dans l'adresse de téléchargement casse la signature.
    await call('GET', share.tracks[0].version.downloadUrl.replace(`r=${r}`, 'r=autre'), { expect: 403 });
    const sends = await call('GET', `/api/me/sounds/projects/${pack}/mail/sends`, { token: bm.token });
    assert.deepEqual([sends[0].total, sends[0].sent, sends[0].opened, sends[0].clicked, sends[0].listened, sends[0].downloaded], [3, 3, 1, 1, 1, 1]);
    const detail = await call('GET', `/api/me/sounds/mail/sends/${sends[0].id}`, { token: bm.token });
    const damso = detail.recipients.find((x) => x.name === 'Damso');
    assert.deepEqual([damso.plays, damso.downloads, !!damso.openedAt, !!damso.clickedAt], [1, 1, true, true]);
    assert.deepEqual(damso.events.map((e) => e.type).sort(), ['download', 'open', 'play', 'visit']);
    assert.equal(detail.recipients.find((x) => x.name === 'Booba').openedAt, null);
    const contacts = (await call('GET', `/api/me/sounds/mail-lists/${list.id}`, { token: bm.token })).contacts;
    assert.equal(contacts.find((c) => c.name === 'Damso').last.downloads, 1);
    // Le beatmaker est prévenu au nom de Damso.
    assert.ok(outbox.some((m) => m.to === 'beatmaker@test.local' && /^Damso (écoute|a téléchargé)/.test(m.subject)));
  });

  await step('liens externes par une redirection signée ; désinscription respectée au prochain envoi', async () => {
    await call('PATCH', `/api/me/sounds/projects/${pack}`, { token: bm.token, body: { mail: { to: 'booba@92i.fr, niska@test.fr', subject: 'Re', text: 'Mon site : https://kay.fr/beats', trackIds: [] } } });
    const before = outbox.length;
    await call('POST', `/api/me/sounds/projects/${pack}/mail/send`, { token: bm.token, expect: 202 });
    const booba = outbox.slice(before).find((m) => m.to.includes('booba'));
    const out = booba.html.match(/href="([^"]+\/lien\?u=[^"]+)"/)[1].replace(/&amp;/g, '&');
    const redirect = await call('GET', local(out), { redirect: 'manual', expect: 302 });
    assert.equal(redirect.headers.get('location'), 'https://kay.fr/beats');
    await call('GET', local(out.replace('kay.fr', 'pirate.fr')), { expect: 404 });
    const unsub = booba.headers['List-Unsubscribe'].slice(1, -1);
    assert.match((await call('GET', local(unsub))).toString(), /Me désinscrire/);
    await call('POST', local(unsub));
    const next = outbox.length;
    const again = await call('POST', `/api/me/sounds/projects/${pack}/mail/send`, { token: bm.token, expect: 202 });
    assert.equal(again.total, 1);
    assert.deepEqual(outbox.slice(next).map((m) => m.to), ['"Niska" <niska@test.fr>']);
    assert.equal((await call('GET', `/api/me/sounds/mail-lists/${list.id}`, { token: bm.token })).contacts.find((c) => c.name === 'Booba').unsubscribed, true);
  });

  await step('envoi coupé par un redémarrage : il reprend là où il en était ; délai entre deux mails', async () => {
    const { resumeSends, GAP } = await import('../src/packsend.js');
    assert.ok(GAP[0] >= 10_000 && GAP[1] > GAP[0]);
    const s = (await call('GET', `/api/me/sounds/projects/${pack}/mail/sends`, { token: bm.token }))[0];
    const r = get('SELECT id FROM sound_mail_recipients WHERE send_id = ? LIMIT 1', s.id).id;
    run(`UPDATE sound_mail_recipients SET status = 'wait', sent_at = NULL WHERE id = ?`, r);
    run('UPDATE sound_mail_sends SET done_at = NULL WHERE id = ?', s.id);
    const view = (await call('GET', `/api/me/sounds/projects/${pack}/mail/sends`, { token: bm.token }))[0];
    assert.deepEqual([view.done, view.waiting], [false, 1]);
    const before = outbox.length;
    await resumeSends();
    assert.equal(outbox.length, before + 1);
    assert.equal(get('SELECT status FROM sound_mail_recipients WHERE id = ?', r).status, 'sent');
    assert.equal((await call('GET', `/api/me/sounds/projects/${pack}/mail/sends`, { token: bm.token }))[0].done, true);
  });

  await step('liste partagée par un fondateur : lue par les membres ONIRIQUE, intouchable par eux, invisible aux autres', async () => {
    const boss = await account('fondateur', 'founder'), member = await account('membre', 'vip'), client = await account('client');
    const l = await call('POST', '/api/me/sounds/mail-lists', { token: boss.token, body: { name: 'CSV ARTISTES BY ONIRIQUE', emails: 'Artist;Email\nORCA MUSIC;00orcamusic@gmail.com\nOnze;11onze.contactpro@gmail.com\n' }, expect: 201 });
    await call('PATCH', `/api/me/sounds/mail-lists/${list.id}`, { token: bm.token, body: { shared: true }, expect: 403 });
    await call('PATCH', `/api/me/sounds/mail-lists/${l.id}`, { token: boss.token, body: { shared: true } });
    const seen = (await call('GET', '/api/me/sounds/mail-lists', { token: member.token })).find((x) => x.id === l.id);
    assert.deepEqual([seen.name, seen.count, seen.shared, seen.mine], ['CSV ARTISTES BY ONIRIQUE', 2, true, false]);
    assert.deepEqual((await call('GET', `/api/me/sounds/mail-lists/${l.id}`, { token: member.token })).contacts.map((c) => c.name), ['ORCA MUSIC', 'Onze']);
    await call('PATCH', `/api/me/sounds/mail-lists/${l.id}`, { token: member.token, body: { name: 'x' }, expect: 404 });
    await call('DELETE', `/api/me/sounds/mail-lists/${l.id}`, { token: member.token, expect: 404 });
    // Un compte sans le rôle ONIRIQUE n'a pas ONIRIQUE CLOUD, ni la liste.
    await call('GET', `/api/me/sounds/mail-lists/${l.id}`, { token: client.token, expect: 403 });
  });

  await step('« Se connecter avec Google » : accès Gmail demandé, retour sur le pack, envoi par l\'API Gmail', async () => {
    const { url } = await call('POST', '/api/me/sounds/mailer/google', { token: bm.token, body: { projectId: pack, fromName: 'Kay Beats' } });
    const q = new URL(url).searchParams;
    assert.deepEqual([q.get('scope'), q.get('redirect_uri'), q.get('access_type')], ['openid email https://www.googleapis.com/auth/gmail.send', 'https://site.test/api/youtube/callback', 'offline']);
    const refused = await call('GET', `/api/youtube/callback?state=${q.get('state')}&code=faux`, { redirect: 'manual', expect: 302 });
    assert.match(decodeURIComponent(refused.headers.get('location')), /google=Google refuse/);
    const { url: again } = await call('POST', '/api/me/sounds/mailer/google', { token: bm.token, body: { projectId: pack, fromName: 'Kay Beats' } });
    const state = new URL(again).searchParams.get('state');
    const back = await call('GET', `/api/youtube/callback?state=${state}&code=bon-code`, { redirect: 'manual', expect: 302 });
    assert.equal(back.headers.get('location'), `https://site.test/mes-sons.html?google=ok#/p/${pack}`);
    // Une demande ne sert qu'une fois.
    assert.match(decodeURIComponent((await call('GET', `/api/youtube/callback?state=${state}&code=bon-code`, { redirect: 'manual', expect: 302 })).headers.get('location')), /expirée/);
    const m = await call('GET', '/api/me/sounds/mailer', { token: bm.token });
    assert.deepEqual([m.connected, m.google, m.fromEmail, m.fromName], [true, true, 'kay.beats@gmail.com', 'Kay Beats']);
    const { gmailTransport } = await import('../src/packsend.js');
    await gmailTransport(get('SELECT * FROM sound_mailers WHERE user_id = ?', bm.id)).sendMail({ from: '"Kay Beats" <kay.beats@gmail.com>', to: 'damso@test.fr', subject: 'Nouveau pack', text: 'Yo' });
    assert.equal(google.sent[0].auth, 'Bearer acces');
    assert.ok(/Subject: Nouveau pack/.test(google.sent[0].raw) && /To: damso@test\.fr/.test(google.sent[0].raw));
    // L'API Gmail coupée dans le projet Google : un message clair, en français.
    google.disabled = true;
    await assert.rejects(gmailTransport(get('SELECT * FROM sound_mailers WHERE user_id = ?', bm.id)).sendMail({ from: 'kay.beats@gmail.com', to: 'x@test.fr', subject: 's', text: 't' }),
      /L'API Gmail n'est pas activée/);
    google.disabled = false;
    // Les échecs d'un envoi repartent avec « Renvoyer aux échecs », et eux seuls.
    const sends = await call('GET', `/api/me/sounds/projects/${pack}/mail/sends`, { token: bm.token });
    const last = sends[0], failed = get(`SELECT id FROM sound_mail_recipients WHERE send_id = ? LIMIT 1`, last.id).id;
    run(`UPDATE sound_mail_recipients SET status = 'error', error = 'Gmail refuse' WHERE id = ?`, failed);
    const before = outbox.length;
    const retried = await call('POST', `/api/me/sounds/mail/sends/${last.id}/retry`, { token: bm.token, expect: 202 });
    assert.equal(retried.total, 1);
    assert.equal(outbox.length, before + 1);
    assert.equal(get('SELECT status FROM sound_mail_recipients WHERE id = ?', failed).status, 'sent');
    await call('POST', `/api/me/sounds/mail/sends/${last.id}/retry`, { token: bm.token, expect: 400 });
    // 450 mails par jour depuis une même adresse : partis sur 24 h comptés, renvoi compris.
    run(`UPDATE sound_mail_recipients SET sent_at = ? WHERE user_id = ?`, Date.now() - 86400_000 - 1, bm.id);
    const fill = run('INSERT INTO sound_mail_sends (user_id, project_id, subject, created_at, done_at) VALUES (?, ?, ?, ?, ?)', bm.id, pack, 'x', Date.now(), Date.now()).lastInsertRowid;
    for (let i = 0; i < 450; i++) run(`INSERT INTO sound_mail_recipients (send_id, user_id, token, email, status, sent_at, created_at) VALUES (?, ?, ?, ?, 'sent', ?, ?)`, fill, bm.id, `q${i}`, `q${i}@test.fr`, Date.now(), Date.now());
    run(`UPDATE sound_mail_recipients SET status = 'error' WHERE id = ?`, failed);
    const full = await call('POST', `/api/me/sounds/mail/sends/${last.id}/retry`, { token: bm.token, expect: 400 });
    assert.match(full.error, /450 mails au plus par jour depuis .* il en reste 0 /);
    run('DELETE FROM sound_mail_sends WHERE id = ?', fill);
    await call('DELETE', '/api/me/sounds/mailer', { token: bm.token });
    assert.equal(google.revoked, 1);
    await call('POST', `/api/me/sounds/mail/sends/${last.id}/retry`, { token: bm.token, expect: 400 });
  });

  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
