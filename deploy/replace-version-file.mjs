// Remplace le fichier d'une version déjà publiée (même numéro, nouveau fichier), directement dans les données du serveur :
//   node replace-version-file.mjs <dossier des données> <identifiant du plugin> <version> <win|mac> <nouveau fichier>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const [dataDir, slug, version, platform, source] = process.argv.slice(2);
if (!source) throw new Error('usage : node replace-version-file.mjs <données> <plugin> <version> <win|mac> <fichier>');

const db = new DatabaseSync(path.join(dataDir, 'central.db'));
const row = db.prepare(`SELECT v.*, p.name, p.price_cents FROM versions v JOIN products p ON p.id = v.product_id
                        WHERE p.slug = ? AND v.version = ? AND v.platform = ?`).get(slug, version, platform);
if (!row) throw new Error(`version introuvable : ${slug} ${version} (${platform})`);

const data = fs.readFileSync(source);
// Même contrôle que le panel admin : un plugin payant sans vérification de licence ne se publie pas.
// À lancer depuis le dossier du serveur (server/), où se trouve src/plugincheck.js.
const { embedsLicenseKey, MISSING_LICENSE } = await import(pathToFileURL(path.resolve('src/plugincheck.js')));
const publicKeyPem = fs.readFileSync(path.join(dataDir, 'keys', 'license-public.pem'), 'utf8');
const checkLicense = (product, data, filename) => {
  if (product.price_cents > 0 && embedsLicenseKey(data, filename, publicKeyPem) === false) throw new Error(`${filename} : ${MISSING_LICENSE}`);
};
checkLicense(row, data, row.filename);
fs.writeFileSync(path.join(dataDir, 'files', row.stored_as), data);
db.prepare('UPDATE versions SET size = ?, sha256 = ? WHERE id = ?').run(data.length, crypto.createHash('sha256').update(data).digest('hex'), row.id);
db.close();
console.log(`${row.name} ${version} (${platform}) : fichier remplacé (${(data.length / 1048576).toFixed(1)} Mo).`);
