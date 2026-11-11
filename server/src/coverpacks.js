// Les packs de pochettes : dans ONIRIQUE CLOUD, un graphiste réunit des visuels de sa vitrine dans un pack, l'ouvre par un
// lien (page /pochettes, copies filigranées seulement) et l'envoie par e-mail depuis sa propre boîte mail, comme les mails
// des packs de prods : à des adresses collées ou à une de ses listes de contacts, un mail toutes les 15 à 30 secondes, avec
// lien de désinscription. On voit qui l'a reçu et qui a ouvert le lien.
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, get, all, run, now } from './db.js';
import { HttpError, rateLimit } from './auth.js';
import { testing, outbox } from './mail.js';
import { escapeHtml } from './mailtemplate.js';
import { mailerRow, mailerView, transportOf, contactsOf, listContacts, GAP } from './packsend.js';
import { view, PUBLIC } from './vitrine.js';

db.exec(`
CREATE TABLE IF NOT EXISTS cover_packs (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  token      TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cover_pack_items (
  pack_id   INTEGER NOT NULL REFERENCES cover_packs(id) ON DELETE CASCADE,
  visual_id INTEGER NOT NULL REFERENCES vitrine_visuals(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pack_id, visual_id)
);
CREATE TABLE IF NOT EXISTS cover_pack_mails (
  id         INTEGER PRIMARY KEY,
  pack_id    INTEGER NOT NULL REFERENCES cover_packs(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'wait',
  error      TEXT NOT NULL DEFAULT '',
  sent_at    INTEGER,
  clicked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cover_pack_mails_by_pack ON cover_pack_mails (pack_id, created_at);
`);

const PER_SEND = 300, PER_DAY = 450;
const str = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const id = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0);
const linkOf = (p) => `${config.siteUrl}/pochettes?t=${p.token}`;
// Les visuels d'un pack encore dans la vitrine, dans l'ordre choisi.
const visualsOf = (packId) => all(`${PUBLIC} AND v.id IN (SELECT visual_id FROM cover_pack_items WHERE pack_id = ?)
  ORDER BY (SELECT position FROM cover_pack_items WHERE pack_id = ? AND visual_id = v.id)`, packId, packId).map(view);

function packView(p) {
  const mails = all('SELECT * FROM cover_pack_mails WHERE pack_id = ? ORDER BY created_at DESC, id DESC LIMIT 500', p.id);
  return { id: p.id, title: p.title, message: p.message, url: linkOf(p), createdAt: p.created_at,
    visualIds: all('SELECT visual_id FROM cover_pack_items WHERE pack_id = ? ORDER BY position', p.id).map((x) => x.visual_id),
    mails: mails.map((m) => ({ email: m.email, name: m.name, status: m.status, error: m.error, sentAt: m.sent_at, clickedAt: m.clicked_at })) };
}

//------------------------------------------------------------------------------ Envoi
function mailHtml(p, visuals, r, from) {
  const link = `${linkOf(p)}&r=${r.token}`, unsubscribe = `${config.siteUrl}/api/cover-packs/m/${r.token}/desinscription`;
  const greet = (text) => String(text || '').replace(/\{nom\}/gi, r.name).replace(/ +([,.])/g, '$1').replace(/ {2,}/g, ' ');
  const covers = visuals.slice(0, 6).map((v) => `<td style="padding:4px;width:33%"><a href="${escapeHtml(link)}"><img src="${escapeHtml(config.siteUrl + v.image)}" alt="${escapeHtml(v.title)}" width="170" style="display:block;width:100%;height:auto;border-radius:10px"></a></td>`);
  const rows = [];
  for (let i = 0; i < covers.length; i += 3) rows.push(`<tr>${covers.slice(i, i + 3).join('')}</tr>`);
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><body style="margin:0;background:#09080A;color:#F4ECEC;font:16px/1.6 Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#121012;border-radius:18px;border:1px solid #2a1c20">
<tr><td style="padding:26px 26px 6px"><div style="font:11px monospace;letter-spacing:2px;text-transform:uppercase;color:#a8939a">Pack de pochettes · ${visuals.length} visuel${visuals.length > 1 ? 's' : ''}</div>
<h1 style="margin:8px 0 6px;font-size:24px;line-height:1.2;color:#F4ECEC">${escapeHtml(p.title)}</h1>
${p.message ? `<p style="margin:0 0 10px;color:#d9c6c9;white-space:pre-wrap">${escapeHtml(greet(p.message))}</p>` : ''}</td></tr>
<tr><td style="padding:6px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table></td></tr>
<tr><td align="center" style="padding:18px 26px 26px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:13px 26px;border-radius:999px;background:#E5384A;color:#fff;font-weight:700;text-decoration:none">Voir les pochettes</a>
<p style="margin:16px 0 0;color:#a8939a;font-size:13px">${escapeHtml(from)}</p></td></tr></table>
<p style="color:#7d6a6e;font-size:12px;margin:14px 0 0">Envoyé depuis ONIRIQUE · <a href="${escapeHtml(unsubscribe)}" style="color:#7d6a6e">Se désinscrire</a></p>
</td></tr></table></body></html>`;
}
const running = new Set();
// Les mails en attente d'un pack, un par un, depuis la boîte mail de son auteur ; un seul envoi à la fois par pack.
async function deliver(packId) {
  if (running.has(packId)) return;
  running.add(packId);
  try {
    for (;;) {
      const p = get('SELECT * FROM cover_packs WHERE id = ?', packId), r = p && get(`SELECT * FROM cover_pack_mails WHERE pack_id = ? AND status = 'wait' ORDER BY id LIMIT 1`, packId);
      if (!r) break;
      const m = mailerRow(p.user_id);
      if (!m) {
        run(`UPDATE cover_pack_mails SET status = 'error', error = 'Boîte mail débranchée pendant l''envoi.' WHERE pack_id = ? AND status = 'wait'`, packId);
        break;
      }
      const from = m.from_name ? `"${m.from_name.replace(/"/g, '')}" <${m.from_email}>` : m.from_email, visuals = visualsOf(p.id);
      const unsubscribe = `${config.siteUrl}/api/cover-packs/m/${r.token}/desinscription`;
      const message = { from, to: r.name ? `"${r.name.replace(/"/g, '')}" <${r.email}>` : r.email, subject: p.title,
        text: [p.title, '', p.message.replace(/\{nom\}/gi, r.name), '', `Voir les pochettes : ${linkOf(p)}&r=${r.token}`, '', m.from_name || '', '', `Se désinscrire : ${unsubscribe}`].join('\n'),
        html: mailHtml(p, visuals, r, m.from_name || m.from_email),
        headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
      try {
        if (testing) outbox.push(message);
        await transportOf(m).sendMail(message);
        run(`UPDATE cover_pack_mails SET status = 'sent', sent_at = ? WHERE id = ?`, now(), r.id);
      } catch (error) {
        run(`UPDATE cover_pack_mails SET status = 'error', error = ? WHERE id = ?`, String(error.message).slice(0, 300), r.id);
      }
      // Un envoi régulier et rapide ressemble à du spam : entre 15 et 30 secondes entre deux mails.
      if (!testing && get(`SELECT 1 AS x FROM cover_pack_mails WHERE pack_id = ? AND status = 'wait'`, packId)) await new Promise((resolve) => setTimeout(resolve, GAP[0] + Math.random() * (GAP[1] - GAP[0])));
    }
  } finally { running.delete(packId); }
}

export function mountCoverPacks(app, { requireUser, wrap }) {
  // Les envois coupés par une mise en ligne reprennent.
  if (!testing) setTimeout(() => {
    for (const x of all(`SELECT DISTINCT pack_id FROM cover_pack_mails WHERE status = 'wait'`)) deliver(x.pack_id).catch((error) => console.error(`[pochettes] ${error.message}`));
  }, 5000).unref();

  const own = (req) => {
    const p = get('SELECT * FROM cover_packs WHERE id = ? AND user_id = ?', id(req.params.id), req.user.id);
    if (!p) throw new HttpError(404, 'Pack introuvable.');
    return p;
  };
  const seesShared = (user) => ['vip', 'beta', 'betaf', 'founder'].includes(user.role);
  // Le panneau POCHETTES de CLOUD : ses packs, ses visuels à y mettre, sa boîte mail et ses listes de contacts.
  app.get('/api/me/cover-packs', requireUser, (req, res) => {
    const handle = get('SELECT handle FROM user_profiles WHERE user_id = ?', req.user.id)?.handle || null;
    res.set('Cache-Control', 'no-store').json({ handle, mailer: mailerView(req.user.id),
      visuals: handle ? all(`${PUBLIC} AND v.user_id = ? ORDER BY v.created_at DESC`, req.user.id).map(view) : [],
      lists: all('SELECT * FROM sound_mail_lists WHERE user_id = ? OR (shared = 1 AND ?) ORDER BY shared DESC, created_at DESC', req.user.id, seesShared(req.user) ? 1 : 0)
        .map((l) => ({ id: l.id, name: l.name, count: listContacts(l).length, shared: !!l.shared })),
      packs: all('SELECT * FROM cover_packs WHERE user_id = ? ORDER BY created_at DESC', req.user.id).map(packView) });
  });
  app.post('/api/me/cover-packs', requireUser, (req, res) => {
    rateLimit(`cover-packs:${req.user.id}`, 100);
    const title = str(req.body?.title, 100);
    if (!title) throw new HttpError(400, 'Donne un nom au pack.');
    if (get('SELECT COUNT(*) AS n FROM cover_packs WHERE user_id = ?', req.user.id).n >= 100) throw new HttpError(400, '100 packs au plus.');
    const pid = run('INSERT INTO cover_packs (user_id, title, token, created_at) VALUES (?, ?, ?, ?)', req.user.id, title, crypto.randomBytes(18).toString('base64url'), now()).lastInsertRowid;
    res.status(201).json(packView(get('SELECT * FROM cover_packs WHERE id = ?', pid)));
  });
  // Nom, message du mail ({nom} : le nom du contact) et visuels du pack, dans l'ordre ; seulement ses propres visuels.
  app.patch('/api/me/cover-packs/:id', requireUser, (req, res) => {
    const p = own(req), b = req.body || {};
    if (b.title !== undefined) run('UPDATE cover_packs SET title = ? WHERE id = ?', str(b.title, 100) || p.title, p.id);
    if (b.message !== undefined) run('UPDATE cover_packs SET message = ? WHERE id = ?', String(b.message).replace(/\r\n?/g, '\n').trim().slice(0, 2000), p.id);
    if (b.visualIds !== undefined) {
      if (!Array.isArray(b.visualIds)) throw new HttpError(400, 'Visuels illisibles.');
      const mine = new Set(all('SELECT id FROM vitrine_visuals WHERE user_id = ? AND hidden = 0', req.user.id).map((x) => x.id));
      const ids = [...new Set(b.visualIds.map(Number))].filter((x) => mine.has(x)).slice(0, 60);
      run('DELETE FROM cover_pack_items WHERE pack_id = ?', p.id);
      ids.forEach((vid, i) => run('INSERT INTO cover_pack_items (pack_id, visual_id, position) VALUES (?, ?, ?)', p.id, vid, i));
    }
    res.json(packView(get('SELECT * FROM cover_packs WHERE id = ?', p.id)));
  });
  app.delete('/api/me/cover-packs/:id', requireUser, (req, res) => {
    run('DELETE FROM cover_packs WHERE id = ?', own(req).id);
    res.json({ ok: true });
  });
  // L'envoi : les adresses collées (ou un CSV) et/ou une liste de contacts ; les désinscrits et ceux qui l'ont déjà reçu sont retirés.
  app.post('/api/me/cover-packs/:id/send', requireUser, wrap(async (req, res) => {
    const p = own(req), b = req.body || {};
    const m = mailerRow(req.user.id);
    if (!m) throw new HttpError(400, 'Branche d\'abord ta boîte mail : les mails partent de ton adresse.');
    if (!visualsOf(p.id).length) throw new HttpError(400, 'Ajoute au moins un visuel au pack.');
    rateLimit(`cover-packs-send:${req.user.id}`, 20, 3600_000);
    let contacts = contactsOf(String(b.emails || '').slice(0, 200_000));
    if (b.listId) {
      const l = get('SELECT * FROM sound_mail_lists WHERE id = ? AND (user_id = ? OR (shared = 1 AND ?))', id(b.listId), req.user.id, seesShared(req.user) ? 1 : 0);
      if (!l) throw new HttpError(404, 'Liste introuvable.');
      contacts = [...contacts, ...listContacts(l)];
    }
    const blocked = new Set([...all('SELECT email FROM sound_mail_unsubs WHERE user_id = ?', req.user.id).map((x) => x.email),
      ...all(`SELECT email FROM cover_pack_mails WHERE pack_id = ? AND status != 'error'`, p.id).map((x) => x.email)]);
    const seen = new Set(), fresh = contacts.filter((c) => !blocked.has(c.email) && !seen.has(c.email) && seen.add(c.email));
    if (!fresh.length) throw new HttpError(400, 'Aucun nouveau destinataire (les désinscrits et ceux qui ont déjà reçu ce pack sont retirés).');
    if (fresh.length > PER_SEND) throw new HttpError(400, `${PER_SEND} destinataires au plus par envoi.`);
    // La même limite par jour que les mails des packs de prods, depuis la même adresse (Gmail bloque au-delà de ~500).
    const today = get(`SELECT COUNT(*) AS n FROM cover_pack_mails WHERE user_id = ? AND (status = 'wait' OR sent_at > ?)`, req.user.id, now() - 86400_000).n
      + get(`SELECT COUNT(*) AS n FROM sound_mail_recipients WHERE user_id = ? AND (status = 'wait' OR sent_at > ?)`, req.user.id, now() - 86400_000).n;
    if (today + fresh.length > PER_DAY) throw new HttpError(400, `${PER_DAY} mails au plus par jour depuis ta boîte : il en reste ${Math.max(0, PER_DAY - today)} pour les prochaines 24 h.`);
    run(`DELETE FROM cover_pack_mails WHERE pack_id = ? AND status = 'error' AND email IN (${fresh.map(() => '?').join(',')})`, p.id, ...fresh.map((c) => c.email));
    for (const c of fresh) run('INSERT INTO cover_pack_mails (pack_id, user_id, token, email, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      p.id, req.user.id, crypto.randomBytes(16).toString('base64url'), c.email, c.name || '', now());
    const job = deliver(p.id);
    if (testing) await job; else job.catch((error) => console.error(`[pochettes] pack ${p.id} : ${error.message}`));
    res.status(202).json({ total: fresh.length, pack: packView(get('SELECT * FROM cover_packs WHERE id = ?', p.id)) });
  }));

  // La page publique d'un pack (copies filigranées) ; ?r= : le destinataire du mail qui l'ouvre.
  app.get('/api/cover-packs/:token', (req, res) => {
    const p = get('SELECT * FROM cover_packs WHERE token = ?', str(req.params.token, 64));
    if (!p) throw new HttpError(404, 'Pack introuvable.');
    if (req.query.r) run('UPDATE cover_pack_mails SET clicked_at = COALESCE(clicked_at, ?) WHERE token = ? AND pack_id = ?', now(), str(req.query.r, 64), p.id);
    const author = get('SELECT u.name, u.avatar, pr.handle FROM users u LEFT JOIN user_profiles pr ON pr.user_id = u.id WHERE u.id = ?', p.user_id);
    res.set('Cache-Control', 'no-store').json({ title: p.title, message: p.message, visuals: visualsOf(p.id),
      author: { name: author?.name || 'Membre', handle: author?.handle || null, avatar: author?.avatar ? `/api/media/${author.avatar}` : null } });
  });
  // Se désinscrire des mails de ce graphiste (la même liste que pour les mails des packs de prods).
  const byToken = (req) => {
    const r = get('SELECT * FROM cover_pack_mails WHERE token = ?', str(req.params.token, 64));
    if (!r) throw new HttpError(404, 'Lien introuvable.');
    return r;
  };
  const page = (title, text, form = '') => `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#09080A;color:#F4ECEC;font:16px/1.6 system-ui,sans-serif"><main style="max-width:440px;padding:24px;text-align:center">
<h1 style="font-size:22px">${title}</h1><p style="color:#a8939a">${text}</p>${form}</main></body></html>`;
  app.get('/api/cover-packs/m/:token/desinscription', (req, res) => {
    const r = byToken(req), from = get('SELECT from_name, from_email FROM sound_mailers WHERE user_id = ?', r.user_id);
    res.type('html').send(page('Se désinscrire', `Tu ne recevras plus les mails de ${escapeHtml(from?.from_name || from?.from_email || 'cet artiste')} envoyés depuis ONIRIQUE à ${escapeHtml(r.email)}.`,
      '<form method="post"><button style="padding:12px 22px;border:0;border-radius:999px;background:#F4ECEC;color:#09080A;font-weight:700;cursor:pointer">Me désinscrire</button></form>'));
  });
  app.post('/api/cover-packs/m/:token/desinscription', (req, res) => {
    const r = byToken(req);
    run('INSERT OR IGNORE INTO sound_mail_unsubs (user_id, email, at) VALUES (?, ?, ?)', r.user_id, r.email, now());
    res.type('html').send(page('C\'est fait', 'Tu es désinscrit : plus aucun mail de cet artiste ne te sera envoyé depuis ONIRIQUE.'));
  });
}
