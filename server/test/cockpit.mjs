// Le Cockpit (journal des publications, chiffres à 48 h, banque de phrases, régularité), sur une base jetable : node test/cockpit.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-cockpit-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test' });

const { createApp } = await import('../src/app.js');
const { run, get } = await import('../src/db.js');
const { outbox } = await import('../src/mail.js');
const { dayStatus, cockpitOf, stockOf } = await import('../src/cockpit.js');

// ——— La couleur d'une journée ———
assert.equal(dayStatus({ tiktoks: 2, replies: true, missingStats: 0 }), 'ok');
assert.equal(dayStatus({ tiktoks: 3, replies: true, missingStats: 1 }), 'part', 'chiffres de l’avant-veille pas notés');
assert.equal(dayStatus({ tiktoks: 1, replies: false, missingStats: 0 }), 'part');
assert.equal(dayStatus({ tiktoks: 0, replies: false, missingStats: 2 }), 'none');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (token, method, url, body) => {
  const r = await fetch(base + '/api' + url, { method, body: body && JSON.stringify(body),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
async function account(name, role) {
  const email = `${name}@test.local`;
  const { token } = await (await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'motdepasse1', name }) })).json();
  const link = outbox.filter((m) => m.to === email).at(-1).text.match(/\?verify=([\w-]+)/)[1];
  await fetch(base + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: link }) });
  if (role) run('UPDATE users SET role = ? WHERE email = ?', role, email);
  return { token, id: get('SELECT id FROM users WHERE email = ?', email).id };
}

try {
  assert.equal((await call('', 'GET', '/cockpit')).status, 401);
  const simple = await account('simple');
  assert.equal((await call(simple.token, 'GET', '/cockpit')).status, 403, 'réservé aux membres ONIRIQUE');
  const me = await account('euhz', 'founder'), other = await account('autre', 'vip');

  // Deux vidéos dans le cloud CUT : stock de 2.
  const video = (name) => run('INSERT INTO cut_videos (user_id, name, stored_as, size, created_at) VALUES (?, ?, ?, 1, ?)', me.id, name, name, Date.now()).lastInsertRowid;
  const v1 = Number(video('MGL')), v2 = Number(video('DEAD'));
  assert.equal(stockOf(me.id), 2);

  // La banque de phrases.
  assert.equal((await call(me.token, 'POST', '/cockpit/phrases', { title: 'MGL' })).status, 400, 'phrase vide');
  const ph = (await call(me.token, 'POST', '/cockpit/phrases', { title: 'MGL', text: 'Une phrase qui se comprend seule' })).data;
  assert.equal(ph.uses, 0);
  const otherPhrase = (await call(other.token, 'POST', '/cockpit/phrases', { title: 'X', text: 'à un autre' })).data;
  // Plusieurs phrases d'un coup (les lignes vides partent), puis une phrase corrigée ; pas celle d'un autre.
  const batch = (await call(me.token, 'POST', '/cockpit/phrases', { title: 'DEAD', texts: ['Ligne une', '  ', 'Ligne deux'] })).data;
  assert.deepEqual(batch.map((b) => b.text), ['Ligne une', 'Ligne deux']);
  assert.equal((await call(me.token, 'PATCH', `/cockpit/phrases/${batch[0].id}`, { text: 'Ligne une, corrigée' })).data.text, 'Ligne une, corrigée');
  assert.equal((await call(other.token, 'PATCH', `/cockpit/phrases/${batch[0].id}`, { text: 'non' })).status, 404);
  assert.equal((await call(me.token, 'PATCH', `/cockpit/phrases/${batch[0].id}`, { text: '' })).status, 400);
  for (const b of batch) await call(me.token, 'DELETE', `/cockpit/phrases/${b.id}`);

  // Le journal : on ne peut pas citer la vidéo ou la phrase de quelqu'un d'autre ; lien en https seulement.
  assert.equal((await call(me.token, 'POST', '/cockpit/posts', { network: 'tiktok', phraseId: otherPhrase.id })).status, 404);
  assert.equal((await call(other.token, 'POST', '/cockpit/posts', { network: 'tiktok', cutVideoId: v1 })).status, 404);
  assert.equal((await call(me.token, 'POST', '/cockpit/posts', { network: 'tiktok', url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await call(me.token, 'POST', '/cockpit/posts', { network: 'myspace' })).status, 400);
  const posted = await call(me.token, 'POST', '/cockpit/posts', { network: 'tiktok', cutVideoId: v1, phraseId: ph.id, format: 'Réplique → drop', hook: 'Spider-Man' });
  assert.equal(posted.status, 201);
  assert.equal(stockOf(me.id), 1, 'une vidéo postée sur TikTok sort du stock');
  await call(me.token, 'POST', '/cockpit/posts', { network: 'instagram', cutVideoId: v2 });
  assert.equal(stockOf(me.id), 1, 'un Reel ne compte pas comme TikTok');
  const lib = (await call(me.token, 'GET', '/cut/library')).data;
  assert.equal(lib.stock, 1);
  assert.ok(lib.videos.find((v) => v.id === v1).tiktokAt, 'la vidéo postée le montre dans Mes vidéos');
  assert.equal(lib.videos.find((v) => v.id === v2).tiktokAt, null);

  // Les chiffres à 48 h : entiers positifs ; le taux se calcule pour 1 000 vues.
  assert.equal((await call(me.token, 'PATCH', `/cockpit/posts/${posted.data.id}`, { views: -3 })).status, 400);
  assert.equal((await call(other.token, 'PATCH', `/cockpit/posts/${posted.data.id}`, { views: 3 })).status, 404, 'pas la publication d’un autre');
  const filled = (await call(me.token, 'PATCH', `/cockpit/posts/${posted.data.id}`, { views: 20000, saves: 600 })).data;
  assert.equal(filled.rate, 30);
  assert.equal(filled.hook, 'Spider-Man', 'les champs non donnés restent');

  // Le calendrier, vu depuis Paris : un jour avec 2 TikTok, les réponses faites et les chiffres de l'avant-veille notés est « ok ».
  const at = Date.parse('2026-12-02T20:00:00Z'), noon = (d) => Date.parse(d + 'T11:00:00Z');
  run('DELETE FROM cockpit_posts WHERE user_id = ?', me.id);
  const add = (day, extra = {}) => run(`INSERT INTO cockpit_posts (user_id, network, posted_at, created_at, views) VALUES (?, 'tiktok', ?, ?, ?)`, me.id, noon(day), noon(day), extra.views ?? null);
  add('2026-11-30'); add('2026-12-02', { views: 10 }); add('2026-12-02', { views: 10 }); add('2026-12-01', { views: 5 }); add('2026-12-01', { views: 5 });
  run('INSERT INTO cockpit_days (user_id, day) VALUES (?, ?), (?, ?)', me.id, '2026-12-01', me.id, '2026-12-02');
  const c = cockpitOf(me.id, 'Europe/Paris', at);
  assert.equal(c.today.day, '2026-12-02');
  assert.equal(c.today.missingStats, 1, 'la vidéo du 30/11 attend ses chiffres');
  assert.equal(c.today.status, 'part');
  assert.equal(c.calendar.find((d) => d.day === '2026-12-01').status, 'ok');
  assert.equal(c.calendar.find((d) => d.day === '2026-11-30').status, 'part');
  assert.equal(c.calendar.length, 56, '8 semaines du lundi au dimanche');
  assert.equal(c.calendar[0].day, '2026-10-12', 'commence un lundi');
  assert.equal(c.calendar.at(-1).status, 'future');
  assert.equal(c.week.tiktoks, 5, 'semaine du lundi 30/11');
  assert.equal(c.toFill.length, 1);
  assert.equal(cockpitOf(me.id, 'nimporte/quoi', at).tz, 'Europe/Paris', 'fuseau inconnu : Paris');

  // « Réponses faites » coché puis décoché ; un jour mal écrit est refusé.
  assert.equal((await call(me.token, 'PUT', '/cockpit/days/2026-13-01', { replies: true })).status, 400);
  assert.equal((await call(me.token, 'PUT', '/cockpit/days/2026-12-02', { replies: false })).data.replies, false);
  assert.equal(get('SELECT COUNT(*) AS n FROM cockpit_days WHERE user_id = ? AND day = ?', me.id, '2026-12-02').n, 0);

  // La page entière répond ; une phrase retirée laisse ses publications, sans phrase.
  const page = await call(me.token, 'GET', '/cockpit?tz=Europe/Paris');
  assert.equal(page.status, 200);
  assert.ok(Array.isArray(page.data.phrases) && page.data.phrases.length === 1);
  run('UPDATE cockpit_posts SET phrase_id = ? WHERE user_id = ?', ph.id, me.id);
  assert.equal((await call(other.token, 'DELETE', `/cockpit/phrases/${ph.id}`)).status, 404);
  assert.equal((await call(me.token, 'DELETE', `/cockpit/phrases/${ph.id}`)).status, 200);
  assert.equal(get('SELECT COUNT(*) AS n FROM cockpit_posts WHERE user_id = ? AND phrase_id IS NOT NULL', me.id).n, 0);

  // ——— Les fonctions pures des options avancées ———
  const { weekPoints, planWeek, analysisOf, wearOf, csvCell, remindCockpit, shift } = await import('../src/cockpit.js');
  assert.equal(weekPoints({ daysOk: 7, produced: 30, newHooks: 9, spoke: true, reviewed: true, stockOk: true }).total, 151, 'plafonné à 151');
  assert.equal(weekPoints({ daysOk: 0, produced: 0, newHooks: 0, spoke: false, reviewed: false, stockOk: false }).total, 0);
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"', 'une formule est désamorcée');
  assert.equal(csvCell('simple'), 'simple');
  const phrasesP = [{ id: 1, title: 'MGL', text: 'a', uses: 3, lastUsed: 5, best: 40 }, { id: 2, title: 'MGL', text: 'b', uses: 0, lastUsed: null, best: null },
    { id: 3, title: 'DEAD', text: 'c', uses: 1, lastUsed: 1, best: 10 }, { id: 4, title: 'ENMA', text: 'd', uses: 0, lastUsed: null, best: null }];
  const borrowedFirst = [{ key: 'Réplique → drop', reliable: true, n: 9 }, { key: 'Remix d’un thème connu', reliable: true, n: 6 }, { key: 'Phrase plein écran', reliable: true, n: 5 }];
  const plan = planWeek({ today: '2026-11-30', perDay: 2, postedToday: 0, phrases: phrasesP, formats: borrowedFirst });
  assert.equal(plan.items.length, 14, '2 par jour du lundi au dimanche');
  const borrowedCount = plan.items.filter((i) => /Réplique|Remix/.test(i.format)).length;
  assert.ok(borrowedCount <= Math.floor(14 / 3), `un tiers au plus d’œuvres empruntées (${borrowedCount})`);
  for (const f of plan.formats) assert.ok(f.count <= Math.ceil(14 * 0.4) + 1, 'pas plus de 40 % sur un format (à l’arrondi près)');
  for (let x = 2; x < plan.items.length; x++) {
    const a = plan.items[x], b = plan.items.find((i) => i.day === shift(a.day, -1) && i.phraseId === a.phraseId);
    assert.ok(!b, `pas la même phrase deux jours de suite (${a.day})`);
  }
  assert.equal(plan.items[0].phraseId, 1, 'on commence par la gagnante');
  assert.match(plan.items[1].why, /jamais testée/);
  const releasePlan = planWeek({ today: '2026-12-05', perDay: 3, postedToday: 1, phrases: phrasesP, formats: [], releaseTitle: 'enma' });
  assert.equal(releasePlan.items.length, 2 + 3, 'samedi (déjà 1 publié) et dimanche');
  assert.equal(releasePlan.items[0].title, 'ENMA', 'pendant une sortie, son titre d’abord');
  assert.deepEqual(planWeek({ today: '2026-12-06', perDay: 0, phrases: phrasesP, formats: [] }).items, [], 'pause : rien à prévoir');
  const fake = (n, format, views, at0 = 0) => Array.from({ length: n }, (_, i) => ({ format, views, saves: views / 50, posted_at: at0 + i, day: '2026-11-0' + (1 + (i % 9)), hour: 19, network: 'tiktok', phrase_id: null }));
  const measured = [...fake(5, 'Film', 100000), ...fake(5, 'Film', 8000, 100), ...fake(6, '3D', 20000)];
  assert.deepEqual(wearOf(measured).map((x) => x.format), ['Film'], 'le film s’use (100 000 → 8 000)');
  const an = analysisOf(measured);
  assert.equal(an.byFormat.find((f) => f.key === '3D').rate, 20);
  assert.equal(an.byHour[0].key, 'Soir (19 h–23 h)');
  const ab = analysisOf([{ phrase_id: 7, title: 'MGL', text: 'x', hook: 'Spider-Man', views: 1000, saves: 30, day: '2026-11-02', hour: 12, posted_at: 1 },
    { phrase_id: 7, title: 'MGL', text: 'x', hook: 'Texte seul', views: 1000, saves: 10, day: '2026-11-03', hour: 12, posted_at: 2 }]);
  assert.equal(ab.hooks[0].tests[0].hook, 'Spider-Man', 'le test d’accroches classe la meilleure en tête');

  // ——— La semaine : modes, joker, pause, rattrapage ———
  run('DELETE FROM cockpit_posts WHERE user_id = ?', me.id);
  run('DELETE FROM cockpit_days WHERE user_id = ?', me.id);
  assert.equal((await call(me.token, 'PUT', '/cockpit/weeks/2026-12-02', { mode: 'reduit' })).status, 400, 'un mercredi n’est pas une semaine');
  assert.equal((await call(me.token, 'PUT', '/cockpit/weeks/2026-11-30', { mode: 'turbo' })).status, 400);
  assert.equal((await call(me.token, 'PUT', '/cockpit/weeks/2026-11-30', { joker: '2026-12-09' })).status, 400, 'joker hors de la semaine');
  assert.equal((await call(me.token, 'PUT', '/cockpit/weeks/2026-11-30', { mode: 'reduit', joker: '2026-12-01' })).status, 200);
  let w = cockpitOf(me.id, 'Europe/Paris', at);
  assert.equal(w.mode.key, 'reduit');
  assert.equal(w.mode.perDay, 1);
  assert.equal(w.calendar.find((d) => d.day === '2026-12-01').status, 'joker');
  assert.equal((await call(me.token, 'PUT', '/cockpit/weeks/2026-11-30', { mode: 'pause' })).status, 200);
  assert.equal((await call(me.token, 'PUT', '/cockpit/weeks/2026-12-07', { mode: 'pause' })).status, 400, 'une pause par trimestre');
  assert.equal(cockpitOf(me.id, 'Europe/Paris', at).today.status, 'pause');
  await call(me.token, 'PUT', '/cockpit/weeks/2026-11-30', { mode: null, joker: null });
  // Rattrapage : rien le 23/11, 4 TikTok le 24/11 (mode Normal) : le 23 redevient « en partie ».
  add('2026-11-24'); add('2026-11-24'); add('2026-11-24'); add('2026-11-24');
  w = cockpitOf(me.id, 'Europe/Paris', at);
  const d23 = w.calendar.find((d) => d.day === '2026-11-23');
  assert.equal(d23.status, 'part'); assert.equal(d23.caught, true);
  assert.equal(w.calendar.find((d) => d.day === '2026-11-22').status, 'none');

  // Mode Réduit automatique : deux semaines sous 110 points, après 3 semaines de journal.
  run('DELETE FROM cockpit_posts WHERE user_id = ?', me.id);
  add('2026-11-01', { views: 10 });
  w = cockpitOf(me.id, 'Europe/Paris', at);
  assert.equal(w.mode.key, 'reduit'); assert.equal(w.mode.auto, true);
  assert.ok(w.alerts.some((a) => /mode Réduit/.test(a.text)));
  await call(me.token, 'PUT', '/cockpit/weeks/2026-11-30', { mode: 'normal' });
  assert.equal(cockpitOf(me.id, 'Europe/Paris', at).mode.key, 'normal', 'un mode choisi passe avant');
  await call(me.token, 'PUT', '/cockpit/weeks/2026-11-30', { mode: null });

  // ——— Sorties : mode Sortie de S-3 à S0, vidéos du titre comptées par semaine ———
  assert.equal((await call(me.token, 'POST', '/cockpit/releases', { title: 'ENMA' })).status, 400);
  const rel = (await call(me.token, 'POST', '/cockpit/releases', { title: 'ENMA', day: '2026-12-18' })).data;
  const enma = (await call(me.token, 'POST', '/cockpit/phrases', { title: 'enma', text: 'Une phrase d’ENMA' })).data;
  run(`INSERT INTO cockpit_posts (user_id, network, phrase_id, posted_at, created_at) VALUES (?, 'tiktok', ?, ?, ?)`, me.id, enma.id, noon('2026-12-01'), noon('2026-12-01'));
  w = cockpitOf(me.id, 'Europe/Paris', at);
  assert.equal(w.mode.key, 'sortie', 'S-2 : mode Sortie par défaut');
  assert.equal(w.release.s, -2);
  const step = w.releases[0].weeks.find((x) => x.s === -2);
  assert.equal(step.done, 1); assert.equal(step.current, true);
  assert.equal(w.plan.items[0].title, 'enma', 'le plan pousse le titre qui sort');
  await call(me.token, 'DELETE', `/cockpit/releases/${rel.id}`);

  // ——— Audience, contacts, radar, bilan du soir ———
  assert.equal((await call(me.token, 'PUT', '/cockpit/audience/2026-12-01', {})).status, 400, 'au moins un chiffre');
  assert.equal((await call(me.token, 'PUT', '/cockpit/audience/2026-12-01', { spotify: 17141, tiktok: 4770 })).status, 200);
  assert.equal((await call(me.token, 'PUT', '/cockpit/audience/2026-12-01', { spotify: 'beaucoup' })).status, 400);
  assert.equal((await call(me.token, 'POST', '/cockpit/contacts', { name: 'Knopes', status: 'ami' })).status, 400);
  const contact = (await call(me.token, 'POST', '/cockpit/contacts', { name: 'Graphiste 3D', role: 'visuels', lastContact: '2026-10-01' })).data;
  assert.equal((await call(other.token, 'PATCH', `/cockpit/contacts/${contact.id}`, { status: 'fait' })).status, 404);
  await call(me.token, 'POST', '/cockpit/events', { title: 'Un film en salle', day: '2026-12-05' });
  await call(me.token, 'PUT', '/cockpit/evenings/2026-12-02', { best: 'La réplique Spider-Man', lesson: 'Question courte = mieux' });
  w = cockpitOf(me.id, 'Europe/Paris', at);
  assert.equal(w.audience.length, 1);
  assert.equal(w.contacts[0].overdue, true);
  assert.ok(w.alerts.some((a) => /Radar/.test(a.text) && /3 jours/.test(a.text)));
  assert.ok(w.alerts.some((a) => /à relancer/.test(a.text)));
  assert.equal(w.evenings[0].lesson, 'Question courte = mieux');
  await call(me.token, 'PATCH', `/cockpit/contacts/${contact.id}`, { status: 'fait' });
  assert.equal(cockpitOf(me.id, 'Europe/Paris', at).contacts[0].overdue, false);

  // ——— Export CSV ———
  run(`UPDATE cockpit_posts SET hook = '=1+1' WHERE user_id = ?`, me.id);
  const csv = await fetch(base + '/api/cockpit/export.csv', { headers: { Authorization: `Bearer ${me.token}` } });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const csvText = await csv.text();
  assert.ok(csvText.includes("'=1+1") && csvText.replace(/^\uFEFF/, '').startsWith('date;'), 'en-têtes, et formule désamorcée');

  // ——— Rappels : à 13 h si rien n'est publié (une fois), le lundi pour le bilan ———
  run('DELETE FROM cockpit_posts WHERE user_id = ?', me.id);
  run(`INSERT INTO cut_reminders (user_id, time, tz) VALUES (?, '18:00', 'Europe/Paris')`, me.id);
  const midi = Date.parse('2026-12-02T12:10:00Z'); // 13 h 10 à Paris
  assert.deepEqual(remindCockpit(midi), [{ userId: me.id, kind: 'midi' }]);
  assert.deepEqual(remindCockpit(midi + 60_000), [], 'une fois par jour');
  assert.deepEqual(remindCockpit(Date.parse('2026-12-07T09:30:00Z')), [{ userId: me.id, kind: 'lundi' }], 'lundi 10 h 30 : le bilan');
  console.log('Cockpit : tout va bien.');
} finally {
  server.close();
}
