// Les notifications d'ONIRIQUE CLOUD : sur le téléphone ou l'ordinateur (Web Push, Android et iPhone depuis l'icône
// de l'écran d'accueil) et par e-mail, chaque membre choisissant lesquelles il reçoit.
import webpush from 'web-push';
import { config } from './config.js';
import { db, get, all, run, now, setting, setSetting } from './db.js';
import { HttpError } from './auth.js';

db.exec(`
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notify_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs   TEXT NOT NULL
);
`);

// Ce qui peut prévenir (écoute, téléchargement, commentaire, ajout à son ONIRIQUE CLOUD), et par défaut : tout, l'e-mail n'étant envoyé que si l'on sait qui c'est (un téléchargement ne le dit pas).
const DEFAULTS = {
  mail: { play: true, comment: true, save: true },
  push: { play: true, download: true, comment: true, save: true },
  // Et comment s'ouvrent les nouveaux liens d'écoute.
  links: { download: false, requireAccount: false },
};

export function prefsOf(userId) {
  const saved = JSON.parse(get('SELECT prefs FROM notify_prefs WHERE user_id = ?', userId)?.prefs || '{}');
  return Object.fromEntries(Object.entries(DEFAULTS).map(([channel, d]) => [channel, { ...d, ...saved[channel] }]));
}
export const wants = (userId, event, channel) => prefsOf(userId)[channel][event] === true;

// Les clés VAPID : créées une fois, gardées en base comme la clé des adresses audio.
function vapid() {
  let keys = setting('vapid_keys', null);
  if (!keys) { keys = JSON.stringify(webpush.generateVAPIDKeys()); setSetting('vapid_keys', keys); }
  return JSON.parse(keys);
}

// Envoie à tous les appareils du membre ; un abonnement que le navigateur a retiré (404, 410) est oublié.
export function push(userId, { title, body, url }) {
  const { publicKey, privateKey } = vapid();
  const options = { TTL: 86400, vapidDetails: { subject: config.siteUrl, publicKey, privateKey } };
  const payload = JSON.stringify({ title, body, url });
  for (const s of all('SELECT * FROM push_subscriptions WHERE user_id = ?', userId)) {
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options).catch((error) => {
      if (error.statusCode === 404 || error.statusCode === 410) run('DELETE FROM push_subscriptions WHERE endpoint = ?', s.endpoint);
      else console.error('Notification :', error.statusCode || error.message);
    });
  }
}

const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function mountPush(app, { requireUser }) {
  app.get('/api/push/key', (_req, res) => res.json({ key: vapid().publicKey }));

  app.post('/api/me/push', requireUser, (req, res) => {
    const endpoint = str(req.body?.endpoint, 1000), p256dh = str(req.body?.keys?.p256dh, 200), auth = str(req.body?.keys?.auth, 100);
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) throw new HttpError(400, 'Abonnement invalide.');
    if (get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', req.user.id).n >= 20) {
      run('DELETE FROM push_subscriptions WHERE endpoint = (SELECT endpoint FROM push_subscriptions WHERE user_id = ? ORDER BY created_at LIMIT 1)', req.user.id);
    }
    run(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`, endpoint, req.user.id, p256dh, auth, now());
    res.status(201).json({ ok: true });
  });
  app.delete('/api/me/push', requireUser, (req, res) => {
    run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', str(req.body?.endpoint, 1000), req.user.id);
    res.json({ ok: true });
  });
  // Une notification d'essai, pour vérifier que l'appareil la reçoit.
  app.post('/api/me/push/test', requireUser, (req, res) => {
    push(req.user.id, { title: 'ONIRIQUE CLOUD', body: 'Les notifications sont activées sur cet appareil.', url: '/mes-sons' });
    res.json({ ok: true });
  });

  app.get('/api/me/notifications', requireUser, (req, res) => res.json(prefsOf(req.user.id)));
  app.put('/api/me/notifications', requireUser, (req, res) => {
    const current = prefsOf(req.user.id);
    for (const channel of Object.keys(current)) {
      for (const key of Object.keys(current[channel])) if (typeof req.body?.[channel]?.[key] === 'boolean') current[channel][key] = req.body[channel][key];
    }
    run('INSERT INTO notify_prefs (user_id, prefs) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET prefs = excluded.prefs', req.user.id, JSON.stringify(current));
    res.json(current);
  });
}
