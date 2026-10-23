// L'envoi des mails d'un pack de prods depuis la boîte mail du beatmaker, et le suivi de chaque destinataire : ouverture,
// clic, écoute, téléchargement, avec son nom. Les contacts viennent des listes du membre (CSV importé ou adresses collées).
import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { db, get, all, run, now } from './db.js';
import { HttpError, rateLimit } from './auth.js';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { smtpTransport, testing, outbox } from './mail.js';
import { escapeHtml } from './mailtemplate.js';
import { seal, unseal } from './payments.js';
import { mailDraft, packMailHtml, mailList } from './packmail.js';
import { offersOf } from './beatstore.js';

db.exec(`
CREATE TABLE IF NOT EXISTS sound_mailers (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  host       TEXT NOT NULL,
  port       INTEGER NOT NULL,
  login      TEXT NOT NULL,
  secret     TEXT NOT NULL,
  from_name  TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sound_mail_sends (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES sound_projects(id) ON DELETE SET NULL,
  subject    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  done_at    INTEGER
);
CREATE TABLE IF NOT EXISTS sound_mail_recipients (
  id         INTEGER PRIMARY KEY,
  send_id    INTEGER NOT NULL REFERENCES sound_mail_sends(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'wait',
  error      TEXT NOT NULL DEFAULT '',
  sent_at    INTEGER,
  opened_at  INTEGER,
  clicked_at INTEGER,
  plays      INTEGER NOT NULL DEFAULT 0,
  downloads  INTEGER NOT NULL DEFAULT 0,
  last_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sound_mail_recipients_by_user ON sound_mail_recipients (user_id, email);
CREATE TABLE IF NOT EXISTS sound_mail_events (
  recipient_id INTEGER NOT NULL REFERENCES sound_mail_recipients(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sound_mail_events_by_recipient ON sound_mail_events (recipient_id, at);
CREATE TABLE IF NOT EXISTS sound_mail_unsubs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email   TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, email)
);
`);

const PER_SEND = 300, PER_DAY = 500;
// Entre deux mails d'un envoi, un délai pris au hasard entre 15 et 30 secondes : un envoi régulier et rapide ressemble à
// du spam, et Gmail ou les autres boîtes bloquent l'expéditeur.
export const GAP = [15_000, 30_000];
const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$/i;
const str = (value, max = 200) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const parse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };

//------------------------------------------------------------------------------ Contacts
/** Une ligne de CSV : cellules séparées par sep, guillemets "…" (et "" pour un guillemet) compris. */
function cells(line, sep) {
  const out = [];
  let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && !cell.trim()) quoted = true;
    else if (c === sep) { out.push(cell.trim()); cell = ''; } else cell += c;
  }
  out.push(cell.trim());
  return out;
}
/**
 * Les contacts d'un CSV ou d'adresses collées : [{ email, name }], une adresse une fois. Avec une ligne d'en-tête, les
 * colonnes e-mail, artiste/pseudo, prénom et nom sont reconnues ; sans en-tête, le nom est l'autre texte de la ligne
 * (« Damso;damso@mail.fr », « Damso <damso@mail.fr> »).
 */
export function contactsOf(text) {
  const rows = String(text || '').replace(/^﻿/, '').split(/\r\n?|\n/).filter((l) => l.trim());
  if (!rows.length) return [];
  const sep = [';', '\t', ','].map((s) => [s, rows[0].split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const found = new Map();
  const add = (email, name) => {
    email = String(email || '').trim().replace(/^<|>$/g, '').toLowerCase();
    if (!EMAIL.test(email)) return;
    name = str(String(name || '').replace(/["<>]/g, ''), 120);
    if (!found.has(email)) found.set(email, { email, name });
    else if (!found.get(email).name && name) found.get(email).name = name;
  };
  const head = cells(rows[0], sep).map((h) => h.toLowerCase());
  if (!head.some((h) => h.includes('@'))) {
    const col = (re) => head.findIndex((h) => re.test(h));
    const mail = col(/mail|courriel/), alias = col(/artist|pseudo|alias|blaze|rappeur|beatmaker|producer|nom d'artiste/), first = col(/pr[ée]nom|first/),
      last = col(/^(nom|name|nom de famille|last ?name|surname|full ?name|nom complet|contact)$/);
    for (const row of rows.slice(1).map((r) => cells(r, sep))) {
      add(mail >= 0 && EMAIL.test(row[mail]) ? row[mail] : row.find((c) => EMAIL.test(c)),
        (alias >= 0 && row[alias]) || [first >= 0 && row[first], last >= 0 && row[last]].filter(Boolean).join(' '));
    }
  } else {
    for (const line of rows) {
      const hits = [...line.matchAll(/([^,;\t<>"@]*?)\s*<?([^\s,;<>"@]+@[^\s,;<>"@]+\.[a-z]{2,})>?/gi)];
      for (const [, name, email] of hits) add(email, name);
      if (hits.length === 1 && !found.get(hits[0][2].toLowerCase())?.name) add(hits[0][2], line.split(/[;	,]/).map((c) => c.trim()).filter((c) => c && !c.includes('@')).join(' '));
    }
  }
  return [...found.values()];
}
/** Les contacts d'une liste enregistrée ; les anciennes listes ne gardaient que les adresses. */
export const listContacts = (l) => parse(l.emails, []).map((x) => (typeof x === 'string' ? { email: x, name: '' } : x));

//------------------------------------------------------------------------------ Couleurs de la pochette
const palettes = new Map();
const hex = (h, s, l) => {
  const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
};
/** Les couleurs du mail tirées de la couleur dominante de la pochette : fond et carte sombres, accent vif, texte clair. */
export async function coverPalette(cover) {
  if (!cover) return null;
  if (palettes.has(cover)) return palettes.get(cover);
  let palette = null;
  try {
    const { r, g, b } = (await sharp(path.join(config.mediaDir, path.basename(cover))).stats()).dominant;
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2, d = max - min;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    const h = !d ? 0 : max === r / 255 ? 60 * (((g - b) / 255 / d) % 6) : max === g / 255 ? 60 * ((b - r) / 255 / d + 2) : 60 * ((r - g) / 255 / d + 4);
    const hue = (h + 360) % 360, tint = Math.min(s, 0.6);
    palette = { bg: hex(hue, tint, 0.06), card: hex(hue, tint, 0.11), accent: hex(hue, Math.max(s, 0.55), 0.58), text: hex(hue, 0.3, 0.95),
      muted: hex(hue, 0.15, 0.72), button: hex(hue, 0.3, 0.95), buttonText: hex(hue, tint, 0.08) };
  } catch {}
  if (palettes.size > 500) palettes.clear();
  palettes.set(cover, palette);
  return palette;
}

//------------------------------------------------------------------------------ Boîte mail du membre
// Deux façons de la brancher : « Se connecter avec Google » (host = 'google', l'accès Gmail gardé chiffré dans secret,
// les mails partent par l'API Gmail), ou n'importe quelle boîte par SMTP (mot de passe d'application chiffré).
const mailerRow = (userId) => get('SELECT * FROM sound_mailers WHERE user_id = ?', userId);
export const googleReady = () => !!(config.googleClientId && config.googleClientSecret);
export const mailerView = (userId) => {
  const m = mailerRow(userId);
  return m ? { connected: true, google: m.host === 'google', host: m.host === 'google' ? 'Gmail' : m.host, port: m.port, login: m.login, fromName: m.from_name, fromEmail: m.from_email, googleReady: googleReady() }
    : { connected: false, googleReady: googleReady() };
};
const googleToken = async (params) => {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleClientSecret, ...params }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(502, `Google refuse : ${data.error_description || data.error || response.status}`);
  return data;
};
/** L'envoi par l'API Gmail : le message est composé ici (MIME), puis Gmail l'envoie depuis la boîte du membre. */
export function gmailTransport(m) {
  let access = null;
  return {
    async sendMail(message) {
      if (!access || access.expires < now()) {
        const t = await googleToken({ refresh_token: unseal(m.secret), grant_type: 'refresh_token' });
        access = { token: t.access_token, expires: now() + ((t.expires_in || 3600) - 60) * 1000 };
      }
      const raw = (await new MailComposer(message).compile().build()).toString('base64url');
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', headers: { Authorization: `Bearer ${access.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) });
      if (!response.ok) {
        const why = (await response.json().catch(() => ({}))).error?.message || String(response.status);
        // L'API Gmail coupée dans le projet Google d'ONIRIQUE : seul un fondateur peut la réactiver.
        if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(why)) throw new Error("L'API Gmail n'est pas activée dans le projet Google d'ONIRIQUE : un fondateur doit l'activer dans la console Google Cloud, puis « Renvoyer aux échecs ».");
        throw new Error(`Gmail refuse l'envoi (${why})`);
      }
    },
  };
}
const transportOf = (m) => (m.host === 'google' && !testing ? gmailTransport(m) : smtpTransport({ host: m.host, port: m.port, login: m.login, password: unseal(m.secret) }));
// Les connexions Google en cours : la demande (state) dit de quel membre il s'agit, et sur quel pack revenir.
const pendingGoogle = new Map();

// Le suivi : chaque geste d'un destinataire, et ses compteurs.
export function recipientFor(userId, token) {
  return token ? get('SELECT * FROM sound_mail_recipients WHERE token = ? AND user_id = ?', String(token).slice(0, 64), userId) || null : null;
}
export function trackRecipient(r, type, title = '') {
  if (!r) return;
  const t = now();
  // Une ouverture ou une visite répétée dans l'heure ne compte qu'une fois.
  if ((type === 'open' || type === 'visit') && get('SELECT 1 AS x FROM sound_mail_events WHERE recipient_id = ? AND type = ? AND at > ?', r.id, type, t - 3600_000)) return;
  run('INSERT INTO sound_mail_events (recipient_id, type, title, at) VALUES (?, ?, ?, ?)', r.id, type, str(title, 200), t);
  run(`UPDATE sound_mail_recipients SET last_at = ?, opened_at = COALESCE(opened_at, ?), clicked_at = CASE WHEN ? THEN COALESCE(clicked_at, ?) ELSE clicked_at END,
    plays = plays + ?, downloads = downloads + ? WHERE id = ?`, t, t, type === 'open' || type === 'unsubscribe' ? 0 : 1, t, type === 'play' ? 1 : 0, type === 'download' ? 1 : 0, r.id);
}
const recipientView = (r, events) => ({
  id: r.id, email: r.email, name: r.name, status: r.status, error: r.error, sentAt: r.sent_at, openedAt: r.opened_at, clickedAt: r.clicked_at,
  plays: r.plays, downloads: r.downloads, lastAt: r.last_at, ...(events ? { events: events.map((e) => ({ type: e.type, title: e.title, at: e.at })) } : {}),
});

const googleBack = () => `${config.publicUrl}/api/youtube/callback`;
/** Une demande de connexion Google en cours vient-elle du panneau Mails (et non de YouTube) ? */
export const ownsGoogleState = (state) => pendingGoogle.has(String(state || ''));
/** Retour de Google, sans session : la demande en cours dit de quel compte il s'agit ; on revient sur le panneau Mails. */
export async function googleMailerCallback(req, res) {
  const entry = pendingGoogle.get(String(req.query.state || ''));
  pendingGoogle.delete(String(req.query.state || ''));
  let result = 'ok';
  try {
    if (!entry || entry.expires < now() || !req.query.code) throw new HttpError(400, 'Connexion Google expirée ou refusée : recommence.');
    const t = await googleToken({ code: String(req.query.code).slice(0, 2000), grant_type: 'authorization_code', redirect_uri: googleBack() });
    if (!t.refresh_token) throw new HttpError(502, 'Google n\'a pas donné d\'accès durable : recommence.');
    if (!String(t.scope || '').includes('gmail.send')) throw new HttpError(400, 'Coche l\'autorisation d\'envoyer des e-mails pour que tes mails puissent partir.');
    // L'adresse du compte, lue dans le jeton d'identité que Google vient de rendre directement à ce serveur.
    const email = String(JSON.parse(Buffer.from(String(t.id_token || '').split('.')[1] || '', 'base64url').toString() || '{}').email || '').toLowerCase();
    if (!EMAIL.test(email)) throw new HttpError(502, 'Google n\'a pas donné l\'adresse du compte : recommence.');
    run(`INSERT INTO sound_mailers (user_id, host, port, login, secret, from_name, from_email, updated_at) VALUES (?, 'google', 0, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET host = excluded.host, port = excluded.port, login = excluded.login, secret = excluded.secret,
        from_name = excluded.from_name, from_email = excluded.from_email, updated_at = excluded.updated_at`,
    entry.userId, email, seal(t.refresh_token), entry.fromName, email, now());
  } catch (error) { result = error.message; }
  res.redirect(`${config.siteUrl}/mes-sons.html?google=${encodeURIComponent(result)}${entry?.projectId ? `#/p/${entry.projectId}` : ''}`);
}

//------------------------------------------------------------------------------ Routes
/** Les envois coupés par un redémarrage du serveur (une mise en ligne) reprennent là où ils en étaient. */
export async function resumeSends() {
  for (const s of all('SELECT * FROM sound_mail_sends WHERE done_at IS NULL')) {
    const m = mailerRow(s.user_id), p = s.project_id && get('SELECT * FROM sound_projects WHERE id = ?', s.project_id);
    if (!m || !p) {
      run(`UPDATE sound_mail_recipients SET status = 'error', error = 'Envoi interrompu : boîte mail ou pack introuvable.' WHERE send_id = ? AND status = 'wait'`, s.id);
      run('UPDATE sound_mail_sends SET done_at = ? WHERE id = ?', now(), s.id);
      continue;
    }
    await launch(s.id, m, p, mailDraft(parse(p.mail || '{}', {})));
  }
}
export function mountPackSend(app, { me, ownProject, sign, wrap }) {
  signLinks = sign;
  if (!testing) setTimeout(() => resumeSends().catch((error) => console.error(`[mails] reprise : ${error.message}`)), 5000).unref();
  // La boîte mail du membre : essayée pour de bon avant d'être gardée, le mot de passe chiffré.
  app.get('/api/me/sounds/mailer', ...me, (req, res) => res.json(mailerView(req.user.id)));
  app.put('/api/me/sounds/mailer', ...me, wrap(async (req, res) => {
    rateLimit(`sounds-mailer:${req.user.id}`, 20);
    const b = req.body || {};
    const host = str(b.host, 120).toLowerCase(), port = Number(b.port), login = str(b.login, 200), password = String(b.password || '');
    const fromEmail = str(b.fromEmail, 200).toLowerCase() || (EMAIL.test(login) ? login.toLowerCase() : '');
    // Seuls les serveurs d'envoi publics, sur leurs ports habituels.
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^[\d.]+$/.test(host) || /(^|\.)localhost$/.test(host)) throw new HttpError(400, 'Adresse du serveur d\'envoi invalide (par exemple smtp.gmail.com).');
    if (![25, 465, 587, 2525].includes(port)) throw new HttpError(400, 'Port : 465 ou 587 en général.');
    if (!login || !password) throw new HttpError(400, 'Il faut l\'identifiant et le mot de passe de la boîte mail.');
    if (!EMAIL.test(fromEmail)) throw new HttpError(400, 'Adresse d\'expéditeur invalide.');
    try { await smtpTransport({ host, port, login, password }).verify(); } catch (error) {
      throw new HttpError(400, `La boîte mail refuse la connexion (${error.message.slice(0, 160)}). Pour Gmail ou Outlook, il faut un mot de passe d'application.`);
    }
    run(`INSERT INTO sound_mailers (user_id, host, port, login, secret, from_name, from_email, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET host = excluded.host, port = excluded.port, login = excluded.login, secret = excluded.secret,
        from_name = excluded.from_name, from_email = excluded.from_email, updated_at = excluded.updated_at`,
    req.user.id, host, port, login, seal(password), str(b.fromName, 80), fromEmail, now());
    res.json(mailerView(req.user.id));
  }));
  app.delete('/api/me/sounds/mailer', ...me, wrap(async (req, res) => {
    const m = mailerRow(req.user.id);
    // Google oublie aussi l'accès de son côté ; s'il ne répond pas, la boîte est quand même débranchée ici.
    if (m?.host === 'google') await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token: unseal(m.secret) }) }).catch(() => {});
    run('DELETE FROM sound_mailers WHERE user_id = ?', req.user.id);
    res.json(mailerView(req.user.id));
  }));

  // « Se connecter avec Google » : seul le droit d'envoyer des mails est demandé (gmail.send), plus l'adresse du compte.
  // Google revient par l'adresse déjà déclarée pour YouTube (même client OAuth) ; la demande en cours dit que c'est un mail.
  app.post('/api/me/sounds/mailer/google', ...me, (req, res) => {
    if (!googleReady()) throw new HttpError(503, 'La connexion avec Google n\'est pas encore réglée sur le serveur.');
    for (const [k, v] of pendingGoogle) if (v.expires < now()) pendingGoogle.delete(k);
    const state = crypto.randomBytes(24).toString('base64url');
    pendingGoogle.set(state, { userId: req.user.id, projectId: Number(req.body?.projectId) || 0, fromName: str(req.body?.fromName, 80), expires: now() + 10 * 60_000 });
    res.json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: config.googleClientId, redirect_uri: googleBack(), response_type: 'code', state,
      scope: 'openid email https://www.googleapis.com/auth/gmail.send', access_type: 'offline', prompt: 'consent', // un accès qui dure
    }) });
  });

  // L'envoi du mail d'un pack : un destinataire par adresse du brouillon, chacun avec ses liens suivis ; parti en
  // arrière-plan, un message à la fois.
  app.post('/api/me/sounds/projects/:id/mail/send', ...me, wrap(async (req, res) => {
    const p = ownProject(req, req.params.id);
    if (p.kind !== 'pack') throw new HttpError(400, 'Seul un pack de prods a des mails.');
    const m = mailerRow(req.user.id);
    if (!m) throw new HttpError(400, 'Connecte d\'abord ta boîte mail : les mails partent de ton adresse.');
    rateLimit(`sounds-send:${req.user.id}`, 20, 3600_000);
    const d = mailDraft(parse(p.mail || '{}', {}));
    if (!d.subject) throw new HttpError(400, 'Écris l\'objet du mail.');
    const blocked = new Set(all('SELECT email FROM sound_mail_unsubs WHERE user_id = ?', req.user.id).map((x) => x.email));
    const emails = mailList(d.to).valid.filter((e) => !blocked.has(e));
    if (!emails.length) throw new HttpError(400, 'Aucun destinataire (les adresses désinscrites sont retirées).');
    if (emails.length > PER_SEND) throw new HttpError(400, `${PER_SEND} destinataires au plus par envoi.`);
    const today = get('SELECT COUNT(*) AS n FROM sound_mail_recipients WHERE user_id = ? AND created_at > ?', req.user.id, now() - 86400_000).n;
    if (today + emails.length > PER_DAY) throw new HttpError(400, `${PER_DAY} mails au plus par jour : il en reste ${Math.max(0, PER_DAY - today)} aujourd'hui.`);
    const names = new Map();
    for (const l of all('SELECT emails FROM sound_mail_lists WHERE user_id = ? OR (shared = 1 AND ?) ORDER BY shared, created_at', req.user.id, ['vip', 'founder'].includes(req.user.role) ? 1 : 0)) {
      for (const c of listContacts(l)) if (c.name && !names.has(c.email)) names.set(c.email, c.name);
    }
    const sid = run('INSERT INTO sound_mail_sends (user_id, project_id, subject, created_at) VALUES (?, ?, ?, ?)', req.user.id, p.id, d.subject, now()).lastInsertRowid;
    for (const email of emails) {
      run('INSERT INTO sound_mail_recipients (send_id, user_id, token, email, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        sid, req.user.id, crypto.randomBytes(16).toString('base64url'), email, names.get(email) || '', now());
    }
    await launch(sid, m, p, d);
    res.status(202).json({ id: sid, total: emails.length });
  }));
  // Renvoyer un envoi à ceux pour qui il a échoué (boîte mail rebranchée, API Gmail réactivée…), avec le mail du pack.
  app.post('/api/me/sounds/mail/sends/:id/retry', ...me, wrap(async (req, res) => {
    const sent = get('SELECT * FROM sound_mail_sends WHERE id = ? AND user_id = ?', Number(req.params.id) || 0, req.user.id);
    if (!sent || !sent.project_id) throw new HttpError(404, 'Envoi introuvable.');
    const p = ownProject(req, sent.project_id), m = mailerRow(req.user.id);
    if (!m) throw new HttpError(400, 'Connecte d\'abord ta boîte mail : les mails partent de ton adresse.');
    if (!sent.done_at) throw new HttpError(400, 'Cet envoi est encore en cours.');
    rateLimit(`sounds-send:${req.user.id}`, 20, 3600_000);
    const n = run(`UPDATE sound_mail_recipients SET status = 'wait', error = '' WHERE send_id = ? AND status = 'error'`, sent.id).changes;
    if (!n) throw new HttpError(400, 'Aucun échec à renvoyer.');
    run('UPDATE sound_mail_sends SET done_at = NULL WHERE id = ?', sent.id);
    await launch(sent.id, m, p, mailDraft(parse(p.mail || '{}', {})));
    res.status(202).json({ id: sent.id, total: n });
  }));

  // Le suivi : les envois d'un pack, puis chaque destinataire d'un envoi avec ce qu'il a fait.
  app.get('/api/me/sounds/projects/:id/mail/sends', ...me, (req, res) => {
    const p = ownProject(req, req.params.id);
    res.json(all(`SELECT s.*, COUNT(r.id) AS total, SUM(r.status = 'sent') AS sent, SUM(r.status = 'error') AS failed, SUM(r.opened_at IS NOT NULL) AS opened,
      SUM(r.clicked_at IS NOT NULL) AS clicked, SUM(r.plays > 0) AS listened, SUM(r.downloads > 0) AS downloaded, SUM(r.status = 'wait') AS waiting
      FROM sound_mail_sends s LEFT JOIN sound_mail_recipients r ON r.send_id = s.id WHERE s.project_id = ? AND s.user_id = ? GROUP BY s.id ORDER BY s.created_at DESC`, p.id, req.user.id)
      .map((s) => ({ id: s.id, subject: s.subject, createdAt: s.created_at, done: !!s.done_at, waiting: s.waiting || 0, gap: (GAP[0] + GAP[1]) / 2000, total: s.total, sent: s.sent || 0, failed: s.failed || 0,
        opened: s.opened || 0, clicked: s.clicked || 0, listened: s.listened || 0, downloaded: s.downloaded || 0 })));
  });
  app.get('/api/me/sounds/mail/sends/:id', ...me, (req, res) => {
    const s = get('SELECT * FROM sound_mail_sends WHERE id = ? AND user_id = ?', Number(req.params.id) || 0, req.user.id);
    if (!s) throw new HttpError(404, 'Envoi introuvable.');
    const rows = all('SELECT * FROM sound_mail_recipients WHERE send_id = ? ORDER BY COALESCE(last_at, 0) DESC, id', s.id);
    const events = all(`SELECT e.* FROM sound_mail_events e JOIN sound_mail_recipients r ON r.id = e.recipient_id WHERE r.send_id = ? ORDER BY e.at DESC`, s.id);
    res.json({ id: s.id, subject: s.subject, createdAt: s.created_at, done: !!s.done_at,
      recipients: rows.map((r) => recipientView(r, events.filter((e) => e.recipient_id === r.id))) });
  });

  // Ce que voit le destinataire : l'image d'ouverture, les liens externes (redirection signée) et la désinscription.
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const byToken = (req) => get('SELECT * FROM sound_mail_recipients WHERE token = ?', String(req.params.token).slice(0, 64));
  app.get('/api/sounds/m/:token/o.gif', (req, res) => {
    trackRecipient(byToken(req), 'open');
    res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0' }).send(pixel);
  });
  app.get('/api/sounds/m/:token/lien', (req, res) => {
    const r = byToken(req), url = String(req.query.u || '');
    if (!r || !/^https?:\/\//i.test(url) || String(req.query.s || '') !== sign(`mail.${r.token}.${url}`)) throw new HttpError(404, 'Lien introuvable.');
    trackRecipient(r, 'click', url);
    res.redirect(302, url);
  });
  const unsubPage = (title, text, form = '') => `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0D0809;color:#F6EEEE;font:16px/1.6 system-ui,sans-serif"><main style="max-width:440px;padding:24px;text-align:center">
<h1 style="font-size:22px">${title}</h1><p style="color:#B39A9D">${text}</p>${form}</main></body></html>`;
  app.get('/api/sounds/m/:token/desinscription', (req, res) => {
    const r = byToken(req);
    if (!r) throw new HttpError(404, 'Lien introuvable.');
    const from = get('SELECT from_name, from_email FROM sound_mailers WHERE user_id = ?', r.user_id);
    res.type('html').send(unsubPage('Se désinscrire', `Tu ne recevras plus les mails de ${escapeHtml(from?.from_name || from?.from_email || 'cet artiste')} envoyés depuis ONIRIQUE à ${escapeHtml(r.email)}.`,
      '<form method="post"><button style="padding:12px 22px;border:0;border-radius:999px;background:#F6EEEE;color:#0D0809;font-weight:700;cursor:pointer">Me désinscrire</button></form>'));
  });
  app.post('/api/sounds/m/:token/desinscription', (req, res) => {
    const r = byToken(req);
    if (!r) throw new HttpError(404, 'Lien introuvable.');
    run('INSERT OR IGNORE INTO sound_mail_unsubs (user_id, email, at) VALUES (?, ?, ?)', r.user_id, r.email, now());
    trackRecipient(r, 'unsubscribe');
    res.type('html').send(unsubPage('C\'est fait', 'Tu es désinscrit : plus aucun mail de cet artiste ne te sera envoyé depuis ONIRIQUE.'));
  });
}

// Un envoi part en arrière-plan, par le lien d'écoute du pack ouvert à tous (sans mot de passe ni compte), créé s'il n'y
// en a pas ; avec les couleurs de la pochette si le mail les demande.
let signLinks = null; // la signature des liens suivis (sounds.js), donnée au montage des routes
async function launch(sid, m, p, d) {
  let link = get(`SELECT * FROM sound_links WHERE project_id = ? AND user_id = ? AND password_hash IS NULL AND require_account = 0
    AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC`, p.id, p.user_id, now());
  if (!link) {
    const token = crypto.randomBytes(12).toString('base64url');
    run(`INSERT INTO sound_links (token, user_id, project_id, track_id, label, password_hash, expires_at, download, require_account, created_at)
      VALUES (?, ?, ?, NULL, 'Mails', NULL, NULL, 1, 0, ?)`, token, p.user_id, p.id, now());
    link = get('SELECT * FROM sound_links WHERE token = ?', token);
  }
  const tracks = all('SELECT * FROM sound_tracks WHERE project_id = ? ORDER BY position, id', p.id);
  const palette = d.coverColors ? await coverPalette(p.cover) : null;
  const job = deliver({ sid, m, d: palette ? { ...d, colors: palette } : d, p, link, tracks, sign: signLinks });
  if (testing) await job; else job.catch((error) => console.error(`[mails] envoi ${sid} : ${error.message}`));
}

// Les messages d'un envoi, un par un ; le nom du contact remplace {nom}.
async function deliver({ sid, m, d, p, link, tracks, sign }) {
  const transport = transportOf(m);
  const api = `${config.siteUrl}/api/sounds/m`;
  const from = m.from_name ? `"${m.from_name.replace(/"/g, '')}" <${m.from_email}>` : m.from_email;
  const queue = all(`SELECT * FROM sound_mail_recipients WHERE send_id = ? AND status = 'wait' ORDER BY id`, sid);
  for (const [i, r] of queue.entries()) {
    // Boîte mail débranchée pendant l'envoi : le reste ne part pas (« Renvoyer aux échecs » une fois rebranchée).
    if (!mailerRow(m.user_id)) {
      run(`UPDATE sound_mail_recipients SET status = 'error', error = 'Boîte mail débranchée pendant l''envoi.' WHERE send_id = ? AND status = 'wait'`, sid);
      break;
    }
    const listen = `${config.siteUrl}/ecoute?t=${link.token}&r=${r.token}`;
    const follow = (url) => (url.startsWith(`${config.siteUrl}/ecoute?t=${link.token}`) ? url
      : `${api}/${r.token}/lien?u=${encodeURIComponent(url)}&s=${sign(`mail.${r.token}.${url}`)}`);
    const name = (text) => String(text || '').replace(/\{nom\}/gi, r.name).replace(/ +([,.])/g, '$1').replace(/ {2,}/g, ' ');
    const draft = { ...d, subject: name(d.subject), preheader: name(d.preheader), eyebrow: name(d.eyebrow), title: name(d.title), text: name(d.text), signature: name(d.signature) };
    const unsubscribe = `${api}/${r.token}/desinscription`;
    const html = packMailHtml(draft, {
      title: p.title, artist: p.artist || m.from_name || 'ONIRIQUE', cover: p.cover ? `/api/media/${p.cover}` : null, listenUrl: listen,
      tracks: tracks.map((t) => {
        const offers = offersOf(t, p.user_id);
        return { id: t.id, title: t.title, bpm: t.bpm, key: t.music_key, price: offers.length ? Math.min(...offers.map((o) => o.price)) : 0, buyUrl: listen };
      }),
      link: follow, pixel: `${api}/${r.token}/o.gif`, unsubscribe,
    });
    const text = [draft.title || p.title, '', draft.text, '', `Écouter : ${listen}`, '', draft.signature || m.from_name || '', '', `Se désinscrire : ${unsubscribe}`].join('\n');
    const message = { from, to: r.name ? `"${r.name.replace(/"/g, '')}" <${r.email}>` : r.email, subject: draft.subject, text, html,
      headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
    try {
      if (testing) outbox.push(message);
      await transport.sendMail(message);
      run(`UPDATE sound_mail_recipients SET status = 'sent', sent_at = ? WHERE id = ?`, now(), r.id);
    } catch (error) {
      run(`UPDATE sound_mail_recipients SET status = 'error', error = ? WHERE id = ?`, String(error.message).slice(0, 300), r.id);
    }
    if (!testing && i < queue.length - 1) await new Promise((resolve) => setTimeout(resolve, GAP[0] + Math.random() * (GAP[1] - GAP[0])));
  }
  run('UPDATE sound_mail_sends SET done_at = ? WHERE id = ?', now(), sid);
}
