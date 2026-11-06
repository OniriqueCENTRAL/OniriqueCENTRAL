// WATCHPARTY : regarder une vidéo ensemble, synchronisée, inspirée de watchparty.me. Réservée pour l'instant aux membres
// ONIRIQUE (vip), aux beta-testeurs, à l'équipe et aux fondateurs (la liste ONIRIQUE de docs.js).
//
// Même mécanique que le HM (hm.js) : la salle est gardée en base, les présents sont les flux ouverts sur
// /api/watchparty/:code/live (Server-Sent Events), chaque changement renvoie l'état à tous, et la lecture est donnée par
// { pos, playing, at } (la position pos à l'heure at du serveur) ; chacun s'y recale. Les droits sont ceux du HM
// (allowed : tout le monde, co-hôtes ou créateur seul).
//
// Ce qu'on regarde : une vidéo YouTube, une vidéo en ligne (adresse https d'un fichier), ou un partage (écran, caméra
// ou fichier de l'ordinateur) envoyé en WebRTC de pair à pair par celui qui partage : le serveur ne relaie que la
// négociation (/signal), jamais l'image.
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, get, run, now } from './db.js';
import { HttpError, rateLimit, requireUser } from './auth.js';
import { allowed } from './hm.js';
import { ONIRIQUE } from './docs.js';

db.exec(`
CREATE TABLE IF NOT EXISTS watchparty_rooms (
  code       TEXT PRIMARY KEY,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

export const PERMS = ['source', 'control', 'kick'];
const LEVELS = ['all', 'cohosts', 'host'];
// Comme sur watchparty.me, tout le monde met en pause et avance ; changer ce qu'on regarde reste au créateur.
const DEFAULT_PERMS = { source: 'host', control: 'all', kick: 'host' };
const MAX_MEMBERS = 30; // un partage d'écran part vers chacun : au-delà, l'envoi de celui qui partage ne suit plus
const MAX_CHAT = 150;
const IDLE_DAYS = 2;

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const code = () => crypto.randomBytes(6).toString('base64url');
export const isMember = (user) => !!user && ONIRIQUE.includes(user.role);

/** L'identifiant d'une vidéo YouTube, depuis son adresse (watch, youtu.be, shorts, embed, live) ou l'identifiant seul. */
export function youtubeId(text) {
  const s = String(text || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(u.hostname)) return null;
  const id = u.hostname.endsWith('youtu.be') ? u.pathname.slice(1) : u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1];
  return /^[\w-]{11}$/.test(id || '') ? id : null;
}

/** Ce qu'on regarde, vérifié : YouTube ou une adresse https. Le partage passe par l'action share. */
export function cleanSource(raw) {
  const text = typeof raw === 'string' ? raw : raw?.url;
  const yt = youtubeId(text);
  if (yt) return { kind: 'youtube', id: yt, title: clean(raw?.title, 200) };
  const url = String(text || '').trim();
  if (url.length <= 2000 && /^https:\/\/[^\s]+$/.test(url)) {
    try { new URL(url); return { kind: 'url', url, title: clean(raw?.title, 200) || decodeURIComponent(url.split('/').pop().split('?')[0]).slice(0, 200) }; } catch { /* plus bas */ }
  }
  throw new HttpError(400, "Colle une adresse YouTube, ou celle d'une vidéo en https (.mp4, .webm…).");
}

export function newRoom(owner, name = '') {
  return { code: code(), owner: owner.id, name: clean(name, 60) || `WATCHPARTY de ${owner.name || 'membre'}`,
    perms: { ...DEFAULT_PERMS }, cohosts: [], kicked: [], media: null, pos: 0, playing: false, at: 0, chat: [] };
}

const need = (room, uid, perm) => {
  if (!allowed(room, uid, perm)) throw new HttpError(403, "Le créateur de la WATCHPARTY ne t'a pas donné ce droit.");
};
export const positionOf = (r, t) => r.pos + (r.playing ? (t - r.at) / 1000 : 0);

/** Une action d'un participant sur la salle (modifiée sur place). `peer` : le flux en direct d'où vient l'action. */
export function act(room, user, action, body = {}, t = now(), peer = null) {
  const uid = user.id, host = uid === room.owner;
  if (room.kicked.includes(uid)) throw new HttpError(403, 'Tu as été retiré de cette WATCHPARTY.');
  switch (action) {
    case 'source':
      need(room, uid, 'source');
      Object.assign(room, { media: { ...cleanSource(body.source), by: uid }, pos: 0, playing: true, at: t });
      return;
    case 'share': {
      // Partager son écran, sa caméra ou un fichier : la vidéo part de son navigateur, depuis ce flux-là.
      need(room, uid, 'source');
      if (!peer) throw new HttpError(400, 'Ouvre la WATCHPARTY avant de partager.');
      room.media = { kind: 'share', by: uid, byName: clean(user.name, 60) || 'Membre', peer, what: ['screen', 'camera', 'file'].includes(body.what) ? body.what : 'screen' };
      Object.assign(room, { pos: 0, playing: true, at: t });
      return;
    }
    case 'unshare':
      if (room.media?.kind !== 'share') return;
      if (room.media.by !== uid) need(room, uid, 'source');
      room.media = null;
      return;
    case 'play': case 'pause': case 'seek': {
      need(room, uid, 'control');
      if (!room.media || room.media.kind === 'share') return;
      const pos = body.pos === undefined ? positionOf(room, t) : Math.max(0, Math.min(7 * 86400, Number(body.pos) || 0));
      Object.assign(room, { pos, at: t, playing: action === 'seek' ? room.playing : action === 'play' });
      return;
    }
    case 'chat': {
      const text = clean(body.text, 500);
      if (!text) throw new HttpError(400, 'Message vide.');
      room.chat.push({ id: code(), by: uid, name: clean(user.name, 60) || 'Membre', text, at: t });
      room.chat.splice(0, room.chat.length - MAX_CHAT);
      return;
    }
    case 'perms':
      if (!host) throw new HttpError(403, 'Seul le créateur règle les droits.');
      for (const p of PERMS) if (LEVELS.includes(body.perms?.[p])) room.perms[p] = body.perms[p];
      if (clean(body.name, 60)) room.name = clean(body.name, 60);
      return;
    case 'cohost': {
      if (!host) throw new HttpError(403, 'Seul le créateur choisit les co-hôtes.');
      const target = Number(body.userId);
      room.cohosts = room.cohosts.filter((x) => x !== target);
      if (body.on && target !== room.owner) room.cohosts.push(target);
      return;
    }
    case 'kick': {
      need(room, uid, 'kick');
      const target = Number(body.userId);
      if (target === room.owner || target === uid) throw new HttpError(400, 'Impossible de retirer cette personne.');
      if (!host && room.cohosts.includes(target)) throw new HttpError(403, 'Seul le créateur peut retirer un co-hôte.');
      if (!room.kicked.includes(target)) room.kicked.push(target);
      room.cohosts = room.cohosts.filter((x) => x !== target);
      if (room.media?.kind === 'share' && room.media.by === target) room.media = null;
      return;
    }
    default:
      throw new HttpError(404, 'Action inconnue.');
  }
}

export function mountWatchparty(app) {
  const rooms = new Map();    // code → salle
  const streams = new Map();  // code → Set de { user, res, peer }
  const member = (req, res, next) => requireUser(req, res, (error) => next(error
    || (isMember(req.user) ? undefined : new HttpError(403, 'La WATCHPARTY est réservée pour l’instant aux membres ONIRIQUE, aux beta-testeurs et à l’équipe.'))));

  const load = (c) => {
    if (rooms.has(c)) return rooms.get(c);
    const row = get('SELECT data, updated_at FROM watchparty_rooms WHERE code = ?', String(c));
    if (!row || row.updated_at < now() - IDLE_DAYS * 86400_000) return null;
    const r = JSON.parse(row.data);
    if (r.media?.kind === 'share') r.media = null; // le partage vivait dans un flux qui n'existe plus
    rooms.set(c, r);
    return r;
  };
  const room = (req) => {
    const r = load(req.params.code);
    if (!r) throw new HttpError(404, "Cette WATCHPARTY est terminée ou n'existe pas.");
    if (r.kicked.includes(req.user.id)) throw new HttpError(403, 'Tu as été retiré de cette WATCHPARTY.');
    return r;
  };
  const save = (r) => run(`INSERT INTO watchparty_rooms (code, owner_id, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`, r.code, r.owner, JSON.stringify(r), now());

  const members = (r) => {
    const seen = new Map();
    for (const s of streams.get(r.code) || []) {
      const m = seen.get(s.user.id) || { id: s.user.id, name: s.user.name || 'Membre', avatar: s.user.avatar ? `/api/media/${s.user.avatar}` : null,
        host: s.user.id === r.owner, cohost: r.cohosts.includes(s.user.id), peers: [] };
      m.peers.push(s.peer);
      seen.set(s.user.id, m);
    }
    return [...seen.values()].sort((a, b) => b.host - a.host || b.cohost - a.cohost || a.name.localeCompare(b.name));
  };
  const view = (r, user, peer) => ({
    code: r.code, name: r.name, url: `${config.siteUrl}/watchparty#${r.code}`, t: now(), owner: r.owner,
    perms: r.perms, cohosts: r.cohosts, members: members(r), media: r.media, pos: r.pos, playing: r.playing, at: r.at, chat: r.chat,
    you: { id: user.id, peer, host: user.id === r.owner, can: Object.fromEntries(PERMS.map((p) => [p, allowed(r, user.id, p)])) },
  });
  const send = (s, payload) => s.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  const broadcast = (r) => {
    for (const s of streams.get(r.code) || []) {
      if (r.kicked.includes(s.user.id)) { send(s, { kicked: true }); s.res.end(); continue; }
      send(s, view(r, s.user, s.peer));
    }
  };
  const changed = (r) => { save(r); broadcast(r); };

  app.post('/api/watchparty', member, (req, res) => {
    rateLimit(`watchparty-create:${req.user.id}`, 20, 3600_000);
    const old = get('SELECT code FROM watchparty_rooms WHERE owner_id = ?', req.user.id);
    if (old) end(old.code);
    run('DELETE FROM watchparty_rooms WHERE updated_at < ?', now() - IDLE_DAYS * 86400_000);
    const r = newRoom(req.user, req.body?.name);
    if (req.body?.source) Object.assign(r, { media: { ...cleanSource(req.body.source), by: req.user.id }, playing: false, at: now() });
    rooms.set(r.code, r);
    save(r);
    res.status(201).json(view(r, req.user, null));
  });

  // La WATCHPARTY ouverte par ce compte, s'il en a une : la page la propose au lieu d'en ouvrir une autre.
  app.get('/api/watchparty/mine', member, (req, res) => {
    const row = get('SELECT code FROM watchparty_rooms WHERE owner_id = ? AND updated_at > ?', req.user.id, now() - IDLE_DAYS * 86400_000);
    res.set('Cache-Control', 'no-store').json({ code: row?.code || null });
  });

  app.get('/api/watchparty/:code', member, (req, res) => res.set('Cache-Control', 'no-store').json(view(room(req), req.user, null)));

  // Le flux en direct : être connecté, c'est être présent. Chaque flux a son identifiant (peer) pour le WebRTC.
  app.get('/api/watchparty/:code/live', member, (req, res) => {
    const r = room(req);
    const set = streams.get(r.code) || new Set();
    if (!members(r).some((m) => m.id === req.user.id) && members(r).length >= MAX_MEMBERS) throw new HttpError(403, 'Cette WATCHPARTY est complète.');
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.flushHeaders();
    const s = { user: req.user, res, peer: code() };
    streams.set(r.code, set.add(s));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      set.delete(s);
      if (rooms.get(r.code) !== r) return;
      if (r.media?.kind === 'share' && r.media.peer === s.peer) { r.media = null; save(r); } // celui qui partageait est parti
      broadcast(r);
    });
    broadcast(r);
  });

  // La négociation WebRTC (offre, réponse, candidats) d'un flux à un autre de la même salle. L'image ne passe pas ici.
  app.post('/api/watchparty/:code/signal', member, (req, res) => {
    rateLimit(`watchparty-signal:${req.user.id}`, 1200, 60_000);
    const r = room(req), set = streams.get(r.code) || new Set();
    const { from, to, data } = req.body || {};
    const mine = [...set].find((s) => s.peer === from && s.user.id === req.user.id);
    const target = [...set].find((s) => s.peer === to);
    if (!mine) throw new HttpError(403, "Ce flux n'est pas le tien.");
    if (!target) throw new HttpError(404, "Cette personne n'est plus là.");
    if (!data || typeof data !== 'object' || JSON.stringify(data).length > 20000) throw new HttpError(400, 'Signal illisible.');
    send(target, { signal: { from, data } });
    res.json({ ok: true });
  });

  app.post('/api/watchparty/:code/:action', member, (req, res) => {
    rateLimit(`watchparty:${req.user.id}`, 240, 60_000);
    const r = room(req), body = req.body && typeof req.body === 'object' ? req.body : {};
    const peer = [...(streams.get(r.code) || [])].find((s) => s.peer === body.peer && s.user.id === req.user.id)?.peer || null;
    act(r, req.user, req.params.action, body, now(), peer);
    changed(r);
    res.json({ ok: true });
  });

  function end(c) {
    for (const s of streams.get(c) || []) { send(s, { ended: true }); s.res.end(); }
    streams.delete(c);
    rooms.delete(c);
    run('DELETE FROM watchparty_rooms WHERE code = ?', c);
  }
  app.delete('/api/watchparty/:code', member, (req, res) => {
    const r = room(req);
    if (r.owner !== req.user.id) throw new HttpError(403, 'Seul le créateur peut fermer la WATCHPARTY.');
    end(r.code);
    res.json({ ok: true });
  });
}
