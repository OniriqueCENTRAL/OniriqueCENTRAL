// Signature des mises à jour : deploy/onirique-signer signe, app/main/signature.js vérifie. node test/signature.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { verifierMaj } = createRequire(import.meta.url)(path.join(racine, 'app/main/signature.js'));
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-signature-'));
const env = { ...process.env, ONIRIQUE_CLE_SIGNATURE: path.join(dossier, 'cle.pem') };
const signer = (...args) => execFileSync(process.execPath, [path.join(racine, 'deploy/onirique-signer'), ...args], { env, encoding: 'utf8' }).trim();

try {
  const cle = signer('--cle-publique');
  assert.equal(signer('--cle-publique'), cle, 'la clé est créée une fois, puis gardée');
  if (process.platform !== 'win32') assert.equal(fs.statSync(env.ONIRIQUE_CLE_SIGNATURE).mode & 0o077, 0, 'lisible par son propriétaire seul');

  const fichier = path.join(dossier, 'Setup.exe');
  fs.writeFileSync(fichier, 'programme');
  const signature = signer('ONIRIQUE CENTRAL', '1.2.3', fichier);

  assert.equal(await verifierMaj('ONIRIQUE CENTRAL', { version: '1.2.3', signature }, fichier, cle), null, 'bonne signature');
  assert.match(await verifierMaj('ONIRIQUE CENTRAL', { version: '1.2.4', signature }, fichier, cle), /invalide/, 'une autre version');
  assert.match(await verifierMaj('ONIRIQUE Navigateur', { version: '1.2.3', signature }, fichier, cle), /invalide/, 'un autre produit');
  assert.match(await verifierMaj('ONIRIQUE CENTRAL', { version: '1.2.3' }, fichier, cle), /sans signature/);
  fs.writeFileSync(fichier, 'programme modifié');
  assert.match(await verifierMaj('ONIRIQUE CENTRAL', { version: '1.2.3', signature }, fichier, cle), /invalide/, 'un fichier changé');
  assert.match(await verifierMaj('ONIRIQUE CENTRAL', { version: '1.2.3', signature }, fichier, 'pas une clé'), /invalide/);
  assert.throws(() => execFileSync(process.execPath, [path.join(racine, 'deploy/onirique-signer'), 'Autre', '1.0.0', fichier], { env, stdio: 'ignore' }));
  console.log('Signature des mises à jour : ok');
} finally {
  fs.rmSync(dossier, { recursive: true, force: true });
}
