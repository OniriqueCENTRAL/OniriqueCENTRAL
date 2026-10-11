// Publie une version d'un plugin directement dans les données du serveur (sans passer par le panel admin) :
//   node add-version.mjs <dossier des données> <identifiant du plugin> <version> <fichier> <nom de fichier publié> [notes] [win|mac]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

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
// Même contrôle que le panel admin : un plugin payant sans vérification de licence ne se publie pas.
// À lancer depuis le dossier du serveur (server/), où se trouve src/plugincheck.js.
const { embedsLicenseKey, MISSING_LICENSE } = await import(pathToFileURL(path.resolve('src/plugincheck.js')));
const publicKeyPem = fs.readFileSync(path.join(dataDir, 'keys', 'license-public.pem'), 'utf8');
const checkLicense = (product, data, filename) => {
  if (product.price_cents > 0 && embedsLicenseKey(data, filename, publicKeyPem) === false) throw new Error(`${filename} : ${MISSING_LICENSE}`);
};
checkLicense(product, data, filename);
const storedAs = crypto.randomBytes(16).toString('hex');
fs.writeFileSync(path.join(dataDir, 'files', storedAs), data);
db.prepare('INSERT INTO versions (product_id, version, notes, filename, stored_as, size, sha256, created_at, platform) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .run(product.id, version, notes, filename, storedAs, data.length, crypto.createHash('sha256').update(data).digest('hex'), Date.now(), platform);
db.close();
console.log(`${product.name} ${version} publié pour ${platform} (${(data.length / 1048576).toFixed(1)} Mo).`);
