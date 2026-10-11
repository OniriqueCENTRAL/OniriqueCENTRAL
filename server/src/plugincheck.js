import crypto from 'node:crypto';
import zlib from 'node:zlib';

//==============================================================================
//  Un plugin payant ne se publie que s'il vérifie sa licence. Le module de licence
//  (plugin-license/) embarque la clé publique du serveur : si ses 32 octets ne sont
//  pas dans le binaire, le plugin s'ouvrirait sans licence.
//  Ne dépend ni de la base ni de la configuration : les scripts de deploy/ l'importent aussi.
//==============================================================================

/** Les fichiers d'un .zip, décompressés un par un (répertoire central ; ni zip64 ni chiffrement). */
function* zipEntries(zip) {
  const end = zip.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
  if (end < 0) return;
  let at = zip.readUInt32LE(end + 16);
  for (let left = zip.readUInt16LE(end + 10); left > 0 && zip.readUInt32LE(at) === 0x02014b50; left--) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const local = zip.readUInt32LE(at + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) yield data;
    else if (method === 8) yield zlib.inflateRawSync(data);
    at += 46 + zip.readUInt16LE(at + 28) + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
}

/**
 * true : le fichier embarque la clé publique ; false : il ne l'embarque pas ;
 * null : impossible à dire (installateur .exe, .msi, .pkg), le fichier passe sans contrôle.
 */
export function embedsLicenseKey(data, filename, publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }).subarray(-32);
  if (/\.vst3$/i.test(filename)) return data.includes(key);
  if (!/\.zip$/i.test(filename)) return null;
  try {
    for (const entry of zipEntries(data)) if (entry.includes(key)) return true;
    return false;
  } catch {
    return false; // archive illisible : rien ne prouve que le plugin vérifie sa licence
  }
}

export const MISSING_LICENSE = "Ce plugin est payant mais ne vérifie pas sa licence : le module plugin-license/ n'est pas dans le fichier envoyé (voir plugin-license/README.md).";
