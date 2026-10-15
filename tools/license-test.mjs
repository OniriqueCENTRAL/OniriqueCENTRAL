// Vérifie le module de licence des plugins (plugin-license/) contre des fichiers signés comme le fait le serveur.
//   node tools/license-test.mjs <chemin de OniriqueLicenseTest(.exe)>
// L'outil se construit depuis plugin-license/test (cmake -S plugin-license/test -B <dossier> ; cible license-check).
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
const LEGACY = 'c'.repeat(40);
const DEADLINE = 1_801_440_000_000; // 31 janvier 2027 : fin des anciennes licences sans bail
const base = { product: 'tuner', email: 'client@exemple.fr', machine: MACHINE, type: 'perpetual', licenseId: 7, issuedAt: NOW - 1000, expiresAt: null };

let count = 0;
function check(name, contents, expected, email, { now = NOW, renewal } = {}) {
  const file = path.join(dir, `cas-${++count}.lic`);
  fs.writeFileSync(file, typeof contents === 'string' || Buffer.isBuffer(contents) ? contents : JSON.stringify(contents));
  const out = execFileSync(tool, ['verify', file, 'tuner', MACHINE, LEGACY, rawKey(pair.publicKey), String(now)], { encoding: 'utf8' }).trim();
  if (renewal !== undefined) assert.ok(out.includes(`renewal=${renewal ? 1 : 0}`), `${name} : renouvellement attendu ${renewal}, obtenu « ${out} »`);
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

  // Le bail : renouvelé par ONIRIQUE CENTRAL ; passé, la licence (authentique) demande à être renouvelée.
  const NEW = DEADLINE - 1000; // avant la date limite des anciennes licences, pour isoler chaque règle
  const leased = { ...base, issuedAt: NEW - 1000, leaseUntil: NEW + 86400_000 };
  check('bail en cours', sign(leased), 'licensed', undefined, { now: NEW, renewal: false });
  check('bail passé : à renouveler', sign({ ...leased, leaseUntil: NEW - 1 }), 'unlicensed', undefined, { now: NEW, renewal: true });
  check('bail passé, essai : à renouveler', sign({ ...leased, type: 'trial', expiresAt: NEW + 5 * 86400_000, leaseUntil: NEW - 1 }), 'unlicensed', undefined, { now: NEW, renewal: true });
  // L'heure ne recule pas avant la signature : une horloge remise en arrière ne rend pas un bail passé.
  check('horloge remise avant la signature', sign({ ...leased, issuedAt: NEW, leaseUntil: NEW - 1 }), 'unlicensed', undefined, { now: NEW - 30 * 86400_000, renewal: true });
  // L'ancienne empreinte : acceptée pour un ancien fichier (sans bail), jusqu'au 31 janvier 2027 seulement.
  check('ancienne empreinte, ancien fichier', sign({ ...base, machine: LEGACY, issuedAt: NEW - 1000 }), 'licensed', undefined, { now: NEW });
  check('ancienne empreinte, après la date limite', sign({ ...base, machine: LEGACY, issuedAt: NEW - 1000 }), 'unlicensed', undefined, { now: DEADLINE + 1000 });
  check('ancienne empreinte avec un bail (Central d’avant)', sign({ ...leased, machine: LEGACY }), 'licensed', undefined, { now: NEW });
  // Un fichier d'aujourd'hui : l'ancienne empreinte pour les anciens plugins, la nouvelle (machine2) pour ceux-ci.
  check('deux empreintes, la bonne nouvelle', sign({ ...leased, machine: LEGACY, machine2: MACHINE }), 'licensed', undefined, { now: NEW });
  check("deux empreintes, nouvelle d'une autre machine", sign({ ...leased, machine: LEGACY, machine2: 'd'.repeat(40) }), 'unlicensed', undefined, { now: NEW });
  check('deux empreintes, ancienne usurpée seulement', sign({ ...base, issuedAt: NEW - 1000, machine: LEGACY, machine2: 'd'.repeat(40) }), 'unlicensed', undefined, { now: NEW });
  check('nouvelle empreinte avec bail, après la date limite', sign({ ...leased, issuedAt: DEADLINE, leaseUntil: DEADLINE + 86400_000 }), 'licensed', undefined, { now: DEADLINE + 1000 });

  // Les deux empreintes de la machine doivent être celles que calcule l'application ONIRIQUE CENTRAL (app/main/installer.js).
  if (process.platform === 'win32') {
    const reg = (key, name) => execFileSync('reg', ['query', key, '/v', name, '/reg:64'], { encoding: 'utf8' }).match(new RegExp(`${name}\\s+REG_SZ\\s+(\\S+)`))[1];
    const tidy = (t) => String(t || '').trim().replace(/^\{+|\}+$/g, '').trim().toLowerCase();
    const guid = tidy(reg('HKLM\\SOFTWARE\\Microsoft\\Cryptography', 'MachineGuid'));
    const board = tidy(reg('HKLM\\SYSTEM\\HardwareConfig', 'LastConfig'));
    const serial = execFileSync('cmd', ['/d', '/c', 'vol', (process.env.SystemRoot || 'C:').slice(0, 2)], { encoding: 'utf8' }).match(/([0-9A-F]{4})-([0-9A-F]{4})/i);
    const v2 = crypto.createHash('sha256').update(`onirique2:${guid}|${board}|${(serial[1] + serial[2]).toLowerCase()}`).digest('hex').slice(0, 40);
    const v1 = crypto.createHash('sha256').update(`onirique:${guid}`).digest('hex').slice(0, 40);
    assert.equal(execFileSync(tool, ['machine'], { encoding: 'utf8' }).trim(), `${v2} ${v1}`);
    console.log("  ok    empreintes de la machine identiques à celles d'ONIRIQUE CENTRAL");
  }
  console.log(`\n${count + (process.platform === 'win32' ? 1 : 0)} contrôles réussis.`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
