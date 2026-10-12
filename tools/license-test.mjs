// Vérifie le module de licence des plugins (plugin-license/) contre des fichiers signés comme le fait le serveur.
//   node tools/license-test.mjs <chemin de OniriqueLicenseTest(.exe)>
// OniriqueLicenseTest se construit dans le dépôt d'ONIRIQUE TUNER (cible CMake du même nom).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tool = process.argv[2];
if (!tool) throw new Error('usage : node tools/license-test.mjs <OniriqueLicenseTest>');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-license-'));
const pair = crypto.generateKeyPairSync('ed25519');
const other = crypto.generateKeyPairSync('ed25519');
const rawKey = (key) => key.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');

// Même enveloppe que signLicense() dans server/src/licensing.js.
const sign = (payload, key = pair.privateKey) => {
  const body = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8');
  return { format: 'onirique-license-v1', payload: body.toString('base64'), signature: crypto.sign(null, body, key).toString('base64') };
};

const NOW = 1_800_000_000_000;
const MACHINE = 'a'.repeat(40);
const base = { product: 'tuner', email: 'client@exemple.fr', machine: MACHINE, type: 'perpetual', licenseId: 7, issuedAt: NOW - 1000, expiresAt: null };

let count = 0;
function check(name, contents, expected, email) {
  const file = path.join(dir, `cas-${++count}.lic`);
  fs.writeFileSync(file, typeof contents === 'string' || Buffer.isBuffer(contents) ? contents : JSON.stringify(contents));
  const out = execFileSync(tool, ['verify', file, 'tuner', MACHINE, rawKey(pair.publicKey), String(NOW)], { encoding: 'utf8' }).trim();
  assert.ok(out.startsWith(`${expected} `), `${name} : attendu ${expected}, obtenu « ${out} »`);
  if (email !== undefined) assert.ok(out.includes(`email=${email} `), `${name} : e-mail attendu ${email}, obtenu « ${out} »`);
  console.log(`  ok    ${name}`);
}

try {
  check('licence perpétuelle', sign(base), 'licensed', 'client@exemple.fr');
  check('abonnement en cours', sign({ ...base, type: 'subscription', expiresAt: NOW + 86400_000 }), 'licensed');
  check('essai en cours', sign({ ...base, type: 'trial', expiresAt: NOW + 86400_000 }), 'trial');
  check('essai terminé', sign({ ...base, type: 'trial', expiresAt: NOW - 1 }), 'unlicensed');
  check('licence expirée à l\'instant', sign({ ...base, expiresAt: NOW }), 'unlicensed');
  check('autre machine', sign({ ...base, machine: 'b'.repeat(40) }), 'unlicensed');
  check('autre plugin', sign({ ...base, product: 'based' }), 'unlicensed');
  check('signée par une autre clé', sign(base, other.privateKey), 'unlicensed');

  const forged = sign({ ...base, type: 'trial', expiresAt: NOW + 86400_000 });
  forged.payload = Buffer.from(JSON.stringify(base), 'utf8').toString('base64');
  check('contenu modifié après signature', forged, 'unlicensed');

  const cut = sign(base);
  cut.signature = cut.signature.slice(0, -8);
  check('signature tronquée', cut, 'unlicensed');

  // Une adresse e-mail est choisie par le client : elle ne doit pas pouvoir se faire passer pour un autre champ.
  const sly = 'x","type":"perpetual","expiresAt":null,"z":"@exemple.fr';
  check('e-mail piégé, essai terminé', sign({ ...base, email: sly, type: 'trial', expiresAt: NOW - 1 }), 'unlicensed');
  check('e-mail piégé, essai en cours', sign({ ...base, email: sly, type: 'trial', expiresAt: NOW + 5000 }), 'trial');
  check('e-mail accentué', sign({ ...base, email: 'rené.müller@exemple.fr' }), 'licensed', 'rené.müller@exemple.fr');

  const { expiresAt, ...noExpiry } = base;
  check('expiration absente', sign(noExpiry), 'unlicensed');
  check('expiration qui n\'est pas un nombre', sign({ ...base, expiresAt: 'jamais' }), 'unlicensed');
  check('contenu imbriqué', sign({ ...base, extra: { a: 1 } }), 'unlicensed');
  check('contenu signé qui n\'est pas du JSON', sign('licence'), 'unlicensed');
  check('fichier vide', '', 'unlicensed');
  check('fichier quelconque', 'ceci n\'est pas une licence', 'unlicensed');
  check('fichier trop gros', JSON.stringify({ ...sign(base), bourrage: 'x'.repeat(20000) }), 'unlicensed');
  check('autre format', { ...sign(base), format: 'onirique-license-v0' }, 'unlicensed');

  // L'empreinte de la machine doit être celle que calcule l'application ONIRIQUE CENTRAL (app/main/installer.js).
  if (process.platform === 'win32') {
    const reg = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], { encoding: 'utf8' });
    const guid = reg.match(/MachineGuid\s+REG_SZ\s+(\S+)/)[1].trim().toLowerCase();
    const expected = crypto.createHash('sha256').update(`onirique:${guid}`).digest('hex').slice(0, 40);
    assert.equal(execFileSync(tool, ['machine'], { encoding: 'utf8' }).trim(), expected);
    console.log('  ok    empreinte de la machine identique à celle d\'ONIRIQUE CENTRAL');
  }

  assert.match(execFileSync(tool, ['noise'], { encoding: 'utf8' }), /conforme/);
  console.log('  ok    calendrier du bruit du mode démo');
  console.log(`\n${count + (process.platform === 'win32' ? 2 : 1)} contrôles réussis.`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
