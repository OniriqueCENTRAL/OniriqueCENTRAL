const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Adresse du serveur ONIRIQUE CENTRAL. Pour développer en local : ONIRIQUE_SERVER=http://localhost:4850
const DEFAULT_SERVER = process.env.ONIRIQUE_SERVER || 'https://central.onirique.store';
// Sur Mac, le dossier VST3 de l'utilisateur : les DAW le lisent, et y écrire ne demande aucun mot de passe.
const DEFAULT_VST3_DIR = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Audio', 'Plug-Ins', 'VST3')
  : path.join(process.env.CommonProgramFiles || 'C:\\Program Files\\Common Files', 'VST3');

const file = () => path.join(app.getPath('userData'), 'config.json');
// Sur Mac, le trousseau lie ce qu'il garde à la signature de l'application. Sans compte Apple Developer, cette
// signature change à chaque version : le trousseau refuserait alors de rendre le jeton, et de garder le suivant
// (connexion impossible). Le jeton y est donc gardé dans le fichier de réglages, lisible par ce seul compte.
const MAC = process.platform === 'darwin';
let cache = null;

function read() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    cache = {};
  }
  cache.installed ??= {};
  return cache;
}

function write() {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cache, null, 2), { mode: 0o600 });
  if (MAC) fs.chmodSync(file(), 0o600); // un fichier d'avant ce changement garde sinon ses anciens droits
}

module.exports = {
  DEFAULT_VST3_DIR,
  get serverUrl() { return read().serverUrl || DEFAULT_SERVER; },
  set serverUrl(url) { read().serverUrl = url; write(); },

  get vst3Dir() { return read().vst3Dir || DEFAULT_VST3_DIR; },
  set vst3Dir(dir) { read().vst3Dir = dir; write(); },

  // Le jeton de session est chiffré par Windows (DPAPI) : illisible depuis un autre compte.
  get token() {
    if (MAC) return read().session || '';
    const stored = read().token;
    if (!stored || !safeStorage.isEncryptionAvailable()) return '';
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      return '';
    }
  },
  set token(token) {
    if (MAC) {
      read().session = token || undefined;
      delete read().token; // l'ancien jeton chiffré par le trousseau ne sert plus
      return write();
    }
    read().token = token && safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(token).toString('base64') : undefined;
    write();
  },

  get installed() { return read().installed; },
  setInstalled(productId, record) {
    if (record) read().installed[productId] = record;
    else delete read().installed[productId];
    write();
  },
};
