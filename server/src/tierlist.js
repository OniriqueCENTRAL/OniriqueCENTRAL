// Tier list (page tierlist) : chaque compte classe ses photos dans ses rangées ; l'équipe ONIRIQUE peut aussi y importer
// ses membres et voit les photos des autres membres de l'équipe. Chacun garde son propre classement.
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
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// Ancien classement { S: [...], labels: { S: "..." } } → { rows: [{ label, items }] }.
function upgrade(old) {
  if (old.rows) return old;
  return {
    rows: TIERS.map((t) => ({ label: old.labels?.[t] || t, items: old[t] || [] })),
    withMembers: TIERS.some((t) => (old[t] || []).some((x) => x[0] === 'u')),
  };
}

export function mountTierList(app, { requireUser, receiveImage, removeMedia, wrap }) {
  const inList = ONIRIQUE.map(() => '?').join(',');

  // Ouverte à tous les comptes. Les membres ONIRIQUE ne sont envoyés qu'à l'équipe ONIRIQUE (bouton « Importer »),
  // et chacun ne voit que ses photos, plus celles de l'équipe s'il en fait partie.
  app.get('/api/tierlist', requireUser, (req, res) => {
    const team = ONIRIQUE.includes(req.user.role);
    const members = team ? all(`SELECT id, name, avatar FROM users WHERE role IN (${inList}) ORDER BY name`, ...ONIRIQUE)
      .map((u) => ({ id: `u${u.id}`, name: u.name || 'Membre', src: u.avatar ? `/api/media/${u.avatar}` : null })) : undefined;
    const photos = all(`SELECT p.id, p.file, p.user_id, u.name FROM tier_photos p JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ? OR (? AND u.role IN (${inList})) ORDER BY p.id`, req.user.id, team ? 1 : 0, ...ONIRIQUE)
      .map((p) => ({ id: `p${p.id}`, src: `/api/media/${p.file}`, by: p.name || 'Membre', mine: p.user_id === req.user.id }));
    const saved = get('SELECT data FROM tier_lists WHERE user_id = ?', req.user.id);
    res.set('Cache-Control', 'no-store').json({ members, photos, placement: upgrade(saved ? JSON.parse(saved.data) : {}) });
  });

  // Le classement : { rows: [{ label: "S", items: ["u3", "p7"] }], captions: { p7: "texte" }, withMembers: true }.
  // Ce qui n'est dans aucune rangée reste dans la réserve.
  app.put('/api/tierlist', requireUser, (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (!Array.isArray(b.rows) || b.rows.length > 30) throw new HttpError(400, 'Classement illisible.');
    const rows = b.rows.map((r) => {
      const items = r && r.items;
      if (!Array.isArray(items) || items.length > 500 || !items.every((x) => typeof x === 'string' && ITEM.test(x))) throw new HttpError(400, 'Classement illisible.');
      return { label: clean(r.label, 60), items: [...new Set(items)] };
    });
    const captions = {};
    if (b.captions && typeof b.captions === 'object') {
      for (const [id, text] of Object.entries(b.captions).slice(0, 2000)) if (ITEM.test(id) && clean(text, 80)) captions[id] = clean(text, 80);
    }
    const placement = { rows, captions, withMembers: b.withMembers === true && ONIRIQUE.includes(req.user.role) };
    run(`INSERT INTO tier_lists (user_id, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`, req.user.id, JSON.stringify(placement), now());
    res.json({ ok: true });
  });

  // Une photo : PNG, JPEG ou WebP de 4 Mo au plus, en corps brut de la requête.
  app.post('/api/tierlist/photos', requireUser, wrap(async (req, res) => {
    rateLimit(`tier-photo:${req.user.id}`, 60, 3600_000);
    const file = await receiveImage(req, 4 * 1024 * 1024);
    const id = run('INSERT INTO tier_photos (user_id, file, created_at) VALUES (?, ?, ?)', req.user.id, file, now()).lastInsertRowid;
    res.status(201).json({ id: `p${id}`, src: `/api/media/${file}`, by: req.user.name || 'Membre', mine: true });
  }));

  // Retirer une photo : celui qui l'a ajoutée, ou l'équipe.
  app.delete('/api/tierlist/photos/:id', requireUser, (req, res) => {
    const p = get('SELECT * FROM tier_photos WHERE id = ?', Number(String(req.params.id).replace(/^p/, '')) || 0);
    if (!p) throw new HttpError(404, 'Photo introuvable.');
    if (p.user_id !== req.user.id && !['admin', 'founder'].includes(req.user.role)) throw new HttpError(403, 'Seul celui qui a ajouté la photo peut la retirer.');
    run('DELETE FROM tier_photos WHERE id = ?', p.id);
    removeMedia(p.file);
    res.json({ ok: true });
  });
}
