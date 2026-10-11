const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Adresse du serveur ONIRIQUE CENTRAL. Pour développer en local : ONIRIQUE_SERVER=http://localhost:4850
const DEFAULT_SERVER = process.env.ONIRIQUE_SERVER || 'https://central.onirique.store';
const DEFAULT_VST3_DIR = path.join(process.env.CommonProgramFiles || 'C:\\Program Files\\Common Files', 'VST3');

const file = () => path.join(app.getPath('userData'), 'config.json');
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
  fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
}

module.exports = {
  DEFAULT_VST3_DIR,
  get serverUrl() { return read().serverUrl || DEFAULT_SERVER; },
  set serverUrl(url) { read().serverUrl = url; write(); },

  get vst3Dir() { return read().vst3Dir || DEFAULT_VST3_DIR; },
  set vst3Dir(dir) { read().vst3Dir = dir; write(); },

  // Le jeton de session est chiffré par Windows (DPAPI) : illisible depuis un autre compte.
  get token() {
    const stored = read().token;
    if (!stored || !safeStorage.isEncryptionAvailable()) return '';
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      return '';
    }
  },
  set token(token) {
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
