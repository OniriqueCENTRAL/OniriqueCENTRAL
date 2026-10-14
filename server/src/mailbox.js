import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config } from './config.js';
import { HttpError, rateLimit, validEmail } from './auth.js';
import { sendComposed } from './mail.js';

//==============================================================================
//  La boîte mail d'ONIRIQUE (IONOS) dans le panel des fondateurs : lue par IMAP, réponses envoyées par SMTP
//==============================================================================
// Le compte est celui de l'envoi des e-mails du serveur (voir config.js) : aucun mot de passe ne passe par le panel.
export const mailboxEnabled = !!(config.imapHost && config.imapUser && config.imapPassword);

/** Une connexion le temps d'une demande : ouverte, utilisée, refermée. */
async function withClient(fn) {
  if (!mailboxEnabled) throw new HttpError(503, 'Aucune boîte mail n\'est reliée au serveur.');
  const client = new ImapFlow({
    host: config.imapHost, port: config.imapPort, secure: config.imapPort === 993,
    auth: { user: config.imapUser, pass: config.imapPassword }, logger: false, socketTimeout: 30_000,
  });
  try {
    await client.connect();
  } catch (error) {
    throw new HttpError(502, `Connexion à la boîte mail impossible : ${error.responseText || error.message}`);
  }
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

const FOLDER_NAMES = { '\\Inbox': 'Boîte de réception', '\\Sent': 'Envoyés', '\\Drafts': 'Brouillons', '\\Trash': 'Corbeille', '\\Junk': 'Indésirables', '\\Archive': 'Archives' };
const folderName = (path) => String(path || '').slice(0, 200);
const address = (list) => (list?.value || list || []).map((a) => ({ name: a.name || '', address: a.address || '' }));
const short = (a) => (a?.[0] ? a[0].name || a[0].address : '');

export async function folders() {
  return withClient(async (client) => {
    const list = await client.list({ statusQuery: { messages: true, unseen: true } });
    const order = ['\\Inbox', '\\Sent', '\\Drafts', '\\Junk', '\\Archive', '\\Trash'];
    return list.filter((f) => !f.flags?.has('\\Noselect'))
      .map((f) => ({ path: f.path, name: FOLDER_NAMES[f.specialUse] || f.name, specialUse: f.specialUse || null, total: f.status?.messages ?? 0, unseen: f.status?.unseen ?? 0 }))
      .sort((a, b) => ((order.indexOf(a.specialUse) + 1 || 99) - (order.indexOf(b.specialUse) + 1 || 99)) || a.name.localeCompare(b.name));
  });
}

/** Une page de messages, les plus récents d'abord. */
export async function messages(folder, page = 1, perPage = 40) {
  return withClient(async (client) => {
    const lock = await client.getMailboxLock(folderName(folder) || 'INBOX');
    try {
      const total = client.mailbox.exists;
      const end = Math.max(0, total - (page - 1) * perPage), start = Math.max(1, end - perPage + 1);
      const items = [];
      if (end >= 1) {
        for await (const m of client.fetch(`${start}:${end}`, { uid: true, flags: true, envelope: true, internalDate: true, size: true, bodyStructure: true })) {
          const attachments = JSON.stringify(m.bodyStructure || {}).includes('"disposition":"attachment"');
          items.push({
            uid: m.uid, subject: m.envelope?.subject || '(sans objet)', from: short(m.envelope?.from), fromAddress: m.envelope?.from?.[0]?.address || '',
            to: short(m.envelope?.to), date: (m.internalDate || m.envelope?.date || new Date()).getTime(), seen: m.flags?.has('\\Seen') ?? false,
            flagged: m.flags?.has('\\Flagged') ?? false, attachments, size: m.size,
          });
        }
      }
      return { folder: client.mailbox.path, total, page, pages: Math.max(1, Math.ceil(total / perPage)), messages: items.reverse() };
    } finally {
      lock.release();
    }
  });
}

async function parsed(client, folder, uid) {
  const lock = await client.getMailboxLock(folderName(folder) || 'INBOX');
  try {
    const message = await client.fetchOne(String(uid), { source: true, flags: true }, { uid: true });
    if (!message) throw new HttpError(404, 'Message introuvable.');
    const mail = await simpleParser(message.source);
    if (!message.flags?.has('\\Seen')) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    return mail;
  } finally {
    lock.release();
  }
}

/** Un message lu : le marque comme lu. Le HTML est rendu tel quel au panel, qui l'affiche isolé, sans script. */
export async function message(folder, uid) {
  return withClient(async (client) => {
    const mail = await parsed(client, folder, uid);
    return {
      uid: Number(uid), folder, subject: mail.subject || '(sans objet)', date: mail.date?.getTime() ?? null,
      from: address(mail.from), to: address(mail.to), cc: address(mail.cc), replyTo: address(mail.replyTo),
      messageId: mail.messageId || null, references: [].concat(mail.references || []),
      text: mail.text || '', html: typeof mail.html === 'string' ? mail.html : '',
      attachments: (mail.attachments || []).map((a, index) => ({ index, filename: a.filename || `piece-jointe-${index + 1}`, size: a.size, contentType: a.contentType })),
    };
  });
}

export async function attachment(folder, uid, index) {
  return withClient(async (client) => {
    const mail = await parsed(client, folder, uid);
    const file = (mail.attachments || [])[Number(index)];
    if (!file) throw new HttpError(404, 'Pièce jointe introuvable.');
    return { filename: file.filename || `piece-jointe-${Number(index) + 1}`, contentType: file.contentType || 'application/octet-stream', content: file.content };
  });
}

export async function setSeen(folder, uid, seen) {
  return withClient(async (client) => {
    const lock = await client.getMailboxLock(folderName(folder) || 'INBOX');
    try {
      if (seen) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      else await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true });
    } finally { lock.release(); }
    return { ok: true };
  });
}

/** Met le message à la corbeille (ou l'efface pour de bon s'il y est déjà). */
export async function trash(folder, uid) {
  return withClient(async (client) => {
    const list = await client.list();
    const bin = list.find((f) => f.specialUse === '\\Trash')?.path;
    const lock = await client.getMailboxLock(folderName(folder) || 'INBOX');
    try {
      if (bin && bin !== client.mailbox.path) await client.messageMove(String(uid), bin, { uid: true });
      else await client.messageDelete(String(uid), { uid: true });
    } finally { lock.release(); }
    return { ok: true };
  });
}

const recipients = (value) => {
  const list = String(value || '').split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  for (const a of list) if (!validEmail(a.replace(/^.*<([^>]+)>$/, '$1'))) throw new HttpError(400, `Adresse invalide : ${a}`);
  return list;
};

/** Envoie une réponse ou un nouveau message depuis l'adresse d'ONIRIQUE, et en garde une copie dans les envoyés. */
export async function send(user, body) {
  rateLimit(`mailbox-send:${user.id}`, 30, 60 * 60_000);
  const to = recipients(body.to), cc = recipients(body.cc);
  if (!to.length) throw new HttpError(400, 'Indiquez au moins un destinataire.');
  const subject = String(body.subject || '').trim().slice(0, 200);
  const text = String(body.text || '').trim().slice(0, 50_000);
  if (!subject || !text) throw new HttpError(400, 'Écrivez un objet et un message.');
  const { raw } = await sendComposed({
    to, cc, subject, text, eyebrow: body.inReplyTo ? 'Réponse' : 'ONIRIQUE',
    inReplyTo: body.inReplyTo || undefined, references: Array.isArray(body.references) ? body.references.slice(-20) : undefined,
  });
  // Copie dans les envoyés : un échec ne défait pas l'envoi.
  if (mailboxEnabled) {
    await withClient(async (client) => {
      const sent = (await client.list()).find((f) => f.specialUse === '\\Sent')?.path;
      if (sent) await client.append(sent, raw, ['\\Seen']);
    }).catch((error) => console.error('Copie dans les envoyés :', error.message));
  }
  return { ok: true };
}
