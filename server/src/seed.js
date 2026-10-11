// Prépare une base neuve : compte admin, les plugins ONIRIQUE, les formules d'abonnement.
// Peut être relancé sans risque : rien de ce qui existe déjà n'est modifié.
//
//   node src/seed.js [--tuner "chemin/ONIRIQUE TUNER.vst3"] [--based "chemin/ONIRIQUE BASED.vst3"]
//                    [--tuner-image apercu.png] [--based-image logo.png]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { get, run, now } from './db.js';
import { hashPassword } from './auth.js';
import './licensing.js'; // crée la paire de clés de signature au besoin

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

if (config.adminEmail && config.adminPassword) {
  if (get('SELECT id FROM users WHERE email = ?', config.adminEmail)) {
    console.log(`Admin déjà présent : ${config.adminEmail}`);
  } else {
    run(`INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, 'Admin', ?, 'admin', ?)`,
      config.adminEmail, hashPassword(config.adminPassword), now());
    console.log(`Admin créé : ${config.adminEmail} (mot de passe : voir ADMIN_PASSWORD dans .env)`);
  }
} else {
  console.warn('ADMIN_EMAIL / ADMIN_PASSWORD absents de .env : aucun admin créé.');
}

const products = [
  {
    slug: 'tuner', name: 'ONIRIQUE TUNER', accent: '#e23444', price: 4900, version: '1.0.0',
    tagline: 'Correction de hauteur et vocodeur pour la voix.',
    description: [
      "Autotune dans l'esprit des références du genre, avec un vocodeur piloté par la voix elle-même.",
      'LIVE : aucune latence, pour enregistrer avec le retour casque. HQ : correction plus précise pour le mix.',
      'Retune Speed, Flex-Tune, Humanize, Natural Vibrato, Formant et Throat. Sortie MIDI des notes chantées.',
    ].join('\n\n'),
    notes: 'Première version publique.',
  },
  {
    slug: 'based', name: 'ONIRIQUE BASED', accent: '#c4465f', price: 5900, version: '0.1.0',
    tagline: 'Channel strip vocal, 8 modules, ordre libre.',
    description: [
      'Noise Gate, SSL Channel, deux De-Esser, Saturation, 1176, Fairchild 670 et EQ paramétrique dans un seul plugin.',
      "L'ordre de traitement se reconfigure entièrement, sans clic. Oversampling jusqu'à 8X sur la saturation.",
      "9 presets d'usine, zéro allocation dans le thread audio.",
    ].join('\n\n'),
    notes: 'Première version.',
  },
];

function importFile(source, directory, ext = '') {
  const storedAs = crypto.randomBytes(16).toString('hex') + ext;
  const data = fs.readFileSync(source);
  fs.writeFileSync(path.join(directory, storedAs), data);
  return { storedAs, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
}

for (const p of products) {
  let product = get('SELECT * FROM products WHERE slug = ?', p.slug);
  if (!product) {
    const { lastInsertRowid } = run(
      'INSERT INTO products (slug, name, tagline, description, accent, price_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      p.slug, p.name, p.tagline, p.description, p.accent, p.price, now());
    product = get('SELECT * FROM products WHERE id = ?', lastInsertRowid);
    console.log(`Produit créé : ${p.name}`);
  }

  const image = args[`${p.slug}-image`];
  if (image && !product.image) {
    const file = importFile(image, config.mediaDir, path.extname(image).toLowerCase());
    run('UPDATE products SET image = ? WHERE id = ?', file.storedAs, product.id);
    console.log(`  image : ${path.basename(image)}`);
  }

  const binary = args[p.slug];
  if (binary && !get('SELECT id FROM versions WHERE product_id = ? AND version = ?', product.id, p.version)) {
    const file = importFile(binary, config.filesDir);
    run('INSERT INTO versions (product_id, version, notes, filename, stored_as, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      product.id, p.version, p.notes, `${p.name}.vst3`, file.storedAs, file.size, file.sha256, now());
    console.log(`  version ${p.version} : ${path.basename(binary)} (${(file.size / 1048576).toFixed(1)} Mo)`);
  }
}

if (!get('SELECT id FROM plans LIMIT 1')) {
  run(`INSERT INTO plans (name, interval, price_cents) VALUES ('ALL ACCESS — mensuel', 'month', 990), ('ALL ACCESS — annuel', 'year', 8900)`);
  console.log('Formules créées : ALL ACCESS mensuel et annuel.');
}

console.log('Base prête.');
