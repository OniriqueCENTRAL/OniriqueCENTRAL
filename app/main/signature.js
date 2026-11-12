// Les mises à jour sont signées sur le VPS par une clé que seul root lit (deploy/onirique-signer) : une mise à jour
// n'est installée que si sa signature correspond à cette clé publique. Un serveur piraté ne peut donc pas faire installer
// un autre programme, même en changeant l'annonce (latest.yml) et son empreinte.
const crypto = require('node:crypto');
const fs = require('node:fs');

const CLE_PUBLIQUE = 'CLE_PUBLIQUE_A_POSER';

/** null si la signature de la mise à jour est bonne ; sinon la raison du refus (le format attendu par electron-updater). */
async function verifierMaj(produit, info, fichier, cle = CLE_PUBLIQUE) {
  if (!info?.version || typeof info.signature !== 'string') return "mise à jour sans signature : refusée";
  const hash = crypto.createHash('sha256');
  for await (const morceau of fs.createReadStream(fichier)) hash.update(morceau);
  const message = Buffer.from(`${produit}\n${info.version}\n${hash.digest('hex')}`);
  let ok = false;
  try {
    ok = crypto.verify('sha256', message, { key: Buffer.from(cle, 'base64'), format: 'der', type: 'spki', dsaEncoding: 'ieee-p1363' },
      Buffer.from(info.signature, 'base64'));
  } catch { /* clé ou signature illisible : refusée */ }
  return ok ? null : 'signature de la mise à jour invalide : refusée';
}

module.exports = { verifierMaj };
