// Le ménage de media/ : seul ce que plus rien ne cite, et seulement passé le délai. Base jetable : node test/sweep.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-central-sweep-'));
Object.assign(process.env, { DATA_DIR: dataDir, PAYMENTS_MODE: 'demo', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  SMTP_HOST: 'test', MAIL_FROM: 'support@test.local', SITE_URL: 'https://site.test' });

await import('../src/app.js'); // crée les tables
const { run, setSetting } = await import('../src/db.js');
const { config } = await import('../src/config.js');
const { sweepMedia } = await import('../src/sweep.js');

const hex = (c) => c.repeat(32);
const old = Date.now() - 40 * 86400_000;
function file(name, mtime = old) {
  const p = path.join(config.mediaDir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'x');
  fs.utimesSync(p, mtime / 1000, mtime / 1000);
  return p;
}

const avatar = file(`${hex('a')}.png`);           // photo de profil actuelle
const oldAvatar = file(`${hex('b')}.png`);        // ancienne photo, plus citée
const oldThumb = file(`reduites/${hex('b')}-320.webp`);
const thumb = file(`reduites/${hex('a')}-320.webp`);
const fresh = file(`${hex('c')}.jpg`, Date.now()); // pas citée mais récente (mail d'un pack, envoi en cours)
const inSetting = file(`${hex('d')}.webp`);       // citée dans un réglage (JSON)
const foreign = file('logo-maison.png');          // un nom qui n'est pas du serveur

run(`INSERT INTO users (email, password_hash, name, avatar, created_at) VALUES ('a@test.local', 'x', 'A', ?, 0)`, `${hex('a')}.png`);
setSetting('annonce', { image: `/api/media/${hex('d')}.webp` });

const result = sweepMedia();
assert.deepEqual(result, { files: 2, bytes: 2 });
for (const p of [avatar, thumb, fresh, inSetting, foreign]) assert.ok(fs.existsSync(p), 'gardé : ' + path.basename(p));
for (const p of [oldAvatar, oldThumb]) assert.ok(!fs.existsSync(p), 'effacé : ' + path.basename(p));
console.log('sweep : ok');
process.exit(0);
