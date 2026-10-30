// Presskit envoyé par mail depuis la boîte du membre, et devis signé en ligne, sur une base jetable : node test/docs.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-docs-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test', PUBLIC_URL: 'https://site.test',
  GOOGLE_CLIENT_ID: 'client-google', GOOGLE_CLIENT_SECRET: 'secret-google' });

const { createApp } = await import('../src/app.js');
const { run, get } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, route, { token, body, expect = 200, redirect = 'follow', headers = {} } = {}) {
  const response = await fetch(base + route, {
    method, redirect, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : {};
  assert.equal(response.status, expect, `${method} ${route} → ${response.status} ${JSON.stringify(data)}`);
  return Object.assign(data, { headers: response.headers });
}
let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }
async function account(name) {
  const email = `${name}@test.local`;
  const { token } = await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse1', name }, expect: 201 });
  const link = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await call('POST', '/api/auth/verify', { body: { token: link } });
  return { token, email, id: get('SELECT id FROM users WHERE email = ?', email).id };
}

const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300_000, 7)]).toString('base64'); // plus lourd que la limite JSON habituelle
// Un logo assez lourd pour dépasser la limite JSON habituelle (200 ko).
const devis = { numero: 'DEV-1', nom: 'Kay Beats', objet: 'Prod du single', client: 'Damso', lignes: [{ d: 'Instru exclusive', q: '1', p: '300' }], logo: 'data:image/png;base64,' + 'A'.repeat(250_000) };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let kay, link;
try {
  await step('presskit : sans compte refusé, sans boîte mail refusé (compte gratuit, sans ONIRIQUE CLOUD)', async () => {
    await call('POST', '/api/me/docs/send', { body: { to: 'booking@salle.fr', subject: 'Presskit', pdf }, expect: 401 });
    kay = await account('kay');
    assert.equal((await call('GET', '/api/me/sounds/mailer', { token: kay.token })).connected, false);
    assert.match((await call('POST', '/api/me/docs/send', { token: kay.token, body: { to: 'booking@salle.fr', subject: 'Presskit', pdf }, expect: 400 })).error, /Relie d'abord ta boîte mail/);
  });

  await step('presskit : Gmail relié par mot de passe d\'application, le PDF part en pièce jointe depuis l\'adresse du membre', async () => {
    const m = await call('PUT', '/api/me/sounds/mailer', { token: kay.token, body: { host: 'smtp.gmail.com', port: 465, login: 'kay@gmail.com', password: 'abcdabcdabcdabcd', fromName: 'Kay Beats' } });
    assert.equal(m.fromEmail, 'kay@gmail.com');
    await call('POST', '/api/me/docs/send', { token: kay.token, body: { to: 'pas-une-adresse', subject: 'x', pdf }, expect: 400 });
    await call('POST', '/api/me/docs/send', { token: kay.token, body: { to: 'booking@salle.fr', subject: 'x', pdf: Buffer.from('pas un pdf').toString('base64') }, expect: 400 });
    const r = await call('POST', '/api/me/docs/send', { token: kay.token, body: { to: 'Booking@Salle.fr', subject: 'Presskit — Kay', text: 'Bonjour,\nmon presskit.', filename: 'Presskit Kay', pdf } });
    assert.equal(r.from, 'kay@gmail.com');
    const mail = outbox.at(-1); // le transport de test garde la pièce jointe en base64
    assert.deepEqual([mail.from, mail.to, mail.subject, mail.attachments[0].filename, Buffer.from(mail.attachments[0].content, 'base64').subarray(0, 5).toString()],
      ['"Kay Beats" <kay@gmail.com>', 'booking@salle.fr', 'Presskit — Kay', 'Presskit Kay.pdf', '%PDF-']);
  });

  await step('« Relier mon Gmail » depuis le presskit : Google revient sur la page presskit', async () => {
    const { url } = await call('POST', '/api/me/sounds/mailer/google', { token: kay.token, body: { back: 'presskit' } });
    const state = new URL(url).searchParams.get('state');
    const back = await call('GET', `/api/youtube/callback?state=${state}&code=faux`, { redirect: 'manual', expect: 302 });
    assert.match(back.headers.get('location'), /^https:\/\/site\.test\/presskit\.html\?google=/);
    const { url: other } = await call('POST', '/api/me/sounds/mailer/google', { token: kay.token, body: { back: '../evil' } });
    const away = await call('GET', `/api/youtube/callback?state=${new URL(other).searchParams.get('state')}&code=faux`, { redirect: 'manual', expect: 302 });
    assert.match(away.headers.get('location'), /^https:\/\/site\.test\/mes-sons\.html\?google=/);
  });

  await step('devis à signer : gardé avec son empreinte, le lien part depuis la boîte du membre', async () => {
    await call('POST', '/api/me/docs/sign', { body: { data: devis }, expect: 401 });
    await call('POST', '/api/me/docs/sign', { token: kay.token, body: { data: { pas: 'un devis' } }, expect: 400 });
    const r = await call('POST', '/api/me/docs/sign', { token: kay.token, body: { data: devis, to: 'damso@test.fr' }, expect: 201 });
    assert.match(r.link, /^https:\/\/site\.test\/devis\.html\?signer=[\w-]{20,}$/);
    link = r.token;
    const mail = outbox.at(-1);
    assert.deepEqual([mail.from, mail.to, mail.subject], ['"Kay Beats" <kay@gmail.com>', 'damso@test.fr', 'Devis DEV-1 à signer — Kay Beats']);
    assert.ok(mail.text.includes(r.link));
    const v = await call('GET', `/api/docs/sign/${link}`);
    assert.deepEqual([v.signed, v.data.client, v.data.logo.length, v.hash.length], [false, 'Damso', devis.logo.length, 64]);
  });

  await step('sans boîte mail reliée : le lien part d\'ONIRIQUE, la réponse revient au membre ; sans adresse, juste le lien', async () => {
    await call('DELETE', '/api/me/sounds/mailer', { token: kay.token });
    await call('POST', '/api/me/docs/sign', { token: kay.token, body: { data: devis, to: 'niska@test.fr' }, expect: 201 });
    const mail = outbox.at(-1);
    assert.deepEqual([mail.from, mail.to, mail.replyTo], ['ONIRIQUE <support@test.local>', 'niska@test.fr', kay.email]);
    const count = outbox.length;
    const r = await call('POST', '/api/me/docs/sign', { token: kay.token, body: { data: devis }, expect: 201 });
    assert.equal(r.sentTo, '');
    assert.equal(outbox.length, count);
  });

  await step('signature : nom, case « Bon pour accord » et dessin exigés', async () => {
    await call('POST', `/api/docs/sign/${link}`, { body: { name: 'W', signature: png, accept: true }, expect: 400 });
    await call('POST', `/api/docs/sign/${link}`, { body: { name: 'William Kalubi', signature: png }, expect: 400 });
    await call('POST', `/api/docs/sign/${link}`, { body: { name: 'William Kalubi', signature: 'javascript:alert(1)', accept: true }, expect: 400 });
    await call('POST', '/api/docs/sign/inconnu', { body: { name: 'William Kalubi', signature: png, accept: true }, expect: 404 });
  });

  await step('signé : trace gardée, l\'émetteur et le client reçoivent le devis signé ; une seule signature', async () => {
    const s = await call('POST', `/api/docs/sign/${link}`, { body: { name: 'William Kalubi', signature: png, accept: true }, headers: { 'User-Agent': 'Téléphone de test' } });
    assert.deepEqual([s.signed, s.signerName, s.signature, s.signerAgent], [true, 'William Kalubi', png, 'Téléphone de test']);
    assert.ok(s.signedAt && s.signerIp);
    const toKay = outbox.find((m) => m.to === kay.email && /signé par William Kalubi/.test(m.subject));
    const toClient = outbox.find((m) => m.to === 'damso@test.fr' && /signature est enregistrée/.test(m.subject));
    for (const m of [toKay, toClient]) {
      assert.ok(m.text.includes(`https://site.test/devis.html?signer=${link}`));
      assert.ok(m.text.includes(s.hash));
      assert.match(m.text, /Signé par : William Kalubi/);
    }
    await call('POST', `/api/docs/sign/${link}`, { body: { name: 'Quelqu\'un', signature: png, accept: true }, expect: 409 });
    assert.equal((await call('GET', `/api/docs/sign/${link}`)).signerName, 'William Kalubi');
  });

  await step('compte supprimé : ses devis à signer partent avec lui', async () => {
    run('DELETE FROM users WHERE id = ?', kay.id);
    await call('GET', `/api/docs/sign/${link}`, { expect: 404 });
  });

  console.log(`\n${passed} étapes réussies.`);
} finally {
  server.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
