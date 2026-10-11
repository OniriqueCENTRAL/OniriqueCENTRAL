// Publie une version d'un plugin livrée par GitHub Actions (voir onirique-publish) :
//   node publish-plugin.mjs <dossier des données> <identifiant du plugin> <dossier reçu>
// Le dossier reçu contient win/<fichier> et/ou mac/<fichier>.zip, et éventuellement notes.txt.
// Le numéro est attribué ici : la plus haute version déjà publiée du plugin (tous systèmes confondus),
// patch + 1. Windows et Mac reçoivent le même numéro, dans une seule transaction.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const [dataDir, slug, incoming] = process.argv.slice(2);
if (!incoming) throw new Error('usage : node publish-plugin.mjs <données> <plugin> <dossier reçu>');

const db = new DatabaseSync(path.join(dataDir, 'central.db'));
const product = db.prepare('SELECT * FROM products WHERE slug = ?').get(slug);
if (!product) throw new Error(`plugin inconnu : ${slug}`);

// Même contrôle que le panel admin : un plugin payant sans vérification de licence ne se publie pas.
// À lancer depuis le dossier du serveur (server/), où se trouve src/plugincheck.js.
const { embedsLicenseKey, MISSING_LICENSE } = await import(pathToFileURL(path.resolve('src/plugincheck.js')));
const publicKeyPem = fs.readFileSync(path.join(dataDir, 'keys', 'license-public.pem'), 'utf8');
const checkLicense = (product, data, filename) => {
  if (product.price_cents > 0 && embedsLicenseKey(data, filename, publicKeyPem) === false) throw new Error(`${filename} : ${MISSING_LICENSE}`);
};

const accepted = { win: /\.(vst3|zip|exe|msi)$/i, mac: /\.(zip|pkg)$/i };
const files = [];
for (const platform of ['win', 'mac']) {
  const dir = path.join(incoming, platform);
  if (!fs.existsSync(dir)) continue;
  const names = fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile());
  if (names.length !== 1) throw new Error(`${platform} : un seul fichier attendu, ${names.length} reçu(s)`);
  if (!accepted[platform].test(names[0])) throw new Error(`${platform} : type de fichier refusé (${names[0]})`);
  files.push({ platform, filename: names[0], source: path.join(dir, names[0]) });
}
if (!files.length) throw new Error('aucun fichier reçu');
for (const f of files) checkLicense(product, fs.readFileSync(f.source), f.filename);

const parse = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
const newer = (a, b) => { for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); return false; };
let top = [1, 0, -1];
for (const { version } of db.prepare('SELECT version FROM versions WHERE product_id = ?').all(product.id)) {
  const v = parse(version);
  if (newer(v, top)) top = v;
}
const version = `${top[0]}.${top[1] ?? 0}.${(top[2] ?? 0) + 1}`;

const notesFile = path.join(incoming, 'notes.txt');
const notes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8').trim().slice(0, 4000) : '';

const insert = db.prepare('INSERT INTO versions (product_id, version, notes, filename, stored_as, size, sha256, created_at, platform) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
const written = [];
db.exec('BEGIN');
try {
  for (const f of files) {
    const data = fs.readFileSync(f.source);
    const storedAs = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(dataDir, 'files', storedAs), data);
    written.push(path.join(dataDir, 'files', storedAs));
    insert.run(product.id, version, notes, f.filename, storedAs, data.length, crypto.createHash('sha256').update(data).digest('hex'), Date.now(), f.platform);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  for (const file of written) fs.rmSync(file, { force: true });
  throw error;
}
db.close();
console.log(`${product.name} ${version} publié : ${files.map((f) => `${f.platform === 'mac' ? 'Mac' : 'Windows'} (${f.filename})`).join(', ')}.`);
