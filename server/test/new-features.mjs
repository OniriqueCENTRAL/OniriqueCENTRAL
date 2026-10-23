import crypto from 'node:crypto';
// Essais remis à zéro, validation de l'adresse e-mail, abonnement à la carte : le serveur entier, sur une base
// jetable, sans rien envoyer (SMTP_HOST=test) et sans paiement réel (PAYMENTS_MODE=demo).
//
//   node test/new-features.mjs            les trois fonctions
//   node test/new-features.mjs migration  une base d'avant ces changements est reprise sans rien perdre
//   node test/new-features.mjs nomail     sans serveur de messagerie, personne n'est retenu
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const scenario = process.argv[2] || 'main';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-test-'));

process.env.DATA_DIR = dataDir;
process.env.PAYMENTS_MODE = 'demo';
process.env.TRIALS_PER_IP = '1000';
const machine = (seed) => crypto.createHash('sha256').update('test:' + String(seed)).digest('hex').slice(0, 40); // un ordinateur par compte

process.env.PUBLIC_URL = 'http://localhost';
process.env.SITE_URL = 'https://site.test';
process.env.SMTP_USER = 'support@site.test';
if (scenario === 'nomail') delete process.env.SMTP_HOST;
else process.env.SMTP_HOST = 'test';

let failures = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
}

// Une base telle que le serveur la laissait avant : pas de colonne email_verified, pas de genre de formule.
if (scenario === 'migration') {
  const old = new DatabaseSync(path.join(dataDir, 'central.db'));
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', stripe_customer TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE plans (id INTEGER PRIMARY KEY, name TEXT NOT NULL, interval TEXT NOT NULL CHECK (interval IN ('month', 'year')),
      price_cents INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE subscriptions (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, plan_id INTEGER NOT NULL REFERENCES plans(id),
      status TEXT NOT NULL, current_period_end INTEGER NOT NULL, cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      stripe_subscription TEXT, updated_at INTEGER NOT NULL);
    INSERT INTO users (email, password_hash, created_at) VALUES ('ancien@site.test', 'x', 1);
    INSERT INTO plans (name, interval, price_cents) VALUES ('ALL ACCESS — mensuel', 'month', 990);
    INSERT INTO subscriptions (user_id, plan_id, status, current_period_end, updated_at) VALUES (1, 1, 'active', ${Date.now() + 86400_000}, 1);
  `);
  old.close();
}

const { createApp } = await import('../src/app.js');
const { get, run, now } = await import('../src/db.js');
const { hashPassword, createSession } = await import('../src/auth.js');
const { outbox } = await import('../src/mail.js');
const { codeAt } = await import('../src/totp.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;

async function api(method, route, body, token) {
  const response = await fetch(base + route, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

/** Le jeton du dernier lien de validation envoyé à cette adresse. */
const linkTo = (email) => outbox.filter((m) => m.to === email && m.text.includes('?verify=')).at(-1)?.text.match(/\?verify=([\w-]+)/)?.[1];

try {
  if (scenario === 'migration') {
    console.log('une base d\'avant ces changements');
    check(get('SELECT email_verified AS v FROM users WHERE id = 1').v === 1, 'un compte déjà là est tenu pour validé');
    check(get('SELECT kind FROM plans WHERE id = 1').kind === 'all', 'une formule déjà là reste une formule à tout le catalogue');
    check(get('SELECT product_ids AS p FROM subscriptions WHERE user_id = 1').p === null, 'un abonnement déjà là couvre toujours tout');

    run(`INSERT INTO products (slug, name, price_cents, created_at) VALUES ('tuner', 'ONIRIQUE TUNER', 4900, ?)`, now());
    const token = createSession(1);
    const me = await api('GET', '/me', null, token);
    check(me.data.user.emailVerified === true && me.data.entitlements[1]?.via === 'subscription', 'et donne toujours droit aux plugins');
    const trial = await api('POST', '/licenses/activate', { productId: 1, machineId: 'a'.repeat(32) }, token);
    check(trial.status === 200, 'et permet toujours d\'activer un plugin, sans rien avoir à valider');
  } else if (scenario === 'nomail') {
    console.log('sans serveur de messagerie');
    run(`INSERT INTO products (slug, name, price_cents, created_at) VALUES ('tuner', 'ONIRIQUE TUNER', 4900, ?)`, now());
    const created = await api('POST', '/auth/register', { email: 'libre@site.test', password: 'motdepasse' });
    check(created.status === 201 && created.data.user.emailVerified === true && created.data.verificationSent === false,
      'un compte créé est validé d\'office : aucun lien ne pourrait lui parvenir');
    check((await api('POST', '/licenses/trial', { productId: 1, machineId: machine(created.data.token) }, created.data.token)).status === 201, 'et peut lancer un essai');
  } else {
    // Un admin, et deux plugins payants plus un gratuit.
    run(`INSERT INTO users (email, name, password_hash, role, email_verified, created_at) VALUES ('admin@site.test', 'Admin', ?, 'admin', 1, ?)`,
      hashPassword('adminadmin'), now());
    const admin = createSession(get(`SELECT id FROM users WHERE email = 'admin@site.test'`).id);
    const ids = [];
    for (const [name, priceCents] of [['ONIRIQUE TUNER', 4900], ['ONIRIQUE BASED', 5900], ['ONIRIQUE RESOBOX', 3900], ['ONIRIQUE FREE', 0]]) {
      ids.push((await api('POST', '/admin/products', { name, priceCents }, admin)).data.id);
    }
    const [tuner, based, resobox, free] = ids;

    console.log('ordre de la boutique');
    const adminOrder = async () => (await api('GET', '/admin/products', null, admin)).data.map((p) => p.id);
    const shopOrder = async () => (await api('GET', '/catalog')).data.products.map((p) => p.id).filter((id) => ids.includes(id));
    check(JSON.stringify(await adminOrder()) === JSON.stringify(ids), "au départ, l'ordre d'ajout");
    const chosen = [free, resobox, tuner, based];
    check((await api('PUT', '/admin/products/order', { ids: chosen }, admin)).status === 200, "l'équipe choisit un autre ordre");
    check(JSON.stringify(await adminOrder()) === JSON.stringify(chosen), 'le panel le suit');
    const shown = await shopOrder();
    check(shown.length > 0 && JSON.stringify(shown) === JSON.stringify(chosen.filter((id) => shown.includes(id))), "la boutique et l'application aussi");
    check((await api('PUT', '/admin/products/order', { ids: [tuner, tuner] }, admin)).status === 400
      && (await api('PUT', '/admin/products/order', { ids: [tuner, 99999] }, admin)).status === 400, 'une liste invalide est refusée');
    const extra = (await api('POST', '/admin/products', { name: 'ONIRIQUE EXTRA', priceCents: 0 }, admin)).data.id;
    check((await adminOrder()).at(-1) === extra, 'un nouveau plugin se range à la fin');
    run('DELETE FROM products WHERE id = ?', extra);
    await api('PUT', '/admin/products/order', { ids }, admin); // la suite des essais garde l'ordre d'ajout

    console.log('validation de l\'adresse e-mail');
    const created = await api('POST', '/auth/register', { email: 'nouveau@site.test', password: 'motdepasse', name: 'Nouveau' });
    const user = created.data.token;
    check(created.status === 201 && created.data.verificationSent === true && created.data.user.emailVerified === false,
      'un compte créé n\'est pas encore validé');
    const mail = outbox.find((m) => m.to === 'nouveau@site.test');
    check(!!mail && mail.subject.includes('Validez') && mail.text.includes('https://site.test/compte?verify='),
      'un e-mail part vers son adresse, avec un lien vers la page compte du site');
    check((await api('GET', '/me', null, user)).status === 200, 'il peut se connecter et voir son compte');
    check((await api('POST', '/licenses/trial', { productId: tuner, machineId: machine(user) }, user)).status === 403, 'mais pas lancer un essai');
    check((await api('POST', '/checkout', { kind: 'product', id: tuner }, user)).status === 403, 'ni acheter');
    check((await api('POST', '/licenses/activate', { productId: tuner, machineId: 'a'.repeat(32) }, user)).status === 403, 'ni activer un plugin');
    check((await api('POST', '/auth/verify', { token: 'faux' })).status === 400, 'un lien inventé est refusé');

    const first = linkTo('nouveau@site.test');
    const tooSoon = await api('POST', '/auth/verify/resend', null, user);
    check(tooSoon.status === 429 && /attendez encore \d+ s/.test(tooSoon.data.error) && linkTo('nouveau@site.test') === first,
      'pas de nouveau lien moins d\'une minute après le précédent');
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;   // une minute plus tard
    check((await api('POST', '/auth/verify/resend', null, user)).status === 200 && linkTo('nouveau@site.test') !== first,
      'il peut redemander un lien une minute après');
    check((await api('POST', '/auth/verify/resend', null, user)).status === 429, 'puis attendre de nouveau une minute');
    Date.now = realNow;
    check((await api('POST', '/auth/verify', { token: first })).status === 400, 'qui périme le précédent');
    check((await api('POST', '/auth/verify', { token: linkTo('nouveau@site.test') })).status === 200, 'le lien valide le compte');
    check((await api('POST', '/auth/verify', { token: linkTo('nouveau@site.test') })).status === 400, 'et ne sert qu\'une fois');
    check((await api('GET', '/me', null, user)).data.user.emailVerified === true, 'le compte est alors validé');
    check((await api('POST', '/licenses/trial', { productId: tuner, machineId: machine(user) }, user)).status === 201, 'et l\'essai se lance');
    for (let i = 0; i < 3; i++) await api('POST', '/auth/verify/resend', null, user);
    check((await api('POST', '/auth/verify/resend', null, user)).data.alreadyVerified === true, 'redemander un lien ne fait alors plus rien');

    console.log('double authentification (A2F)');
    const a2f = (await api('POST', '/auth/register', { email: 'a2f@site.test', password: 'motdepasse' })).data.token;
    run(`UPDATE users SET email_verified = 1 WHERE email = 'a2f@site.test'`);
    const login = (code) => api('POST', '/auth/login', { email: 'a2f@site.test', password: 'motdepasse', ...(code ? { code } : {}) });
    check((await api('POST', '/me/2fa/setup', { password: 'mauvais' }, a2f)).status === 403, 'activation refusée sans le bon mot de passe');
    const setup = (await api('POST', '/me/2fa/setup', { password: 'motdepasse' }, a2f)).data;
    check(/^[A-Z2-7]{32}$/.test(setup.secret) && setup.qr.startsWith('<svg') && setup.uri.startsWith('otpauth://totp/'), 'une clé et son QR code');
    check((await login()).status === 200, "pas encore active tant qu'aucun code n'est confirmé");
    const step = Math.floor(Date.now() / 30_000);
    const wrong = codeAt(setup.secret, step) === '123456' ? '654321' : '123456';
    check((await api('POST', '/me/2fa/enable', { code: wrong }, a2f)).status === 400, 'un faux code ne l\'active pas');
    const enabled = await api('POST', '/me/2fa/enable', { code: codeAt(setup.secret, step) }, a2f);
    const recovery = enabled.data.recoveryCodes || [];
    check(enabled.status === 200 && recovery.length === 8, 'un vrai code l\'active, avec 8 codes de secours');
    check((await api('GET', '/me', null, a2f)).data.user.twoFactor === true, 'le compte l\'affiche');
    const asked = await login();
    check(asked.status === 401 && asked.data.twoFactor === true && !asked.data.token, 'la connexion demande alors le code');
    check((await api('POST', '/auth/login', { email: 'a2f@site.test', password: 'mauvais' })).data.twoFactor === undefined,
      'sans le bon mot de passe, rien ne dit que l\'A2F est active');
    check((await login(wrong)).status === 401, 'un faux code est refusé');
    check((await login(codeAt(setup.secret, step))).status === 401, 'le code déjà servi à l\'activation ne se rejoue pas');
    Date.now = () => realNow() + 30_000;   // le code suivant
    const next = await login(codeAt(setup.secret, step + 1));
    check(next.status === 200 && !!next.data.token, 'le code suivant ouvre la session');
    Date.now = realNow;
    check((await login(recovery[0].toLowerCase())).status === 200, 'un code de secours aussi');
    check((await login(recovery[0])).status === 401, 'une seule fois');
    check((await api('POST', '/me/2fa/disable', { password: 'motdepasse', code: wrong }, a2f)).status === 403, 'désactivation refusée sans un bon code');
    check((await api('POST', '/me/2fa/disable', { password: 'motdepasse', code: recovery[1] }, a2f)).status === 200
      && (await login()).status === 200, 'désactivée avec le mot de passe et un code de secours');
    await api('POST', '/me/2fa/setup', { password: 'motdepasse' }, a2f);
    const again = get(`SELECT id, totp_pending FROM users WHERE email = 'a2f@site.test'`);
    await api('POST', '/me/2fa/enable', { code: codeAt(again.totp_pending, Math.floor(Date.now() / 30_000)) }, a2f);
    check((await login()).status === 401, 'réactivée');
    check((await api('PATCH', `/admin/users/${again.id}`, { twoFactor: false }, admin)).status === 200
      && !get('SELECT totp_secret FROM users WHERE id = ?', again.id).totp_secret,
      'le support peut la retirer (téléphone et codes de secours perdus)');

    console.log('suppression de son compte');
    const leaving = (await api('POST', '/auth/register', { email: 'partant@site.test', password: 'motdepasse' })).data.token;
    check((await api('POST', '/me/delete', { password: 'mauvais' }, leaving)).status === 403, 'refusée sans le bon mot de passe');
    check((await api('GET', '/me', null, leaving)).status === 200, 'le compte est alors intact');
    check((await api('POST', '/me/delete', { password: 'motdepasse' }, leaving)).status === 200, 'acceptée avec le mot de passe');
    check(!get(`SELECT id FROM users WHERE email = 'partant@site.test'`), 'le compte est effacé');
    check((await api('GET', '/me', null, leaving)).status === 401, 'sa session ne marche plus');
    check((await api('POST', '/auth/login', { email: 'partant@site.test', password: 'motdepasse' })).status === 401, 'et il ne peut plus se connecter');
    run(`INSERT INTO users (email, password_hash, role, email_verified, created_at) VALUES ('fondateur@site.test', ?, 'founder', 1, ?)`, hashPassword('motdepasse'), now());
    const founder = (await api('POST', '/auth/login', { email: 'fondateur@site.test', password: 'motdepasse' })).data.token;
    check((await api('POST', '/me/delete', { password: 'motdepasse' }, founder)).status === 403 && !!get(`SELECT id FROM users WHERE email = 'fondateur@site.test'`),
      'un fondateur ne se supprime pas depuis le site');

    console.log('page de liens des membres ONIRIQUE et des fondateurs');
    check((await api('GET', '/me/links', null, admin)).status === 200, 'ouverte aux admins');
    run(`INSERT INTO users (email, password_hash, role, email_verified, created_at) VALUES ('client-liens@site.test', ?, 'user', 1, ?)`, hashPassword('motdepasse'), now());
    const linkClient = (await api('POST', '/auth/login', { email: 'client-liens@site.test', password: 'motdepasse' })).data.token;
    check((await api('GET', '/me/links', null, linkClient)).status === 403, 'mais pas aux clients');
    run(`INSERT INTO users (email, password_hash, role, email_verified, created_at) VALUES ('membre-liens@site.test', ?, 'vip', 1, ?)`, hashPassword('motdepasse'), now());
    const linkMember = (await api('POST', '/auth/login', { email: 'membre-liens@site.test', password: 'motdepasse' })).data.token;
    check((await api('PUT', '/me/links', { handle: 'membre-onirique', page: { name: 'Membre' } }, linkMember)).status === 200, 'un membre ONIRIQUE crée sa page');
    check((await fetch(`${base.replace(/\/api$/, '')}/l/membre-onirique`)).status === 200, 'et elle est en ligne');
    const blank = (await api('GET', '/me/links', null, founder)).data;
    check(blank.handle === null && blank.page.theme.button.style === 'glass', 'au départ : pas de page, un thème par défaut');
    check((await api('PUT', '/me/links', { handle: 'A B', page: {} }, founder)).status === 400, 'une adresse invalide est refusée');
    check((await api('PUT', '/me/links', { handle: 'admin', page: {} }, founder)).status === 409, 'une adresse réservée est refusée');
    const savedPage = await api('PUT', '/me/links', { handle: 'euhz', page: {
      name: 'EUHZ', bio: 'Ingé son', theme: { bg1: 'rouge', text: '#FFFFFF', font: 'comic', button: { style: 'fill', shape: 'square' } },
      links: [{ label: 'Spotify', url: 'https://open.spotify.com/artist/abc' }, { label: 'Piège', url: 'javascript:alert(1)' },
        { label: 'Insta', url: 'instagram.com/euhz', kind: 'icon' }, { label: 'Mail', url: 'mailto:euhz@site.test', on: false },
        { label: 'Son', url: 'https://exemple.fr/son', kind: 'music', music: { title: 'Faux', platforms: [{ id: 'spotify', url: 'javascript:alert(1)' }] },
          custom: { deezer: 'deezer.page.link/abc', tidal: 'javascript:alert(1)', inconnue: 'https://x.fr' } }] } }, founder);
    const pg = savedPage.data.page;
    check(savedPage.status === 200 && pg.links.length === 4 && !pg.links.some((l) => /javascript/.test(l.url)), 'un lien javascript: est écarté');
    check(pg.links[3].kind === 'music' && pg.links[3].music === undefined, 'un lien Musique garde sa catégorie, mais pas de plateformes envoyées par le navigateur');
    check(JSON.stringify(pg.links[3].custom) === '{"deezer":"https://deezer.page.link/abc"}', 'ses propres liens sur les autres plateformes sont gardés, vérifiés');
    check(pg.links[1].url === 'https://instagram.com/euhz' && pg.links[1].kind === 'icon' && pg.links[2].on === false, 'les autres liens sont gardés, complétés');
    check(pg.theme.bg1 === '#0d0809' && pg.theme.text === '#ffffff' && pg.theme.font === 'hanken' && pg.theme.button.style === 'fill', 'une valeur inconnue reprend celle par défaut');
    const pub = await api('GET', '/links/EUHZ');
    check(pub.status === 200 && pub.data.page.name === 'EUHZ' && pub.data.handle === 'euhz', 'la page publique se lit sans compte');
    run(`INSERT INTO users (email, password_hash, role, email_verified, created_at) VALUES ('fondateur2@site.test', ?, 'founder', 1, ?)`, hashPassword('motdepasse'), now());
    const founder2 = (await api('POST', '/auth/login', { email: 'fondateur2@site.test', password: 'motdepasse' })).data.token;
    check((await api('PUT', '/me/links', { handle: 'euhz', page: {} }, founder2)).status === 409, 'une adresse prise ne se reprend pas');
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(200)]);
    const sent = await fetch(`${base}/me/links/image?kind=avatar`, { method: 'PUT', headers: { Authorization: `Bearer ${founder}`, 'Content-Type': 'image/png' }, body: png });
    const withPhoto = await sent.json();
    check(sent.status === 200 && /^\/api\/media\//.test(withPhoto.avatar) && (await api('GET', '/links/euhz')).data.avatar === withPhoto.avatar, 'la photo de la page');
    check((await fetch(`${base}/me/links/image?kind=avatar`, { method: 'PUT', headers: { Authorization: `Bearer ${founder2}`, 'Content-Type': 'image/png' }, body: png })).status === 400,
      "une image avant d'avoir enregistré la page est refusée");
    run(`UPDATE users SET role = 'user' WHERE email = 'fondateur@site.test'`);
    check((await api('GET', '/links/euhz')).status === 404, "la page disparaît si son auteur n'est plus fondateur");
    run(`UPDATE users SET role = 'founder' WHERE email = 'fondateur@site.test'`);

    console.log('page publique, aperçu de partage et statistiques');
    const root = base.replace(/\/api$/, '');
    const visit = (ua = 'Mozilla/5.0 (iPhone) Instagram') => fetch(`${root}/l/euhz`, { headers: { 'User-Agent': ua } });
    const html = await (await visit()).text();
    check(html.includes('<meta property="og:title" content="EUHZ · ONIRIQUE">') && html.includes('content="Ingé son"')
      && /og:image" content="https:\/\/site\.test\/api\/links\/euhz\/apercu\.png\?v=\w+"/.test(html), 'la page porte son titre, sa bio et son image de partage');
    check(!html.includes('<script>alert') && html.includes('const data = {'), 'les données de la page sont dans la page, sans second appel');
    check((await fetch(`${root}/l/personne`)).status === 404, 'une page inconnue répond 404');
    await visit();
    await visit('WhatsApp/2.23 A');
    await visit('facebookexternalhit/1.1');
    const linkId = pg.links[0].id;
    const click = (id) => fetch(`${base}/links/euhz/click`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, body: JSON.stringify({ id }) });
    check((await click(linkId)).status === 204 && (await click(linkId)).status === 204 && (await click('inconnu')).status === 204, 'les clics sont reçus');
    const stats = (await api('GET', '/me/links/stats?days=7', null, founder)).data;
    check(stats.views === 1 && stats.clicks === 1 && stats.links[linkId] === 1 && stats.daily.length === 7 && stats.daily[6].views === 1,
      'une visite et un clic par personne, sans les robots ni les aperçus');
    check((await api('GET', '/me/links/stats', null, linkClient)).status === 403, 'pas de statistiques pour un client');
    const og = await fetch(`${base}/links/euhz/apercu.png`);
    const ogData = Buffer.from(await og.arrayBuffer());
    const { default: sharpLib } = await import('sharp');
    const ogMeta = await sharpLib(ogData).metadata();
    check(og.status === 200 && og.headers.get('content-type') === 'image/png' && ogMeta.width === 1200 && ogMeta.height === 630, "l'image d'aperçu fait 1200 × 630");

    // Une licence réservée à une adresse ne doit revenir qu'à qui prouve que l'adresse est la sienne.
    await api('POST', '/admin/licenses', { productId: based, email: 'client@site.test' }, admin);
    const client = (await api('POST', '/auth/register', { email: 'client@site.test', password: 'motdepasse' })).data.token;
    check((await api('GET', '/me', null, client)).data.licenses.length === 0, 'une licence réservée à une adresse n\'est pas donnée à l\'inscription');
    await api('POST', '/auth/verify', { token: linkTo('client@site.test') });
    check((await api('GET', '/me', null, client)).data.licenses.length === 1, 'mais une fois l\'adresse validée');

    const listed = (await api('GET', '/admin/users?q=', null, admin)).data;
    const fresh = (await api('POST', '/auth/register', { email: 'attente@site.test', password: 'motdepasse' })).data;
    const waiting = (await api('GET', '/admin/users?q=attente', null, admin)).data[0];
    check(listed.every((u) => u.emailVerified === 1) && waiting.emailVerified === 0, 'le panel admin montre qui n\'a pas validé');
    check((await api('PATCH', `/admin/users/${waiting.id}`, { emailVerified: true }, admin)).status === 200
      && (await api('GET', '/me', null, fresh.token)).data.user.emailVerified === true, 'et un admin peut valider une adresse à la main');

    console.log('remise à zéro des essais gratuits');
    const userRow = (await api('GET', '/admin/users?q=nouveau', null, admin)).data[0];
    check(userRow.trials === 1, 'le panel admin compte les essais d\'un compte');
    await api('POST', '/licenses/activate', { productId: tuner, machineId: 'b'.repeat(32) }, user);
    check((await api('POST', '/licenses/trial', { productId: tuner, machineId: machine(user) }, user)).status === 409, 'un essai ne se reprend pas');
    check((await api('POST', `/admin/users/${userRow.id}/reset-trials`, null, user)).status === 403, 'un simple utilisateur ne peut pas remettre ses essais à zéro');
    const reset = await api('POST', `/admin/users/${userRow.id}/reset-trials`, null, admin);
    check(reset.status === 200 && reset.data.removed === 1, 'un admin le peut');
    let me = (await api('GET', '/me', null, user)).data;
    check(me.trialsUsed.length === 0 && me.licenses.length === 0 && me.activations.length === 0 && !me.entitlements[tuner],
      'l\'essai, sa licence et sa machine activée ont disparu');
    check((await api('POST', '/licenses/trial', { productId: tuner, machineId: machine(user) }, user)).status === 201, 'et l\'essai peut être relancé');

    // Ce qui n'est pas un essai ne doit pas être touché.
    const clientRow = (await api('GET', '/admin/users?q=client', null, admin)).data[0];
    await api('POST', `/admin/users/${clientRow.id}/reset-trials`, null, admin);
    check((await api('GET', '/me', null, client)).data.licenses.length === 1, 'une licence achetée ou offerte n\'est pas touchée');

    console.log('abonnement à la carte');
    const catalog = (await api('GET', '/catalog')).data;
    check(catalog.pick.baseCents === 999 && catalog.pick.extraCents === 500, 'le catalogue annonce 9,99 € puis 5 € par plugin ajouté');
    check((await api('POST', '/checkout', { kind: 'pick', productIds: [] }, client)).status === 400, 'il faut choisir au moins un plugin');
    check((await api('POST', '/checkout', { kind: 'pick', productIds: [free] }, client)).status === 400, 'un plugin gratuit ne s\'ajoute pas');
    check((await api('POST', '/checkout', { kind: 'pick', productIds: [based] }, client)).status === 409, 'ni un plugin déjà possédé');
    check((await api('POST', '/checkout', { kind: 'pick', productIds: [9999] }, client)).status === 404, 'ni un plugin qui n\'existe pas');

    const one = await api('POST', '/checkout', { kind: 'pick', productIds: [tuner] }, client);
    me = (await api('GET', '/me', null, client)).data;
    check(one.status === 200 && me.subscription.priceCents === 999 && me.subscription.kind === 'pick', 'un plugin : 9,99 €');
    check(me.entitlements[tuner]?.via === 'subscription' && !me.entitlements[resobox], 'il donne droit à ce plugin, et à lui seul');
    check((await api('POST', '/licenses/activate', { productId: tuner, machineId: 'c'.repeat(32) }, client)).status === 200
      && (await api('POST', '/licenses/activate', { productId: resobox, machineId: 'c'.repeat(32) }, client)).status === 403,
      'le plugin choisi s\'active, un autre non');
    check((await api('POST', '/checkout', { kind: 'pick', productIds: [resobox] }, client)).status === 409, 'un seul abonnement à la fois');

    const two = (await api('POST', '/auth/register', { email: 'deux@site.test', password: 'motdepasse' })).data.token;
    await api('POST', '/auth/verify', { token: linkTo('deux@site.test') });
    await api('POST', '/checkout', { kind: 'pick', productIds: [tuner, based] }, two);
    check((await api('GET', '/me', null, two)).data.subscription.priceCents === 1499, 'deux plugins : 14,99 €');

    const three = (await api('POST', '/auth/register', { email: 'trois@site.test', password: 'motdepasse' })).data.token;
    await api('POST', '/auth/verify', { token: linkTo('trois@site.test') });
    await api('POST', '/checkout', { kind: 'pick', productIds: [tuner, based, resobox, tuner] }, three);
    me = (await api('GET', '/me', null, three)).data;
    check(me.subscription.priceCents === 1999 && me.subscription.productIds.length === 3, 'trois plugins : 19,99 €, un doublon ne comptant pas');
    check([tuner, based, resobox].every((id) => me.entitlements[id]?.via === 'subscription'), 'et les trois sont accordés');

    check((await api('GET', '/catalog')).data.plans.every((p) => p.kind === 'all'), 'la formule à la carte ne se mêle pas aux formules à tout le catalogue');
    check((await api('POST', '/checkout', { kind: 'plan', id: get(`SELECT id FROM plans WHERE kind = 'pick'`).id }, user)).status === 404,
      'et ne peut pas être prise comme telle');
  }
} catch (error) {
  console.error(error);
  failures++;
}

server.close();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log(failures === 0 ? '\ntout passe' : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
