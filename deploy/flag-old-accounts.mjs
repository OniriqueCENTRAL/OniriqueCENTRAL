// Marque les comptes créés avant la validation des adresses e-mail (mise en ligne le 11 octobre 2026 à 16 h 55 UTC)
// comme « adresse à confirmer » : rien ne leur est fermé, le site leur affiche seulement un rappel.
// Les admins et les comptes qui ont déjà ouvert leur lien ne sont pas touchés. Sans effet si on le relance.
//   node flag-old-accounts.mjs <dossier des données>
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [dataDir] = process.argv.slice(2);
if (!dataDir) throw new Error('usage : node flag-old-accounts.mjs <données>');

const db = new DatabaseSync(path.join(dataDir, 'central.db'));
const { changes } = db.prepare(
  `UPDATE users SET email_verified = 2 WHERE email_verified = 1 AND role != 'admin' AND created_at < ?`).run(Date.UTC(2026, 9, 11, 16, 55, 15));
console.log(`${changes} ancien(s) compte(s) à qui le rappel sera affiché.`);
db.close();
