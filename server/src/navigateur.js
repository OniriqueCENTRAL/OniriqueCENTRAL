// ONIRIQUE Navigateur : ses réglages suivent le compte (raccourcis et dossiers de l'accueil, couleur, moteur de recherche),
// pour les retrouver sur chaque PC. Le navigateur envoie tout le profil avec sa date ; le plus récent l'emporte.
import { db, get, run } from './db.js';
import { HttpError, rateLimit } from './auth.js';

db.exec(`CREATE TABLE IF NOT EXISTS navigateur_profils (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  donnees TEXT NOT NULL,
  date INTEGER NOT NULL
)`);

const TAILLE_MAX = 190_000; // sous la limite de 200 ko des requêtes JSON

export function mountNavigateur(app, { requireUser }) {
  app.get('/api/navigateur/profil', requireUser, (req, res) => {
    const ligne = get('SELECT donnees, date FROM navigateur_profils WHERE user_id = ?', req.user.id);
    res.json(ligne ? { donnees: JSON.parse(ligne.donnees), date: ligne.date } : { donnees: null, date: 0 });
  });

  app.put('/api/navigateur/profil', requireUser, (req, res) => {
    rateLimit(`navigateur:${req.user.id}`, 120);
    const { donnees, date } = req.body || {};
    if (!donnees || typeof donnees !== 'object' || Array.isArray(donnees)) throw new HttpError(400, 'Profil illisible.');
    if (!Number.isFinite(date) || date <= 0) throw new HttpError(400, 'Date manquante.');
    const texte = JSON.stringify(donnees);
    if (texte.length > TAILLE_MAX) throw new HttpError(413, 'Profil trop lourd.');
    const actuel = get('SELECT date FROM navigateur_profils WHERE user_id = ?', req.user.id);
    // Un PC resté hors ligne ne doit pas écraser ce qu'un autre a envoyé depuis.
    if (actuel && actuel.date > date) return res.status(409).json({ error: 'Un profil plus récent existe.', date: actuel.date });
    run(`INSERT INTO navigateur_profils (user_id, donnees, date) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET donnees = excluded.donnees, date = excluded.date`, req.user.id, texte, date);
    res.json({ ok: true, date });
  });
}
