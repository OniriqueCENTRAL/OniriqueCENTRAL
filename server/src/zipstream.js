// Un .zip écrit au fil de l'envoi, sans compression (de l'audio ne se compresse presque pas) : la somme de contrôle de
// chaque fichier est lue juste avant de l'envoyer, puis le fichier suit son en-tête, et le sommaire ferme l'archive.
// Au-delà de 4 Go, l'archive passe en ZIP64 (tailles et positions sur 8 octets) ; en dessous, elle ne change pas.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { once } from 'node:events';

const MAX32 = 0xFFFFFFFE;

/** Le nom d'un fichier ou d'un dossier de l'archive, sans caractère que Windows refuse. */
export const zipName = (text) => String(text).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'sans nom';

/** Le poids de l'archive (fichiers, en-têtes et sommaire) quand elle tient sous 4 Go, donc sans ZIP64. */
export function zipSize(entries) {
  return entries.reduce((sum, e) => sum + 76 + 2 * Buffer.byteLength(e.name) + (e.data ? e.data.length : fs.statSync(e.path).size), 22);
}

/** entries = [{ name, path } | { name, data: Buffer }] ; écrit l'archive dans out (une réponse HTTP) au fur et à mesure.
 *  big : la position au-delà de laquelle le ZIP64 commence (les tests le baissent pour l'essayer sans 4 Go de données). */
export async function writeZip(out, entries, big = MAX32) {
  const write = async (chunk) => { if (!out.write(chunk)) await once(out, 'drain'); };
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    let crc = 0, size = 0;
    if (e.data) { crc = zlib.crc32(e.data); size = e.data.length; } else {
      for await (const chunk of fs.createReadStream(e.path)) { crc = zlib.crc32(chunk, crc); size += chunk.length; }
    }
    const z = offset + size > big, version = z ? 45 : 20, small = (n) => (z ? 0xFFFFFFFF : n);
    // ZIP64 : les vraies tailles (et, au sommaire, la position) dans un champ « extra » 0x0001.
    const extra = (fields) => {
      const b = Buffer.alloc(4 + 8 * fields.length);
      b.writeUInt16LE(1, 0); b.writeUInt16LE(8 * fields.length, 2);
      fields.forEach((n, i) => b.writeBigUInt64LE(BigInt(n), 4 + 8 * i));
      return b;
    };
    const localExtra = z ? extra([size, size]) : Buffer.alloc(0), centralExtra = z ? extra([size, size, offset]) : Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(version, 4); local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(small(size), 18); local.writeUInt32LE(small(size), 22); local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    await write(local); await write(name); if (z) await write(localExtra);
    if (e.data) await write(e.data); else for await (const chunk of fs.createReadStream(e.path)) await write(chunk);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(version, 4); entry.writeUInt16LE(version, 6); entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(time, 12); entry.writeUInt16LE(date, 14); entry.writeUInt32LE(crc >>> 0, 16);
    entry.writeUInt32LE(small(size), 20); entry.writeUInt32LE(small(size), 24); entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(centralExtra.length, 30); entry.writeUInt32LE(small(offset), 42);
    central.push(entry, name, centralExtra);
    offset += 30 + name.length + localExtra.length + size;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22), z64 = offset > big;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(z64 ? 0xFFFFFFFF : offset, 16);
  await write(dir);
  if (z64) {
    // Fin de sommaire ZIP64, puis le repère qui permet de la retrouver depuis la fin classique.
    const record = Buffer.alloc(56), locator = Buffer.alloc(20);
    record.writeUInt32LE(0x06064b50, 0); record.writeBigUInt64LE(44n, 4); record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(entries.length), 24); record.writeBigUInt64LE(BigInt(entries.length), 32);
    record.writeBigUInt64LE(BigInt(dir.length), 40); record.writeBigUInt64LE(BigInt(offset), 48);
    locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(offset + dir.length), 8); locator.writeUInt32LE(1, 16);
    await write(record); await write(locator);
  }
  await write(end);
  out.end();
}
