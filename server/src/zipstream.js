// Un .zip écrit au fil de l'envoi, sans compression (de l'audio ne se compresse presque pas) : la somme de contrôle de
// chaque fichier est lue juste avant de l'envoyer, puis le fichier suit son en-tête, et le sommaire ferme l'archive.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { once } from 'node:events';

const LIMIT = 0xFFFFFFFE; // shortcut: pas de ZIP64, une archive de plus de 4 Go est refusée ; à ajouter si les projets grossissent

/** Le nom d'un fichier ou d'un dossier de l'archive, sans caractère que Windows refuse. */
export const zipName = (text) => String(text).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'sans nom';

/** Le poids de l'archive : fichiers, en-têtes et sommaire ; au-delà de 4 Go, elle ne s'écrit pas. */
export function zipSize(entries) {
  return entries.reduce((sum, e) => sum + 76 + 2 * Buffer.byteLength(e.name) + (e.data ? e.data.length : fs.statSync(e.path).size), 22);
}

/** entries = [{ name, path } | { name, data: Buffer }] ; écrit l'archive dans out (une réponse HTTP) au fur et à mesure. */
export async function writeZip(out, entries) {
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
    if (offset + size > LIMIT) throw new Error('Archive de plus de 4 Go.');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(size, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    await write(local); await write(name);
    if (e.data) await write(e.data); else for await (const chunk of fs.createReadStream(e.path)) await write(chunk);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(time, 12); entry.writeUInt16LE(date, 14); entry.writeUInt32LE(crc >>> 0, 16);
    entry.writeUInt32LE(size, 20); entry.writeUInt32LE(size, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + size;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  await write(dir); await write(end);
  out.end();
}
