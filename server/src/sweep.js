// Le ménage de media/ : une image, une démo ou une version réduite qu'aucune ligne de la base ne cite plus (une ancienne
// pochette, la démo d'un plugin retiré, un reste d'une version précédente du serveur) est effacée. Une image citée
// ailleurs que dans la base n'existe pas : tout ce que le serveur range dans media/ porte un nom tiré au hasard
// (32 caractères hexadécimaux) et ce nom est écrit dans la base. Les fichiers récents sont laissés : une image peut
// encore figurer dans un mail déjà envoyé (mail d'un pack) ou être en cours d'envoi.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { all } from './db.js';

export const SWEEP_GRACE_DAYS = 30;

/** Les noms de fichiers (32 caractères hexadécimaux) cités par n'importe quelle valeur texte de la base. */
function citedNames() {
  const cited = new Set();
  for (const { name } of all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")) {
    for (const row of all(`SELECT * FROM "${name}"`)) {
      for (const value of Object.values(row)) if (typeof value === 'string') for (const m of value.matchAll(/[a-f0-9]{32}/g)) cited.add(m[0]);
    }
  }
  return cited;
}

/** Efface les fichiers de media/ (et media/reduites/) que plus rien ne cite depuis graceDays jours. → { files, bytes } */
export function sweepMedia({ graceDays = SWEEP_GRACE_DAYS, at = Date.now() } = {}) {
  const cited = citedNames(), limit = at - graceDays * 86400_000;
  let files = 0, bytes = 0;
  for (const dir of [config.mediaDir, path.join(config.mediaDir, 'reduites')]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), hex = /^([a-f0-9]{32})/.exec(name)?.[1];
      if (!hex || cited.has(hex)) continue; // un nom qui n'est pas du serveur n'est jamais touché
      const st = fs.statSync(file);
      if (!st.isFile() || st.mtimeMs > limit) continue;
      fs.rmSync(file, { force: true });
      files++; bytes += st.size;
    }
  }
  return { files, bytes };
}
