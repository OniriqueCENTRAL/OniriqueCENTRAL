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
    check((await api('POST', '/licenses/trial', { productId: 1 }, created.data.token)).status === 201, 'et peut lancer un essai');
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

    console.log('validation de l\'adresse e-mail');
    const created = await api('POST', '/auth/register', { email: 'nouveau@site.test', password: 'motdepasse', name: 'Nouveau' });
    const user = created.data.token;
    check(created.status === 201 && created.data.verificationSent === true && created.data.user.emailVerified === false,
      'un compte créé n\'est pas encore validé');
    const mail = outbox.find((m) => m.to === 'nouveau@site.test');
    check(!!mail && mail.subject.includes('Validez') && mail.text.includes('https://site.test/compte?verify='),
      'un e-mail part vers son adresse, avec un lien vers la page compte du site');
    check((await api('GET', '/me', null, user)).status === 200, 'il peut se connecter et voir son compte');
    check((await api('POST', '/licenses/trial', { productId: tuner }, user)).status === 403, 'mais pas lancer un essai');
    check((await api('POST', '/checkout', { kind: 'product', id: tuner }, user)).status === 403, 'ni acheter');
    check((await api('POST', '/licenses/activate', { productId: tuner, machineId: 'a'.repeat(32) }, user)).status === 403, 'ni activer un plugin');
    check((await api('POST', '/auth/verify', { token: 'faux' })).status === 400, 'un lien inventé est refusé');

    const first = linkTo('nouveau@site.test');
    check((await api('POST', '/auth/verify/resend', null, user)).status === 200 && linkTo('nouveau@site.test') !== first,
      'il peut redemander un lien');
    check((await api('POST', '/auth/verify', { token: first })).status === 400, 'qui périme le précédent');
    check((await api('POST', '/auth/verify', { token: linkTo('nouveau@site.test') })).status === 200, 'le lien valide le compte');
    check((await api('POST', '/auth/verify', { token: linkTo('nouveau@site.test') })).status === 400, 'et ne sert qu\'une fois');
    check((await api('GET', '/me', null, user)).data.user.emailVerified === true, 'le compte est alors validé');
    check((await api('POST', '/licenses/trial', { productId: tuner }, user)).status === 201, 'et l\'essai se lance');
    for (let i = 0; i < 3; i++) await api('POST', '/auth/verify/resend', null, user);
    check((await api('POST', '/auth/verify/resend', null, user)).data.alreadyVerified === true, 'redemander un lien ne fait alors plus rien');

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
    check((await api('POST', '/licenses/trial', { productId: tuner }, user)).status === 409, 'un essai ne se reprend pas');
    check((await api('POST', `/admin/users/${userRow.id}/reset-trials`, null, user)).status === 403, 'un simple utilisateur ne peut pas remettre ses essais à zéro');
    const reset = await api('POST', `/admin/users/${userRow.id}/reset-trials`, null, admin);
    check(reset.status === 200 && reset.data.removed === 1, 'un admin le peut');
    let me = (await api('GET', '/me', null, user)).data;
    check(me.trialsUsed.length === 0 && me.licenses.length === 0 && me.activations.length === 0 && !me.entitlements[tuner],
      'l\'essai, sa licence et sa machine activée ont disparu');
    check((await api('POST', '/licenses/trial', { productId: tuner }, user)).status === 201, 'et l\'essai peut être relancé');

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
