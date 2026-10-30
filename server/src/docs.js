// Presskit et devis (menu Outils) : le PDF envoyé au client depuis la boîte mail du membre, et le devis signé en ligne.
// Le client reçoit un lien (devis.html?signer=…), lit le devis, signe au doigt ou à la souris ; l'émetteur reçoit le
// devis signé avec sa trace : nom, date, adresse IP, appareil et empreinte SHA-256 du devis.
import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';
import { db, get, run, now } from './db.js';
import { HttpError, rateLimit } from './auth.js';
import { mailEnabled, sendMail, testing, outbox } from './mail.js';
import { mailerRow, transportOf } from './packsend.js';

db.exec(`
CREATE TABLE IF NOT EXISTS doc_signs (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  data         TEXT NOT NULL,
  hash         TEXT NOT NULL,
  client_email TEXT NOT NULL DEFAULT '',
  signer_name  TEXT,
  signature    TEXT,
  signed_at    INTEGER,
  signer_ip    TEXT,
  signer_agent TEXT,
  created_at   INTEGER NOT NULL
);
`);

const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$/i;
const str = (value, max = 200) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const text = (value, max = 4000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const when = (ms) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' });
const signLink = (token) => `${config.siteUrl}/devis.html?signer=${token}`;

/** Le message part de la boîte mail reliée par le membre (Gmail ou autre). */
async function sendFrom(m, message) {
  const full = { from: m.from_name ? `"${m.from_name.replace(/"/g, '')}" <${m.from_email}>` : m.from_email, ...message };
  if (testing) outbox.push(full);
  try { await transportOf(m).sendMail(full); } catch (error) {
    throw new HttpError(502, `Ta boîte mail refuse l'envoi (${String(error.message).slice(0, 160)}). Relie-la de nouveau, puis réessaie.`);
  }
}

const view = (d, owner) => ({
  title: d.title, data: JSON.parse(d.data), hash: d.hash, from: owner?.name || '', createdAt: d.created_at,
  signed: !!d.signed_at, signerName: d.signer_name, signature: d.signature, signedAt: d.signed_at, signerIp: d.signer_ip, signerAgent: d.signer_agent,
});

export function mountDocs(app, { requireUser, wrap }) {
  const big = express.json({ limit: '6mb' });

  // Le presskit en PDF (fabriqué dans le navigateur), envoyé en pièce jointe au client.
  app.post('/api/me/docs/send', requireUser, big, wrap(async (req, res) => {
    rateLimit(`docs-send:${req.user.id}`, 30, 3600_000);
    const b = req.body || {};
    const to = str(b.to, 200).toLowerCase(), subject = str(b.subject, 200);
    const pdf = Buffer.from(String(b.pdf || ''), 'base64');
    if (!EMAIL.test(to)) throw new HttpError(400, 'Adresse du client invalide.');
    if (!subject) throw new HttpError(400, 'Écris l\'objet du mail.');
    if (pdf.subarray(0, 5).toString() !== '%PDF-' || pdf.length > 4 * 1024 * 1024) throw new HttpError(400, 'PDF invalide ou trop lourd (4 Mo au plus).');
    const m = mailerRow(req.user.id);
    if (!m) throw new HttpError(400, 'Relie d\'abord ta boîte mail : le presskit part de ton adresse.');
    const filename = (str(b.filename, 120).replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Presskit') + (/\.pdf$/i.test(b.filename || '') ? '' : '.pdf');
    await sendFrom(m, { to, subject, text: text(b.text) || 'Bonjour,\n\nVoici mon presskit en pièce jointe.',
      attachments: [{ filename, content: pdf, contentType: 'application/pdf' }] });
    res.json({ ok: true, from: m.from_email });
  }));

  // Un devis à faire signer : gardé tel quel (son empreinte le prouve), et le lien envoyé au client s'il y a son adresse.
  app.post('/api/me/docs/sign', requireUser, big, wrap(async (req, res) => {
    rateLimit(`docs-sign:${req.user.id}`, 30, 3600_000);
    const b = req.body || {};
    const d = b.data;
    if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.lignes)) throw new HttpError(400, 'Devis illisible.');
    const data = JSON.stringify(d);
    if (data.length > 3 * 1024 * 1024) throw new HttpError(400, 'Devis trop lourd : prends un logo plus petit.');
    const to = str(b.to, 200).toLowerCase();
    if (to && !EMAIL.test(to)) throw new HttpError(400, 'Adresse du client invalide.');
    const token = crypto.randomBytes(18).toString('base64url');
    const title = `Devis ${str(d.numero, 60)}`.trim();
    run(`INSERT INTO doc_signs (user_id, token, title, data, hash, client_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      req.user.id, token, title, data, crypto.createHash('sha256').update(data).digest('hex'), to, now());
    const link = signLink(token), who = str(d.nom, 80) || req.user.name || req.user.email;
    let from = '';
    if (to) {
      const subject = `${title} à signer — ${who}`;
      const body = `Bonjour,\n\n${text(b.text) || `Voici mon devis${d.objet ? ` pour « ${str(d.objet, 120)} »` : ''}. Tu peux le lire et le signer en ligne, au doigt ou à la souris :`}\n\n${link}\n\n${who}`;
      const m = mailerRow(req.user.id);
      if (!m && !mailEnabled) throw new HttpError(503, "L'envoi de mails n'est pas réglé sur le serveur : relie ta boîte mail, ou copie le lien.");
      // Sans boîte mail reliée, le lien part d'ONIRIQUE ; la réponse du client revient au membre.
      if (m) { await sendFrom(m, { to, subject, text: body }); from = m.from_email; } else await sendMail(to, subject, body, req.user.email, { buttonLabel: 'Lire et signer le devis' });
    }
    res.status(201).json({ token, link, sentTo: to, from });
  }));

  app.get('/api/docs/sign/:token', (req, res) => {
    const d = get('SELECT * FROM doc_signs WHERE token = ?', String(req.params.token).slice(0, 64));
    if (!d) throw new HttpError(404, 'Ce lien de signature n\'existe pas ou plus.');
    res.set('Cache-Control', 'no-store').json(view(d, get('SELECT name FROM users WHERE id = ?', d.user_id)));
  });

  app.post('/api/docs/sign/:token', big, wrap(async (req, res) => {
    rateLimit(`docs-signer:${req.ip}`, 20);
    const d = get('SELECT * FROM doc_signs WHERE token = ?', String(req.params.token).slice(0, 64));
    if (!d) throw new HttpError(404, 'Ce lien de signature n\'existe pas ou plus.');
    if (d.signed_at) throw new HttpError(409, 'Ce devis est déjà signé.');
    const b = req.body || {};
    const name = str(b.name, 100), signature = String(b.signature || '');
    if (name.length < 2) throw new HttpError(400, 'Écris ton nom complet.');
    if (b.accept !== true) throw new HttpError(400, 'Coche « Bon pour accord » pour signer.');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length > 400_000) throw new HttpError(400, 'Signe dans le cadre avant de valider.');
    const at = now(), ip = String(req.ip || ''), agent = str(req.headers['user-agent'], 300);
    // La condition « pas encore signé » dans la requête : deux signatures en même temps, une seule passe.
    if (!run(`UPDATE doc_signs SET signer_name = ?, signature = ?, signed_at = ?, signer_ip = ?, signer_agent = ? WHERE id = ? AND signed_at IS NULL`,
      name, signature, at, ip, agent, d.id).changes) throw new HttpError(409, 'Ce devis est déjà signé.');

    const owner = get('SELECT name, email FROM users WHERE id = ?', d.user_id);
    const trace = `Signé par : ${name}\nLe : ${when(at)} (heure de Paris)\nAdresse IP : ${ip}\nAppareil : ${agent || 'inconnu'}\nEmpreinte du devis (SHA-256) : ${d.hash}`;
    const link = signLink(d.token);
    const mails = [sendMail(owner.email, `${d.title} signé par ${name} — ONIRIQUE`,
      `Bonjour,\n\nTon devis vient d'être signé en ligne.\n\n${trace}\n\nVoir et télécharger le devis signé :\n${link}`, undefined, { buttonLabel: 'Voir le devis signé' })];
    if (d.client_email) {
      mails.push(sendMail(d.client_email, `${d.title} : ta signature est enregistrée — ONIRIQUE`,
        `Bonjour,\n\nMerci, ta signature est enregistrée. Garde ce mail : il en est la preuve.\n\n${trace}\n\nRevoir le devis signé :\n${link}`, owner.email, { buttonLabel: 'Revoir le devis signé' }));
    }
    // La signature est gardée même si un mail ne part pas : le lien montre toujours le devis signé.
    await Promise.all(mails.map((p) => p.catch((error) => console.error(`[devis] mail de signature : ${error.message}`))));
    res.json(view(get('SELECT * FROM doc_signs WHERE id = ?', d.id), owner));
  }));
}
