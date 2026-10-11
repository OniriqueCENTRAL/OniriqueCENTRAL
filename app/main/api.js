const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const store = require('./store');

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function send(method, route, init = {}) {
  if (typeof route !== 'string' || !route.startsWith('/api/')) throw new ApiError(400, 'Requête invalide.');
  const token = store.token;
  let response;
  try {
    response = await fetch(store.serverUrl + route, {
      method,
      ...init,
      // Le serveur répond avec les versions des plugins faites pour ce système.
      headers: { 'X-Onirique-Platform': process.platform === 'darwin' ? 'mac' : 'win', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, `Serveur injoignable (${store.serverUrl}).`);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error || `Erreur ${response.status}.`);
  }
  return response;
}

async function request(method, route, body) {
  const response = await send(method, route, body === undefined ? {} : {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

/** Compte les octets qui passent, pour les barres de progression. */
function meter(total, onProgress) {
  let done = 0, last = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      done += chunk.length;
      const t = Date.now();
      if (t - last > 80 || done === total) {
        last = t;
        onProgress(total ? done / total : 0);
      }
      callback(null, chunk);
    },
  });
}

async function upload(method, route, filePath, contentType, onProgress) {
  const { size } = fs.statSync(filePath);
  const body = fs.createReadStream(filePath).pipe(meter(size, onProgress));
  const response = await send(method, route, {
    headers: { 'Content-Type': contentType, 'Content-Length': String(size) },
    body: Readable.toWeb(body),
    duplex: 'half',
  });
  return response.json();
}

/** Télécharge vers un fichier et refuse tout contenu dont l'empreinte ne correspond pas. */
async function download(route, target, expected, onProgress) {
  const response = await send('GET', route);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const hash = crypto.createHash('sha256');
  const hashing = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), meter(expected.size, onProgress), hashing, fs.createWriteStream(target));
    if (hash.digest('hex') !== expected.sha256) throw new ApiError(0, 'Téléchargement corrompu : empreinte incorrecte.');
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw error instanceof ApiError ? error : new ApiError(0, 'Téléchargement interrompu.');
  }
}

module.exports = { ApiError, request, upload, download };
