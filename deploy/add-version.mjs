// Publie une version d'un plugin directement dans les données du serveur (sans passer par le panel admin) :
//   node add-version.mjs <dossier des données> <identifiant du plugin> <version> <fichier> <nom de fichier publié> [notes] [win|mac]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [dataDir, slug, version, source, filename, notes = '', system = 'win'] = process.argv.slice(2);
const platform = system === 'mac' ? 'mac' : 'win';
if (!filename) throw new Error('usage : node add-version.mjs <données> <plugin> <version> <fichier> <nom publié> [notes]');

const db = new DatabaseSync(path.join(dataDir, 'central.db'));
const product = db.prepare('SELECT * FROM products WHERE slug = ?').get(slug);
if (!product) throw new Error(`plugin inconnu : ${slug}`);
if (db.prepare('SELECT 1 FROM versions WHERE product_id = ? AND version = ? AND platform = ?').get(product.id, version, platform)) {
  throw new Error(`la version ${version} de ${product.name} existe déjà pour ${platform}`);
}

const data = fs.readFileSync(source);
const storedAs = crypto.randomBytes(16).toString('hex');
fs.writeFileSync(path.join(dataDir, 'files', storedAs), data);
db.prepare('INSERT INTO versions (product_id, version, notes, filename, stored_as, size, sha256, created_at, platform) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .run(product.id, version, notes, filename, storedAs, data.length, crypto.createHash('sha256').update(data).digest('hex'), Date.now(), platform);
db.close();
console.log(`${product.name} ${version} publié pour ${platform} (${(data.length / 1048576).toFixed(1)} Mo).`);
