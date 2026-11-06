// Les messages privés entre membres (messages.html) : on écrit à quelqu'un qui a une page de profil (profiles.js).
// Un message peut répondre à un autre, porter une photo, un vocal ou des sons du CLOUD (un titre ou toute une playlist,
// joués dans la conversation comme dans le HM), recevoir une réaction, être modifié (un quart d'heure) ou supprimé.
// Le direct (nouveau message, « en train d'écrire », « Vu ») passe par un flux par membre, /api/me/messages-live
// (Server-Sent Events lus par fetch pour porter le jeton, comme le HM) ; sans flux ouvert, une notification part.
import fs from 'node:fs';
import path from 'node:path';
import './profiles.js'; // la table user_messages et les pages de profil
import { config } from './config.js';
import { db, get, all, run, now } from './db.js';
import { HttpError, rateLimit } from './auth.js';
import { cleanItem } from './hm.js';
import { audioType, versionAudio } from './sounds.js';
import { push, wants } from './push.js';

const column = (name) => db.prepare("SELECT 1 FROM pragma_table_info('user_messages') WHERE name = ?").get(name);
for (const [name, type] of [['reply_to', 'INTEGER'], ['attach', 'TEXT'], ['edited_at', 'INTEGER'], ['deleted_at', 'INTEGER']]) {
  if (!column(name)) db.exec(`ALTER TABLE user_messages ADD COLUMN ${name} ${type}`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS user_message_reactions (
  message_id INTEGER NOT NULL REFERENCES user_messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS user_messages_to ON user_messages(to_id, read_at);
`);

export const REACTIONS = ['❤️', '🔥', '😂', '😮', '😢', '👍'];
const EDIT_WINDOW = 15 * 60_000;
const MAX_FILE = 6 * 1024 * 1024;
const MAX_SOUNDS = 50;
const filesDir = path.join(config.dataDir, 'messages');

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const media = (name) => (name ? `/api/media/${name}` : null);
const person = (u) => ({ id: u.id, name: u.name || 'Membre', avatar: media(u.avatar), handle: u.handle || null });
const attachOf = (m) => { try { return m.attach ? JSON.parse(m.attach) : null; } catch { return null; } };

/** Ce qu'on lit d'un message dans la liste, une réponse ou une notification. */
export function preview(m) {
  if (m.deleted_at) return 'Message supprimé';
  const a = attachOf(m);
  const tag = a?.type === 'image' ? '📷 Photo' : a?.type === 'voice' ? '🎤 Vocal' : a?.type === 'sounds' ? `🎵 ${a.title}` : '';
  return [tag, m.body].filter(Boolean).join(' · ').slice(0, 120);
}

/** Le type d'un fichier envoyé, lu sur ses premiers octets : une photo (PNG, JPEG, WebP) ou un vocal. */
export function fileType(head) {
  if (head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return ['image', 'image/png'];
  if (head.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return ['image', 'image/jpeg'];
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return ['image', 'image/webp'];
  if (head.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))) return ['voice', 'audio/webm']; // MediaRecorder de Chrome et Firefox
  const audio = audioType(head);
  return audio ? ['voice', audio] : null;
}

export function mountMessages(app, { requireUser, receiveFile, wrap }) {
  fs.mkdirSync(filesDir, { recursive: true });

  // ——— Le direct : un flux par onglet ouvert sur Messages ———
  const streams = new Map(); // id du membre → Set de res
  const emit = (userId, payload) => { for (const res of streams.get(userId) || []) res.write(`data: ${JSON.stringify(payload)}\n\n`); };
  // Les deux côtés d'une conversation : chacun reçoit l'autre comme « with ».
  const both = (a, b, type) => { emit(a, { type, with: b }); emit(b, { type, with: a }); };

  app.get('/api/me/messages-live', requireUser, (req, res) => {
    const set = streams.get(req.user.id) || new Set();
    if (set.size >= 10) throw new HttpError(429, 'Trop de fenêtres ouvertes sur Messages.');
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.flushHeaders();
    streams.set(req.user.id, set.add(res));
    res.write(': ok\n\n');
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      set.delete(res);
      if (!set.size) streams.delete(req.user.id);
    });
  });

  // ——— Qui, et quel message ———
  const other = (req) => {
    const p = get(`SELECT p.user_id, p.handle, u.name, u.avatar FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE p.handle = ?`,
      String(req.params.handle || '').toLowerCase());
    if (!p) throw new HttpError(404, "Cette page de profil n'existe pas.");
    if (p.user_id === req.user.id) throw new HttpError(400, 'On ne s\'écrit pas à soi-même.');
    return p;
  };
  const message = (req) => {
    const m = get('SELECT * FROM user_messages WHERE id = ? AND (from_id = ? OR to_id = ?)', Number(req.params.id) || 0, req.user.id, req.user.id);
    if (!m) throw new HttpError(404, 'Message introuvable.');
    return m;
  };
  const mineOnly = (req) => {
    const m = message(req);
    if (m.from_id !== req.user.id) throw new HttpError(403, 'Ce message n\'est pas le tien.');
    if (m.deleted_at) throw new HttpError(410, 'Ce message a été supprimé.');
    return m;
  };
  const pairOf = (m, uid) => (m.from_id === uid ? m.to_id : m.from_id);

  // La réponse doit viser un message de la même conversation.
  const replyTo = (raw, a, b) => {
    const id = Number(raw) || 0;
    if (!id) return null;
    const m = get('SELECT id FROM user_messages WHERE id = ? AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))', id, a, b, b, a);
    if (!m) throw new HttpError(400, 'Le message auquel tu réponds est introuvable.');
    return m.id;
  };

  /** Enregistre un message, prévient l'autre (en direct, sinon sur ses appareils) et rend son id. */
  function send(req, p, { body, attach, reply }) {
    const id = run('INSERT INTO user_messages (from_id, to_id, body, created_at, reply_to, attach) VALUES (?, ?, ?, ?, ?, ?)',
      req.user.id, p.user_id, body, now(), reply, attach ? JSON.stringify(attach) : null).lastInsertRowid;
    both(req.user.id, p.user_id, 'message');
    if (!streams.has(p.user_id) && wants(p.user_id, 'message', 'push')) {
      const handle = get('SELECT handle FROM user_profiles WHERE user_id = ?', req.user.id)?.handle;
      push(p.user_id, { title: req.user.name || 'Message', body: preview({ body, attach: attach && JSON.stringify(attach) }),
        url: handle ? `/messages?u=${encodeURIComponent(handle)}` : '/messages' });
    }
    return id;
  }

  // ——— Les conversations ———
  app.get('/api/me/messages', requireUser, (req, res) => {
    const u = req.user.id;
    const rows = all(`SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS other, MAX(created_at) AS at,
        SUM(CASE WHEN to_id = ? AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
      FROM user_messages WHERE from_id = ? OR to_id = ? GROUP BY other ORDER BY at DESC LIMIT 100`, u, u, u, u);
    res.set('Cache-Control', 'no-store').json(rows.map((r) => {
      const who = get('SELECT u.id, u.name, u.avatar, p.handle FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?', r.other);
      const last = get('SELECT * FROM user_messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY created_at DESC, id DESC LIMIT 1', u, r.other, r.other, u);
      return who && { with: person(who), at: r.at, unread: r.unread, last: last ? (last.from_id === u ? 'Toi : ' : '') + preview(last) : '' };
    }).filter(Boolean));
  });

  // La recherche dans tous ses messages (texte et titres partagés).
  app.get('/api/me/messages-search', requireUser, (req, res) => {
    const q = clean(req.query.q, 80);
    if (q.length < 2) throw new HttpError(400, 'Cherche au moins deux lettres.');
    // Sans accents ni majuscules (« ecoute » trouve « Écoute ») : le LIKE de SQLite ne le fait que pour l'ASCII.
    // shortcut: cherche dans les 5 000 derniers messages, en JS ; une table FTS5 s'il en faut plus.
    const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(), needle = fold(q), u = req.user.id;
    const rows = all(`SELECT m.*, CASE WHEN m.from_id = ? THEN m.to_id ELSE m.from_id END AS other FROM user_messages m
      WHERE (m.from_id = ? OR m.to_id = ?) AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 5000`, u, u, u)
      .filter((m) => fold(`${m.body} ${attachOf(m)?.title || ''}`).includes(needle)).slice(0, 50);
    res.set('Cache-Control', 'no-store').json(rows.map((m) => {
      const who = get('SELECT u.id, u.name, u.avatar, p.handle FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?', m.other);
      return who && { id: m.id, with: person(who), mine: m.from_id === u, text: preview(m), at: m.created_at };
    }).filter(Boolean));
  });

  // Une conversation : ses 300 derniers messages, lus en l'ouvrant (l'autre voit « Vu »).
  app.get('/api/me/messages/:handle', requireUser, (req, res) => {
    const p = other(req), u = req.user.id;
    if (run('UPDATE user_messages SET read_at = ? WHERE from_id = ? AND to_id = ? AND read_at IS NULL', now(), p.user_id, u).changes) emit(p.user_id, { type: 'read', with: u });
    const rows = all(`SELECT * FROM user_messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
      ORDER BY created_at DESC, id DESC LIMIT 300`, u, p.user_id, p.user_id, u).reverse();
    const ids = rows.map((m) => m.id);
    const reactions = ids.length ? all(`SELECT * FROM user_message_reactions WHERE message_id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
    const byId = new Map(rows.map((m) => [m.id, m]));
    const quoted = (id) => {
      const q = byId.get(id) || (id && get('SELECT * FROM user_messages WHERE id = ?', id));
      return q ? { id: q.id, mine: q.from_id === u, text: preview(q) } : null;
    };
    res.set('Cache-Control', 'no-store').json({
      with: person({ id: p.user_id, name: p.name, avatar: p.avatar, handle: p.handle }),
      messages: rows.map((m) => {
        const a = m.deleted_at ? null : attachOf(m);
        return {
          id: m.id, mine: m.from_id === u, body: m.deleted_at ? '' : m.body, at: m.created_at, read: !!m.read_at,
          edited: !!m.edited_at, deleted: !!m.deleted_at, canEdit: m.from_id === u && !m.deleted_at && now() - m.created_at < EDIT_WINDOW,
          reply: m.reply_to ? quoted(m.reply_to) : null,
          attach: !a ? null : a.type === 'sounds'
            // Chaque son du CLOUD reçoit une adresse fraîche ; un son retiré du CLOUD n'en a plus.
            ? { type: 'sounds', title: a.title, items: a.items.map((x) => (x.version ? { ...x, ...(versionAudio(x.version) || { url: null }), version: undefined } : x)) }
            : { type: a.type, url: `/api/me/message/${m.id}/file`, duration: a.duration || 0 },
          reactions: REACTIONS.map((emoji) => {
            const r = reactions.filter((x) => x.message_id === m.id && x.emoji === emoji);
            return r.length ? { emoji, count: r.length, mine: r.some((x) => x.user_id === u) } : null;
          }).filter(Boolean),
        };
      }),
    });
  });

  // Écrire : du texte, en réponse ou non, avec des sons du CLOUD (un titre, ou toute une playlist).
  app.post('/api/me/messages/:handle', requireUser, (req, res) => {
    const p = other(req);
    rateLimit(`messages:${req.user.id}`, 300, 3600_000);
    const body = clean(req.body?.body, 2000);
    let attach = null;
    if (req.body?.sounds) {
      const items = Array.isArray(req.body.sounds.items) ? req.body.sounds.items : [];
      if (!items.length || items.length > MAX_SOUNDS) throw new HttpError(400, `Partage de 1 à ${MAX_SOUNDS} sons.`);
      attach = { type: 'sounds', title: clean(req.body.sounds.title, 120).replace(/\s+/g, ' ') || 'Sons', items: items.map(cleanItem) };
    }
    if (!body && !attach) throw new HttpError(400, 'Écris un message.');
    res.status(201).json({ id: send(req, p, { body, attach, reply: replyTo(req.body?.replyTo, req.user.id, p.user_id) }) });
  });

  // Une photo ou un vocal, envoyé tel quel (Content-Type de l'image ou du son) ; ?replyTo= et ?duration= (en s).
  app.post('/api/me/messages/:handle/file', requireUser, wrap(async (req, res) => {
    const p = other(req);
    rateLimit(`messages:${req.user.id}`, 300, 3600_000);
    const reply = replyTo(req.query.replyTo, req.user.id, p.user_id);
    const file = await receiveFile(req, filesDir, MAX_FILE);
    const stored = path.join(filesDir, file.storedAs);
    const head = Buffer.alloc(12);
    const fd = fs.openSync(stored, 'r');
    fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
    const type = fileType(head);
    if (!type) {
      fs.rmSync(stored, { force: true });
      throw new HttpError(400, 'Envoie une photo (PNG, JPEG, WebP) ou un vocal.');
    }
    const attach = { type: type[0], file: file.storedAs, mime: type[1], ...(type[0] === 'voice' ? { duration: Math.max(0, Math.min(3600, Number(req.query.duration) || 0)) } : {}) };
    res.status(201).json({ id: send(req, p, { body: '', attach, reply }) });
  }));

  // La photo ou le vocal d'un message : seulement pour les deux membres de la conversation.
  app.get('/api/me/message/:id/file', requireUser, (req, res, next) => {
    const a = attachOf(message(req));
    if (!a?.file) throw new HttpError(404, 'Pas de fichier dans ce message.');
    res.set({ 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).type(a.mime)
      .sendFile(path.join(filesDir, a.file), (error) => error && next(new HttpError(404, 'Fichier introuvable.')));
  });

  // « En train d'écrire » : dit à l'autre, sans rien enregistrer.
  app.post('/api/me/messages/:handle/typing', requireUser, (req, res) => {
    const p = other(req);
    rateLimit(`messages-typing:${req.user.id}`, 1200, 3600_000);
    emit(p.user_id, { type: 'typing', with: req.user.id });
    res.json({ ok: true });
  });

  // Modifier son message (un quart d'heure après l'envoi), le supprimer pour les deux, ou y réagir.
  app.put('/api/me/message/:id', requireUser, (req, res) => {
    const m = mineOnly(req);
    if (now() - m.created_at > EDIT_WINDOW) throw new HttpError(403, 'Un message se modifie dans le quart d\'heure qui suit son envoi.');
    const body = clean(req.body?.body, 2000);
    if (!body && !m.attach) throw new HttpError(400, 'Écris un message.');
    run('UPDATE user_messages SET body = ?, edited_at = ? WHERE id = ?', body, now(), m.id);
    both(m.from_id, m.to_id, 'update');
    res.json({ ok: true });
  });
  app.delete('/api/me/message/:id', requireUser, (req, res) => {
    const m = mineOnly(req), a = attachOf(m);
    run('UPDATE user_messages SET body = \'\', attach = NULL, deleted_at = ? WHERE id = ?', now(), m.id);
    run('DELETE FROM user_message_reactions WHERE message_id = ?', m.id);
    if (a?.file) fs.rmSync(path.join(filesDir, a.file), { force: true });
    both(m.from_id, m.to_id, 'update');
    res.json({ ok: true });
  });
  app.post('/api/me/message/:id/react', requireUser, (req, res) => {
    const m = message(req), emoji = req.body?.emoji;
    if (m.deleted_at) throw new HttpError(410, 'Ce message a été supprimé.');
    rateLimit(`messages-react:${req.user.id}`, 600, 3600_000);
    const had = get('SELECT emoji FROM user_message_reactions WHERE message_id = ? AND user_id = ?', m.id, req.user.id)?.emoji;
    // Une réaction par personne ; la même une seconde fois la retire.
    if (!emoji || emoji === had) run('DELETE FROM user_message_reactions WHERE message_id = ? AND user_id = ?', m.id, req.user.id);
    else if (REACTIONS.includes(emoji)) run(`INSERT INTO user_message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)
      ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = excluded.emoji`, m.id, req.user.id, emoji);
    else throw new HttpError(400, 'Réaction inconnue.');
    both(req.user.id, pairOf(m, req.user.id), 'update');
    res.json({ ok: true });
  });
}
