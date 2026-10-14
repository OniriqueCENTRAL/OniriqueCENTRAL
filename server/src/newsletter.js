import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { all, db, get, run, now, transaction } from './db.js';
import { HttpError, isStaff, requireUser } from './auth.js';
import { mailEnabled, sendMail } from './mail.js';
import { escapeHtml, renderEmail } from './mailtemplate.js';

//==============================================================================
//  Les e-mails d'ONIRIQUE aux inscrits : consentement, désinscription, envois depuis le panel admin
//==============================================================================
// users.marketing : 1 a accepté de recevoir les nouveautés, 0 n'a rien dit, -1 s'est désinscrit (on ne lui écrit plus
// rien de promotionnel, même s'il est client).
db.exec(`
CREATE TABLE IF NOT EXISTS mailings (
  id         INTEGER PRIMARY KEY,
  subject    TEXT NOT NULL,
  content    TEXT NOT NULL,
  audience   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'sending',
  total      INTEGER NOT NULL DEFAULT 0,
  sent       INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  done_at    INTEGER
);
CREATE TABLE IF NOT EXISTS mailing_recipients (
  id         INTEGER PRIMARY KEY,
  mailing_id INTEGER NOT NULL REFERENCES mailings(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  sent_at    INTEGER,
  error      TEXT
);
CREATE INDEX IF NOT EXISTS mailing_pending ON mailing_recipients(mailing_id, sent_at);
`);
if (!db.prepare(`SELECT 1 FROM pragma_table_info('users') WHERE name = 'marketing'`).get()) {
  db.exec('ALTER TABLE users ADD COLUMN marketing INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE users ADD COLUMN marketing_at INTEGER');
}

// Le lien de désinscription porte une signature : personne ne peut désinscrire un autre compte en changeant le numéro.
const keyPath = path.join(config.keysDir, 'mail.key');
if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(32), { mode: 0o600 });
const mailKey = fs.readFileSync(keyPath);
const signature = (userId) => crypto.createHmac('sha256', mailKey).update(`unsubscribe:${userId}`).digest('base64url').slice(0, 24);
export const unsubscribeUrl = (userId) => `${config.publicUrl}/api/newsletter/unsubscribe?u=${userId}&t=${signature(userId)}`;

export function setMarketing(userId, on) {
  run('UPDATE users SET marketing = ?, marketing_at = ? WHERE id = ?', on ? 1 : -1, now(), userId);
}

//------------------------------------------------------------------------------ Les destinataires
// newsletter : ceux qui l'ont accepté. customers : les clients (un achat payé), sauf ceux qui se sont désinscrits.
// all : tous les comptes à l'adresse validée, pour une information de service seulement (changement des conditions,
// sécurité, panne) : la loi interdit d'y mettre de la publicité sans consentement.
const AUDIENCES = {
  newsletter: { label: 'Inscrits aux nouveautés', where: 'u.marketing = 1' },
  customers: { label: 'Clients et inscrits', where: `u.marketing != -1 AND (u.marketing = 1 OR EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.amount_cents > 0 AND o.provider IN ('stripe', 'lemon', 'stripe-managed')))` },
  all: { label: 'Tous les comptes (information de service)', where: '1 = 1', service: true },
};
const recipients = (audience) => all(`SELECT u.id, u.email, u.name FROM users u WHERE u.email_verified != 0 AND (${AUDIENCES[audience].where}) ORDER BY u.id`);

//------------------------------------------------------------------------------ Le contenu
const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Le message composé dans le panel, vérifié. */
function composition(body) {
  const c = {
    subject: str(body.subject, 140), preheader: str(body.preheader, 160), eyebrow: str(body.eyebrow, 40) || 'Nouveautés',
    title: str(body.title, 120), text: str(body.text, 12000),
    buttonLabel: str(body.buttonLabel, 40), buttonUrl: str(body.buttonUrl, 500), image: str(body.image, 500),
    productIds: Array.isArray(body.productIds) ? body.productIds.map(Number).filter(Boolean).slice(0, 4) : [],
    promoCode: str(body.promoCode, 40).toUpperCase(), promoText: str(body.promoText, 140),
  };
  if (!c.subject) throw new HttpError(400, 'Écrivez un objet.');
  if (!c.text && !c.productIds.length) throw new HttpError(400, 'Écrivez le message, ou ajoutez au moins un plugin.');
  if (c.buttonUrl && !/^https:\/\//.test(c.buttonUrl)) throw new HttpError(400, 'Le lien du bouton doit commencer par https://.');
  if (c.image && !/^(https:\/\/|\/api\/media\/)/.test(c.image)) throw new HttpError(400, 'L\'image doit être une adresse https:// ou une image de la boutique.');
  if (c.buttonLabel && !c.buttonUrl) throw new HttpError(400, 'Le bouton a besoin d\'un lien.');
  return c;
}

const CREATOR_LABELS = { onirique: 'ONIRIQUE', abrasion: 'ONIRIQUE × ABRASION', relic: 'RELIC' };

/** Le message prêt pour une personne : {prenom} est remplacé par son prénom (ou rien), le pied porte son lien de désinscription. */
function personal(c, user, service) {
  const name = (user?.name || '').trim().split(/\s+/)[0] || '';
  const fill = (text) => text.replace(/\{prenom\}/gi, name).replace(/ ,/g, ',').replace(/\s{2,}/g, (m) => (m.includes('\n') ? m : ' '));
  const blocks = [];
  if (c.image) blocks.push({ image: c.image, alt: c.title || c.subject, url: c.buttonUrl || undefined });
  for (const chunk of fill(c.text).split(/\n{2,}/).filter((t) => t.trim())) {
    blocks.push(/^#\s+/.test(chunk) ? { heading: chunk.replace(/^#\s+/, '') } : { text: chunk.trim() });
  }
  for (const id of c.productIds) {
    const p = get('SELECT * FROM products WHERE id = ? AND published = 1', id);
    if (p) blocks.push({ product: { slug: p.slug, name: p.name, tagline: p.tagline, priceCents: p.price_cents, image: p.image ? `/api/media/${p.image}` : null, creatorLabel: CREATOR_LABELS[p.creator] } });
  }
  if (c.promoCode) blocks.push({ code: c.promoCode, caption: 'Code promo', detail: c.promoText || 'À entrer au moment d\'acheter, sur le site ou dans ONIRIQUE CENTRAL.' });
  if (c.buttonUrl) blocks.push({ button: { label: c.buttonLabel || 'Découvrir', url: c.buttonUrl } });
  const footer = service
    ? ['Message de service envoyé à tous les comptes ONIRIQUE.']
    : [user ? `Vous recevez ce message parce que vous êtes inscrit chez ONIRIQUE. <a href="${unsubscribeUrl(user.id)}" style="color:#c9b3b6">Se désinscrire</a>`
      : 'Aperçu : le lien de désinscription de chaque destinataire s\'affiche ici.'];
  const html = renderEmail({ preheader: c.preheader, eyebrow: c.eyebrow, title: fill(c.title), blocks, footer });
  const text = [fill(c.title), fill(c.text), c.promoCode ? `Code promo : ${c.promoCode}${c.promoText ? ' — ' + c.promoText : ''}` : '',
    c.buttonUrl ? `${c.buttonLabel || 'Découvrir'} : ${c.buttonUrl}` : '',
    service ? '' : user ? `Se désinscrire : ${unsubscribeUrl(user.id)}` : ''].filter(Boolean).join('\n\n');
  return { subject: fill(c.subject), html, text };
}

//------------------------------------------------------------------------------ L'envoi, un message à la fois
// Le serveur de messagerie d'ONIRIQUE limite le débit : un message toutes les MAILING_INTERVAL_MS (3 s par défaut,
// soit 1 200 par heure). La file est dans la base : un redémarrage du serveur reprend où il en était.
let busy = false;
async function sendNext() {
  if (busy || !mailEnabled) return;
  const next = get(`SELECT r.*, m.content, m.audience FROM mailing_recipients r JOIN mailings m ON m.id = r.mailing_id
                    WHERE m.status = 'sending' AND r.sent_at IS NULL ORDER BY m.id, r.id LIMIT 1`);
  if (!next) {
    for (const m of all(`SELECT id FROM mailings WHERE status = 'sending'`)) run(`UPDATE mailings SET status = 'sent', done_at = ? WHERE id = ?`, now(), m.id);
    return;
  }
  busy = true;
  const user = next.user_id ? get('SELECT id, email, name, marketing FROM users WHERE id = ?', next.user_id) : null;
  const service = !!AUDIENCES[next.audience]?.service;
  try {
    // Désinscrit entre-temps : il ne reçoit plus rien de promotionnel.
    if (!user || (!service && user.marketing === -1)) throw new Error('désinscrit');
    const m = personal(JSON.parse(next.content), user, service);
    await sendMail(user.email, m.subject, m.text, config.supportEmail || undefined, {
      html: m.html,
      headers: service ? undefined : { 'List-Unsubscribe': `<${unsubscribeUrl(user.id)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    transaction(() => {
      run('UPDATE mailing_recipients SET sent_at = ? WHERE id = ?', now(), next.id);
      run('UPDATE mailings SET sent = sent + 1 WHERE id = ?', next.mailing_id);
    });
  } catch (error) {
    transaction(() => {
      run('UPDATE mailing_recipients SET sent_at = ?, error = ? WHERE id = ?', now(), String(error.message).slice(0, 200), next.id);
      run('UPDATE mailings SET failed = failed + 1 WHERE id = ?', next.mailing_id);
    });
  }
  busy = false;
}
setInterval(() => sendNext().catch((error) => console.error('Envoi groupé :', error.message)), Number(process.env.MAILING_INTERVAL_MS || 3000)).unref();

const mailingView = (m) => ({ id: m.id, subject: m.subject, audience: m.audience, audienceLabel: AUDIENCES[m.audience]?.label ?? m.audience,
  status: m.status, total: m.total, sent: m.sent, failed: m.failed, createdAt: m.created_at, doneAt: m.done_at, author: m.author ?? null });

//------------------------------------------------------------------------------ Les routes
const unsubscribedPage = (title, text) => `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ONIRIQUE</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(120% 60% at 50% 0%,#5c0008,#0d0809 70%);color:#f6eeee;font:16px/1.6 'Segoe UI',system-ui,sans-serif;padding:24px;box-sizing:border-box">
<div style="max-width:460px;text-align:center;padding:36px 28px;border:1px solid #3a1c20;border-radius:24px;background:#1a080a">
<div style="font:800 15px/1 'Arial Black',sans-serif;letter-spacing:.32em">ONIRIQUE</div>
<h1 style="font:800 24px/1.25 'Arial Black',sans-serif;margin:22px 0 10px">${escapeHtml(title)}</h1>
<p style="color:#b39a9d;margin:0 0 22px">${escapeHtml(text)}</p>
<a href="${config.siteUrl}/compte.html" style="display:inline-block;padding:13px 24px;border-radius:999px;background:#f6eeee;color:#0d0809;font-weight:700;text-decoration:none">Mon compte</a>
</div></body></html>`;

export function mountNewsletter(app, admin) {
  // Désinscription en un clic, depuis le lien du message (GET) ou le bouton de la messagerie (POST, List-Unsubscribe-Post).
  const unsubscribe = (req, res) => {
    const userId = Number(req.query.u);
    const given = String(req.query.t || '');
    const expected = signature(userId);
    if (!userId || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      return res.status(400).type('html').send(unsubscribedPage('Lien invalide', 'Ce lien de désinscription n\'est pas valable. Vous pouvez aussi vous désinscrire depuis votre page compte.'));
    }
    if (get('SELECT id FROM users WHERE id = ?', userId)) setMarketing(userId, false);
    res.type('html').send(unsubscribedPage('Vous êtes désinscrit', 'Vous ne recevrez plus les nouveautés d\'ONIRIQUE. Les e-mails liés à vos achats et à votre compte continuent d\'arriver. Vous pouvez vous réinscrire depuis votre page compte.'));
  };
  app.get('/api/newsletter/unsubscribe', unsubscribe);
  app.post('/api/newsletter/unsubscribe', unsubscribe);

  app.post('/api/me/newsletter', requireUser, (req, res) => {
    setMarketing(req.user.id, req.body.enabled === true);
    res.json({ ok: true, newsletter: req.body.enabled === true });
  });

  // Le panel : réservé à l'équipe (les partenaires n'ont pas accès à cette partie du panel).
  const staffOnly = (req) => { if (!isStaff(req.user)) throw new HttpError(403, 'Réservé aux administrateurs.'); };
  admin.get('/mailings', (req, res) => {
    staffOnly(req);
    res.json({
      mailEnabled, from: config.mailFrom,
      audiences: Object.entries(AUDIENCES).map(([id, a]) => ({ id, label: a.label, service: !!a.service, count: recipients(id).length })),
      mailings: all(`SELECT m.*, u.email AS author FROM mailings m LEFT JOIN users u ON u.id = m.created_by ORDER BY m.created_at DESC LIMIT 50`).map(mailingView),
    });
  });
  admin.post('/mailings/preview', (req, res) => {
    staffOnly(req);
    const service = req.body.audience === 'all';
    res.json(personal(composition(req.body), { id: 0, name: req.user.name, email: req.user.email }, service));
  });
  admin.post('/mailings/test', async (req, res, next) => {
    try {
      staffOnly(req);
      if (!mailEnabled) throw new HttpError(503, 'Aucun serveur de messagerie n\'est relié au serveur.');
      const m = personal(composition(req.body), req.user, req.body.audience === 'all');
      await sendMail(req.user.email, `[Essai] ${m.subject}`, m.text, undefined, { html: m.html });
      res.json({ ok: true, to: req.user.email });
    } catch (error) { next(error.status ? error : new HttpError(502, `L'essai n'est pas parti : ${error.message}`)); }
  });
  admin.post('/mailings', (req, res) => {
    staffOnly(req);
    if (!mailEnabled) throw new HttpError(503, 'Aucun serveur de messagerie n\'est relié au serveur.');
    const audience = AUDIENCES[req.body.audience] ? req.body.audience : null;
    if (!audience) throw new HttpError(400, 'Choisissez les destinataires.');
    if (AUDIENCES[audience].service && req.body.service !== true) {
      throw new HttpError(400, 'Un message à tous les comptes doit être une information de service, sans publicité : cochez la case qui le confirme.');
    }
    const c = composition(req.body);
    const list = recipients(audience);
    if (!list.length) throw new HttpError(400, 'Aucun destinataire pour le moment.');
    const id = transaction(() => {
      const { lastInsertRowid } = run(`INSERT INTO mailings (subject, content, audience, total, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        c.subject, JSON.stringify(c), audience, list.length, req.user.id, now());
      for (const user of list) run('INSERT INTO mailing_recipients (mailing_id, user_id, email) VALUES (?, ?, ?)', lastInsertRowid, user.id, user.email);
      return lastInsertRowid;
    });
    res.status(201).json(mailingView(get('SELECT * FROM mailings WHERE id = ?', id)));
  });
  admin.post('/mailings/:id/cancel', (req, res) => {
    staffOnly(req);
    const { changes } = run(`UPDATE mailings SET status = 'cancelled', done_at = ? WHERE id = ? AND status = 'sending'`, now(), Number(req.params.id));
    if (!changes) throw new HttpError(404, 'Aucun envoi en cours sous ce numéro.');
    res.json({ ok: true });
  });
}
