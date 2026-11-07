// HM (« Hail Mary ») : la séance d'écoute partagée du CLOUD, sur le modèle de Spotify Jam. Le créateur ouvre un HM et en
// partage le lien ; ceux qui le rejoignent (un compte ONIRIQUE suffit) écoutent la même chose au même moment, voient qui
// est là et remplissent la même file. Le créateur règle qui peut ajouter, passer, contrôler la lecture et expulser.
//
// La salle est gardée en base (un redémarrage du serveur ne la perd pas) ; les présents sont les flux ouverts sur
// /api/hm/:code/live (Server-Sent Events, lus par fetch pour porter le jeton). Chaque changement renvoie l'état à tous.
// La lecture est donnée par { pos, playing, at } : la position pos (en s) à l'heure at du serveur ; chacun en déduit
// où il doit être et s'y recale. Le serveur passe lui-même au son suivant à la fin de celui en cours.
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, get, all, run, now } from './db.js';
import { HttpError, rateLimit } from './auth.js';
import { signedVersion, versionAudio } from './sounds.js';
import { lyricsFor } from './platforms.js';
import { push } from './push.js';

db.exec(`
CREATE TABLE IF NOT EXISTS hm_rooms (
  code       TEXT PRIMARY KEY,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

// Qui a chaque droit : tout le monde, les co-hôtes choisis par le créateur, ou le créateur seul.
export const PERMS = ['add', 'skip', 'control', 'kick'];
export const LEVELS = ['all', 'cohosts', 'host'];
const DEFAULT_PERMS = { add: 'all', skip: 'all', control: 'host', kick: 'host' };
const MAX_QUEUE = 200;
const MAX_MEMBERS = 50;
const IDLE_DAYS = 2; // un HM où rien ne s'est passé depuis deux jours se ferme

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const imageUrl = (v) => (typeof v === 'string' && v.length <= 600 && /^(\/api\/media\/|https:\/\/)/.test(v) ? v : null);
const PREVIEW = /^\/api\/(sounds\/platform-items\/\d+\/preview|platforms\/preview)\?[\w%.=&-]+$/;
const qid = () => crypto.randomBytes(6).toString('base64url');

export function newRoom(owner, name = '') {
  return { code: crypto.randomBytes(6).toString('base64url'), owner: owner.id, name: clean(name, 60) || `HM de ${owner.name || 'membre'}`,
    perms: { ...DEFAULT_PERMS }, cohosts: [], kicked: [], queue: [], now: null };
}

export function allowed(room, userId, perm) {
  if (userId === room.owner) return true;
  if (room.kicked.includes(userId)) return false;
  const level = room.perms[perm];
  return level === 'all' || (level === 'cohosts' && room.cohosts.includes(userId));
}
const need = (room, userId, perm) => {
  if (!allowed(room, userId, perm)) throw new HttpError(403, "Le créateur du HM ne t'a pas donné ce droit.");
};

/**
 * Ce que le lecteur doit jouer, vérifié : un son du CLOUD (son adresse signée, qui prouve l'accès de celui qui l'ajoute)
 * ou un titre d'une plateforme (Spotify, Deezer, Apple Music), joué par le compte de chaque auditeur.
 */
export function cleanItem(raw) {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Son illisible.');
  const base = { title: clean(raw.title, 200) || 'Sans titre', feat: clean(raw.feat, 120), artist: clean(raw.artist, 120), subtitle: clean(raw.subtitle, 200),
    cover: imageUrl(raw.cover), duration: Math.max(0, Math.min(36000, Number(raw.duration) || 0)),
    // Les paroles (LRC ou texte) et la forme d'onde que le lecteur de celui qui l'ajoute connaît déjà.
    lyrics: typeof raw.lyrics === 'string' ? raw.lyrics.slice(0, 20000) : '',
    peaks: Array.isArray(raw.peaks) && raw.peaks.length <= 2000 && raw.peaks.every((p) => typeof p === 'number' && p >= 0 && p <= 1)
      ? raw.peaks.map((p) => Math.round(p * 1000) / 1000) : [] };
  // Un titre de plateforme : le moteur (lecteur complet ou lecteur intégré de Spotify) se choisit chez chaque auditeur,
  // selon son compte ; seule la plateforme est gardée.
  if (['spotify', 'spotifyEmbed', 'deezer', 'apple'].includes(raw.engine)) {
    const extId = String(raw.extId || '');
    if (!/^[\w.-]{1,64}$/.test(extId)) throw new HttpError(400, 'Titre de plateforme illisible.');
    // L'extrait (secours, et source de la forme d'onde) : une adresse publique, ou celle, signée, du serveur.
    // shortcut: l'adresse signée expire au bout de 6 h ; un HM plus long perd l'extrait de ses plus vieux sons.
    const url = typeof raw.url === 'string' && raw.url.length <= 1000 && (raw.url.startsWith('https://') || PREVIEW.test(raw.url)) ? raw.url : null;
    return { ...base, engine: raw.engine === 'spotifyEmbed' ? 'spotify' : raw.engine, extId, url };
  }
  // L'extrait d'une plateforme sans lecteur ici (Apple Music non connecté…) : son adresse publique, ou celle, signée, du serveur.
  if (typeof raw.url === 'string' && raw.url.length <= 1000 && (raw.url.startsWith('https://') || PREVIEW.test(raw.url))) return { ...base, url: raw.url };
  // Un son du CLOUD : l'adresse que le lecteur de celui qui l'ajoute a reçue, signée par le serveur ; acceptée jusqu'à
  // 30 jours après son expiration, la page de CLOUD restant ouverte des heures dans l'application.
  const version = signedVersion(raw.url, 30 * 86400_000);
  if (!version) throw new HttpError(400, "Ce son n'est plus disponible : recharge la page.");
  return { ...base, version };
}

const positionOf = (playing, t) => (playing ? playing.pos + (playing.playing ? (t - playing.at) / 1000 : 0) : 0);
const startNext = (room, t) => {
  const next = room.queue.shift();
  room.now = next ? { ...next, pos: 0, playing: true, at: t } : null;
};

/** Une action d'un participant sur la salle (modifiée sur place). Lève une HttpError si elle n'est pas permise. */
export function act(room, user, action, body = {}, t = now()) {
  const uid = user.id, host = uid === room.owner;
  if (room.kicked.includes(uid)) throw new HttpError(403, 'Tu as été retiré de ce HM.');
  const entry = (id) => {
    const i = room.queue.findIndex((x) => x.qid === id);
    if (i < 0) throw new HttpError(404, "Ce son n'est plus dans la file.");
    return i;
  };
  switch (action) {
    case 'add': {
      need(room, uid, 'add');
      if (room.queue.length >= MAX_QUEUE) throw new HttpError(400, 'La file est pleine.');
      const x = { qid: qid(), by: uid, byName: clean(user.name, 60) || 'Membre', item: cleanItem(body.item) };
      if (!room.now) room.now = { ...x, pos: 0, playing: true, at: t };
      else if (body.next) room.queue.unshift(x);
      else room.queue.push(x);
      return x.qid;
    }
    case 'remove': {
      const i = entry(body.qid);
      if (!(room.queue[i].by === uid && allowed(room, uid, 'add'))) need(room, uid, 'skip');
      room.queue.splice(i, 1);
      return;
    }
    case 'move': {
      need(room, uid, 'skip');
      const [x] = room.queue.splice(entry(body.qid), 1);
      room.queue.splice(Math.max(0, Math.min(room.queue.length, Math.trunc(Number(body.to)) || 0)), 0, x);
      return;
    }
    case 'skip':
      need(room, uid, 'skip');
      if (body.qid && room.now?.qid !== body.qid) return; // un autre a déjà passé ce son
      startNext(room, t);
      return;
    case 'ended': {
      // La fin d'un son, signalée par un lecteur : n'importe quel présent, mais seulement à la fin du son en cours.
      const n = room.now;
      if (!n || n.qid !== body.qid) return;
      if (n.item.duration && positionOf(n, t) < n.item.duration - 5) return;
      startNext(room, t);
      return;
    }
    case 'play': case 'pause': case 'seek': {
      need(room, uid, 'control');
      const n = room.now;
      if (!n) return;
      const pos = body.pos === undefined ? positionOf(n, t) : Math.max(0, Math.min(n.item.duration || 36000, Number(body.pos) || 0));
      Object.assign(n, { pos, at: t, playing: action === 'seek' ? n.playing : action === 'play' });
      return;
    }
    case 'perms': {
      if (!host) throw new HttpError(403, 'Seul le créateur du HM règle les droits.');
      for (const p of PERMS) if (LEVELS.includes(body.perms?.[p])) room.perms[p] = body.perms[p];
      if (typeof body.name === 'string' && clean(body.name, 60)) room.name = clean(body.name, 60);
      return;
    }
    case 'cohost': {
      if (!host) throw new HttpError(403, 'Seul le créateur du HM choisit les co-hôtes.');
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
      return;
    }
    default:
      throw new HttpError(404, 'Action inconnue.');
  }
}

/** Les amis d'un compte : ceux qu'il suit et qui le suivent. */
const friendsOf = (uid) => all(`SELECT u.id, u.name, u.avatar, u.role FROM user_follows a
  JOIN user_follows b ON b.follower_id = a.followed_id AND b.followed_id = a.follower_id
  JOIN users u ON u.id = a.followed_id WHERE a.follower_id = ? ORDER BY u.name COLLATE NOCASE LIMIT 500`, uid);

/**
 * Inviter ses amis dans une salle en direct (le HM, la WATCHPARTY) : l'invitation arrive dans l'Activité (Messages), en
 * notification sur ses appareils (notice), et en petit pop-up « Refuser / Rejoindre » (site/assets/invites.js).
 * base : le début des routes ; kind : le genre de la notification ; load(code), room(req), members(r) : ceux de la salle ;
 * eligible(ami) : qui peut la rejoindre (par défaut, tout ami) ; notice(de, salle) : la notification des appareils, ou rien.
 */
export function mountInvites(app, { base, kind, guard, load, room, members, removed, notice, eligible = () => true }) {
  const invitedTo = (code) => new Set(all('SELECT user_id FROM user_notifications WHERE kind = ? AND page = ?', kind, code).map((x) => x.user_id));
  const friends = (uid) => friendsOf(uid).filter(eligible);
  app.get(`${base}/invites`, guard, (req, res) => {
    const rows = all(`SELECT n.id, n.page, n.body, u.name, u.avatar FROM user_notifications n JOIN users u ON u.id = n.actor_id
      WHERE n.user_id = ? AND n.kind = ? AND n.read_at IS NULL AND n.created_at > ? ORDER BY n.id DESC LIMIT 5`, req.user.id, kind, now() - 6 * 3600_000);
    res.set('Cache-Control', 'no-store').json(rows.filter((x) => load(x.page)).map((x) => ({ id: x.id, code: x.page, name: x.body,
      from: { name: x.name || 'Membre', avatar: x.avatar ? `/api/media/${x.avatar}` : null } })));
  });
  app.post(`${base}/invites/:id/seen`, guard, (req, res) => {
    run('UPDATE user_notifications SET read_at = ? WHERE id = ? AND user_id = ? AND kind = ?', now(), Number(req.params.id) || 0, req.user.id, kind);
    res.json({ ok: true });
  });
  app.get(`${base}/:code/friends`, guard, (req, res) => {
    const r = room(req), here = new Set(members(r).map((m) => m.id)), invited = invitedTo(r.code);
    res.set('Cache-Control', 'no-store').json(friends(req.user.id).filter((f) => !r.kicked.includes(f.id)).map((f) => ({ id: f.id, name: f.name || 'Membre',
      avatar: f.avatar ? `/api/media/${f.avatar}` : null, here: here.has(f.id), invited: invited.has(f.id) })));
  });
  app.post(`${base}/:code/invite`, guard, (req, res) => {
    const r = room(req), target = Number(req.body?.userId);
    if (!friends(req.user.id).some((f) => f.id === target)) throw new HttpError(403, "Tu ne peux inviter que tes amis : ceux que tu suis et qui te suivent.");
    if (r.kicked.includes(target)) throw new HttpError(403, removed);
    rateLimit(`${kind}-invite:${req.user.id}`, 60, 3600_000);
    if (!invitedTo(r.code).has(target)) {
      run('INSERT INTO user_notifications (user_id, kind, actor_id, page, body, created_at) VALUES (?, ?, ?, ?, ?, ?)', target, kind, req.user.id, r.code, r.name.slice(0, 140), now());
      if (notice) push(target, notice(req.user, r)); // sans notice : pas de notification sur les appareils
    }
    res.json({ ok: true });
  });
}

export function mountHm(app, { requireUser }) {
  const rooms = new Map();    // code → salle (lue en base une fois)
  const streams = new Map();  // code → Set de { user, res }
  const timers = new Map();   // code → la fin du son en cours

  const load = (code) => {
    if (rooms.has(code)) return rooms.get(code);
    const row = get('SELECT data, updated_at FROM hm_rooms WHERE code = ?', String(code));
    if (!row || row.updated_at < now() - IDLE_DAYS * 86400_000) return null;
    const room = JSON.parse(row.data);
    rooms.set(code, room);
    arm(room);
    return room;
  };
  const room = (req) => {
    const r = load(req.params.code);
    if (!r) throw new HttpError(404, "Ce HM est terminé ou n'existe pas.");
    if (r.kicked.includes(req.user.id)) throw new HttpError(403, 'Tu as été retiré de ce HM.');
    return r;
  };
  const save = (r) => run(`INSERT INTO hm_rooms (code, owner_id, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`, r.code, r.owner, JSON.stringify(r), now());

  // Le serveur passe au son suivant à la fin de celui en cours (durée connue), même si aucun lecteur ne le signale.
  function arm(r) {
    clearTimeout(timers.get(r.code));
    const n = r.now;
    if (!n || !n.playing || !n.item.duration) return;
    const left = (n.item.duration - positionOf(n, now())) * 1000 + 1500;
    timers.set(r.code, setTimeout(() => {
      if (r.now?.qid !== n.qid || rooms.get(r.code) !== r) return;
      startNext(r, now());
      changed(r);
    }, Math.max(0, left)).unref());
  }

  const members = (r) => {
    const seen = new Map();
    for (const s of streams.get(r.code) || []) if (!seen.has(s.user.id)) seen.set(s.user.id, s.user);
    return [...seen.values()].map((u) => ({ id: u.id, name: u.name || 'Membre', avatar: u.avatar ? `/api/media/${u.avatar}` : null,
      host: u.id === r.owner, cohost: r.cohosts.includes(u.id) }))
      .sort((a, b) => b.host - a.host || b.cohost - a.cohost || a.name.localeCompare(b.name));
  };
  const audioOf = (x) => {
    if (!x.item.version) return x.item;
    const a = versionAudio(x.item.version);
    return a ? { ...x.item, ...a, duration: x.item.duration || a.duration } : { ...x.item, url: null };
  };
  const view = (r, user) => {
    const owner = get('SELECT id, name, avatar FROM users WHERE id = ?', r.owner);
    return {
      code: r.code, name: r.name, url: `${config.siteUrl}/mes-sons#/hm/${r.code}`, t: now(),
      owner: { id: r.owner, name: owner?.name || 'Membre', avatar: owner?.avatar ? `/api/media/${owner.avatar}` : null },
      perms: r.perms, cohosts: r.cohosts, members: members(r),
      queue: r.queue.map((x) => ({ qid: x.qid, by: { id: x.by, name: x.byName }, item: audioOf(x) })),
      now: r.now && { qid: r.now.qid, by: { id: r.now.by, name: r.now.byName }, item: audioOf(r.now), pos: r.now.pos, playing: r.now.playing, at: r.now.at },
      you: { id: user.id, host: user.id === r.owner, can: Object.fromEntries(PERMS.map((p) => [p, allowed(r, user.id, p)])) },
    };
  };
  const send = (s, payload) => s.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  // Après chaque changement : enregistrée, renvoyée à tous (chacun avec ses droits), les expulsés coupés.
  function changed(r) {
    arm(r);
    for (const s of streams.get(r.code) || []) {
      if (r.kicked.includes(s.user.id)) { send(s, { kicked: true }); s.res.end(); continue; }
      send(s, view(r, s.user));
    }
    save(r); // après l'envoi : l'écriture en base ne retarde pas les présents
  }

  // L'heure du serveur, pour que chaque lecteur mesure l'écart de son horloge (aller-retour le plus court).
  app.get('/api/hm/clock', (_req, res) => res.set('Cache-Control', 'no-store').json({ t: now() }));

  // Pas de notification sur le téléphone pour le HM (le téléphone l'affichait sous « ONIRIQUE CUT », l'application qui
  // porte les notifications du site) : l'invitation reste dans l'Activité et en pop-up sur CLOUD.
  mountInvites(app, { base: '/api/hm', kind: 'hm', guard: requireUser, load, room, members, removed: 'Cette personne a été retirée du HM.' });

  // Ouvrir un HM : celui que le compte avait déjà se ferme (un seul à la fois, comme sur Spotify).
  app.post('/api/hm', requireUser, (req, res) => {
    rateLimit(`hm-create:${req.user.id}`, 20, 3600_000);
    const old = get('SELECT code FROM hm_rooms WHERE owner_id = ?', req.user.id);
    if (old) end(old.code);
    run('DELETE FROM hm_rooms WHERE updated_at < ?', now() - IDLE_DAYS * 86400_000);
    const r = newRoom(req.user, req.body?.name);
    rooms.set(r.code, r);
    save(r);
    res.status(201).json(view(r, req.user));
  });

  // Mon HM encore ouvert (après un rechargement ou une relance de l'application) : le bouton HM le reprend.
  app.get('/api/hm/mine', requireUser, (req, res) => {
    const row = get('SELECT code FROM hm_rooms WHERE owner_id = ?', req.user.id);
    res.set('Cache-Control', 'no-store').json({ code: row && load(row.code) ? row.code : null });
  });

  app.get('/api/hm/:code', requireUser, (req, res) => res.set('Cache-Control', 'no-store').json(view(room(req), req.user)));

  // Le flux en direct : être connecté à ce flux, c'est être présent dans le HM.
  app.get('/api/hm/:code/live', requireUser, (req, res) => {
    const r = room(req);
    const set = streams.get(r.code) || new Set();
    if (!members(r).some((m) => m.id === req.user.id) && members(r).length >= MAX_MEMBERS) throw new HttpError(403, 'Ce HM est complet.');
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    req.socket.setNoDelay(true); // chaque état part aussitôt, sans attendre d'être groupé avec le suivant
    res.flushHeaders();
    const s = { user: req.user, res };
    streams.set(r.code, set.add(s));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      set.delete(s);
      if (rooms.get(r.code) !== r) return;
      // Le dernier parti : le HM se met en pause là où il en est (la file ne défile pas dans le vide), et repart au retour du premier.
      if (!set.size && r.now?.playing) {
        Object.assign(r.now, { pos: positionOf(r.now, now()), playing: false, at: now() });
        r.idle = true;
        changed(r);
        return;
      }
      for (const o of set) send(o, view(r, o.user));
    });
    if (r.idle) {
      r.idle = false;
      if (r.now) Object.assign(r.now, { playing: true, at: now() });
      changed(r);
    } else for (const o of set) send(o, view(r, o.user)); // le nouveau venu reçoit l'état, les autres le voient arriver
  });

  app.post('/api/hm/:code/:action', requireUser, (req, res) => {
    rateLimit(`hm:${req.user.id}`, 240, 60_000);
    const r = room(req);
    const result = act(r, req.user, req.params.action, req.body && typeof req.body === 'object' ? req.body : {});
    changed(r);
    res.json({ ok: true, qid: result });
    // Un titre Spotify ajouté sans ses paroles : le serveur les cherche (LRCLIB), puis les envoie à tous.
    const x = req.params.action === 'add' && [r.now, ...r.queue].find((e) => e?.qid === result);
    if (x && x.item.engine && !x.item.lyrics) {
      lyricsFor({ platform: x.item.engine, extId: x.item.extId, artist: x.item.artist, title: x.item.title, duration: Math.round(x.item.duration) })
        .then((lyrics) => { if (lyrics && rooms.get(r.code) === r) { x.item.lyrics = lyrics; changed(r); } }, () => {});
    }
  });

  function end(code) {
    clearTimeout(timers.get(code));
    for (const s of streams.get(code) || []) { send(s, { ended: true }); s.res.end(); }
    streams.delete(code);
    rooms.delete(code);
    run('DELETE FROM hm_rooms WHERE code = ?', code);
  }
  // Fermer le HM : son créateur seulement. Les autres le quittent en fermant leur flux.
  app.delete('/api/hm/:code', requireUser, (req, res) => {
    const r = room(req);
    if (r.owner !== req.user.id) throw new HttpError(403, 'Seul le créateur peut fermer le HM.');
    end(r.code);
    res.json({ ok: true });
  });
}
