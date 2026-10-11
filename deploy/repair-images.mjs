// Répare les images de plugins tronquées par l'ancien onirique-probe (bande noire en bas) : l'image complète
// est reprise dans la démo interactive du plugin. Les images entières ne sont pas touchées.
//   node repair-images.mjs <dossier des données>
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [dataDir] = process.argv.slice(2);
if (!dataDir) throw new Error('usage : node repair-images.mjs <données>');
const media = path.join(dataDir, 'media');
const db = new DatabaseSync(path.join(dataDir, 'central.db'), { readOnly: true });

for (const p of db.prepare(`SELECT name, image, demo FROM products WHERE demo IS NOT NULL AND image LIKE '%.png'`).all()) {
  const file = path.join(media, p.image);
  const complete = fs.existsSync(file) && fs.readFileSync(file).subarray(-8, -4).toString('latin1') === 'IEND';
  if (complete) { console.log(`${p.name} : image entière.`); continue; }
  const base = JSON.parse(fs.readFileSync(path.join(media, p.demo), 'utf8')).base.match(/^data:image\/png;base64,(.+)$/);
  if (!base) { console.log(`${p.name} : image tronquée, mais la démo n'en contient pas de copie.`); continue; }
  fs.writeFileSync(file, Buffer.from(base[1], 'base64'));
  console.log(`${p.name} : image réparée.`);
}
db.close();
