// Rattache à un plugin la démo fabriquée par onirique-probe (demo.json + base.png), directement dans les données du serveur.
// Sert quand la démo n'est pas envoyée par l'application :
//   node attach-demo.mjs <dossier des données> <identifiant du plugin, ex. tuner> <dossier contenant demo.json et base.png>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [dataDir, slug, demoDir] = process.argv.slice(2);
if (!dataDir || !slug || !demoDir) throw new Error('usage : node attach-demo.mjs <données> <plugin> <dossier de la démo>');

const media = path.join(dataDir, 'media');
const db = new DatabaseSync(path.join(dataDir, 'central.db'));
if (!db.prepare(`SELECT 1 FROM pragma_table_info('products') WHERE name = 'demo'`).get()) db.exec('ALTER TABLE products ADD COLUMN demo TEXT');

const product = db.prepare('SELECT * FROM products WHERE slug = ?').get(slug);
if (!product) throw new Error(`plugin inconnu : ${slug}`);
const demo = JSON.parse(fs.readFileSync(path.join(demoDir, 'demo.json'), 'utf8'));
if (demo.format !== 'onirique-demo-v1') throw new Error('demo.json invalide');

const put = (source, ext) => {
  const name = crypto.randomBytes(16).toString('hex') + ext;
  fs.copyFileSync(path.join(demoDir, source), path.join(media, name));
  return name;
};
const demoName = put('demo.json', '.json'), imageName = put('base.png', '.png');
db.prepare('UPDATE products SET demo = ?, image = ? WHERE id = ?').run(demoName, imageName, product.id);
for (const old of [product.demo, product.image]) if (old) fs.rmSync(path.join(media, old), { force: true });
db.close();
console.log(`${product.name} : démo de ${demo.controls.length} boutons et image rattachées.`);
