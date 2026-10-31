// Tier list des membres ONIRIQUE (page tierlist) : on y classe les comptes ONIRIQUE et les photos que les membres ajoutent.
// Les photos sont communes à tous les membres ; chaque membre garde son propre classement.
import { db, get, all, run, now } from './db.js';
import { HttpError, rateLimit } from './auth.js';
import { ONIRIQUE } from './docs.js';

db.exec(`
CREATE TABLE IF NOT EXISTS tier_photos (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tier_lists (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

export const TIERS = ['S', 'A', 'B', 'C', 'D', 'F'];
const ITEM = /^[up]\d{1,10}$/; // u12 : un compte, p3 : une photo

export function mountTierList(app, { requireUser, receiveImage, removeMedia, wrap }) {
  const onirique = (req, _res, next) => (ONIRIQUE.includes(req.user.role) ? next() : next(new HttpError(403, 'La tier list est réservée aux comptes ONIRIQUE.')));
  const inList = ONIRIQUE.map(() => '?').join(',');

  app.get('/api/tierlist', requireUser, onirique, (req, res) => {
    const members = all(`SELECT id, name, avatar FROM users WHERE role IN (${inList}) ORDER BY name`, ...ONIRIQUE)
      .map((u) => ({ id: `u${u.id}`, name: u.name || 'Membre', src: u.avatar ? `/api/media/${u.avatar}` : null }));
    const photos = all('SELECT p.id, p.file, p.user_id, u.name FROM tier_photos p JOIN users u ON u.id = p.user_id ORDER BY p.id')
      .map((p) => ({ id: `p${p.id}`, src: `/api/media/${p.file}`, by: p.name || 'Membre', mine: p.user_id === req.user.id }));
    const saved = get('SELECT data FROM tier_lists WHERE user_id = ?', req.user.id);
    res.set('Cache-Control', 'no-store').json({ tiers: TIERS, members, photos, placement: saved ? JSON.parse(saved.data) : {} });
  });

  // Le classement : { S: ["u3", "p7"], A: [...] }. Ce qui n'y est pas reste dans la réserve.
  app.put('/api/tierlist', requireUser, onirique, (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const placement = {};
    for (const t of TIERS) {
      if (b[t] === undefined) continue;
      if (!Array.isArray(b[t]) || b[t].length > 500 || !b[t].every((x) => typeof x === 'string' && ITEM.test(x))) throw new HttpError(400, 'Classement illisible.');
      placement[t] = [...new Set(b[t])];
    }
    run(`INSERT INTO tier_lists (user_id, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`, req.user.id, JSON.stringify(placement), now());
    res.json({ ok: true });
  });

  // Une photo : PNG, JPEG ou WebP de 4 Mo au plus, en corps brut de la requête.
  app.post('/api/tierlist/photos', requireUser, onirique, wrap(async (req, res) => {
    rateLimit(`tier-photo:${req.user.id}`, 60, 3600_000);
    const file = await receiveImage(req, 4 * 1024 * 1024);
    const id = run('INSERT INTO tier_photos (user_id, file, created_at) VALUES (?, ?, ?)', req.user.id, file, now()).lastInsertRowid;
    res.status(201).json({ id: `p${id}`, src: `/api/media/${file}`, by: req.user.name || 'Membre', mine: true });
  }));

  // Retirer une photo : celui qui l'a ajoutée, ou l'équipe.
  app.delete('/api/tierlist/photos/:id', requireUser, onirique, (req, res) => {
    const p = get('SELECT * FROM tier_photos WHERE id = ?', Number(String(req.params.id).replace(/^p/, '')) || 0);
    if (!p) throw new HttpError(404, 'Photo introuvable.');
    if (p.user_id !== req.user.id && !['admin', 'founder'].includes(req.user.role)) throw new HttpError(403, 'Seul celui qui a ajouté la photo peut la retirer.');
    run('DELETE FROM tier_photos WHERE id = ?', p.id);
    removeMedia(p.file);
    res.json({ ok: true });
  });
}
