/**
 * Mise à jour automatique sur Mac, sans compte Apple Developer.
 *
 * Le mécanisme habituel (Squirrel) refuse une application qui n'est pas signée par Apple. Celle-ci se met donc à
 * jour elle-même : elle lit sur le site le numéro de la dernière version (latest-mac.json), télécharge son .zip,
 * contrôle son empreinte SHA-256 et sa signature locale, puis se remplace à la fermeture (mac-swap.js).
 * Un fichier téléchargé par l'application n'est pas mis en quarantaine par macOS : la nouvelle version s'ouvre
 * sans redemander « clic droit, Ouvrir ».
 *
 * shortcut: la confiance repose sur HTTPS et sur l'empreinte publiée à côté du fichier, comme pour Windows ;
 * à remplacer par la signature d'Apple le jour où l'application est signée et notariée.
 */
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const swapScript = require('./mac-swap');

const run = promisify(execFile);
const MANIFEST = 'https://onirique.store/telechargement/latest-mac.json';
const APP_NAME = 'ONIRIQUE CENTRAL.app';

/** a plus récent que b ? Numéros de la forme 1.2.3. */
function newer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

/**
 * Le dossier de l'application, s'il peut être remplacé : pas quand elle tourne depuis l'image disque (.dmg) ou
 * depuis une copie temporaire de macOS, ni quand son dossier n'est pas ouvert en écriture à ce compte.
 */
function replaceableBundle() {
  const bundle = path.resolve(process.execPath, '../../..');
  if (path.basename(bundle) !== APP_NAME) return null;
  if (bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) return null;
  try {
    fs.accessSync(bundle, fs.constants.W_OK);
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
  } catch {
    return null;
  }
  return bundle;
}

let staged = null; // { version, app, dir } : la nouvelle version, prête à prendre la place de l'ancienne
let swapping = false;

async function check(app, log, onReady) {
  if (staged) return;
  const bundle = replaceableBundle();
  if (!bundle) return log("mise à jour impossible d'ici : glissez l'application dans le dossier Applications");

  const response = await fetch(MANIFEST, { cache: 'no-store' });
  if (!response.ok) throw new Error(`liste des versions introuvable (${response.status})`);
  const latest = await response.json();
  if (!/^\d+(\.\d+){0,2}$/.test(latest.version) || !/^[0-9a-f]{64}$/.test(latest.sha256) || !/^https:\/\/onirique\.store\//.test(latest.url)) {
    throw new Error('liste des versions invalide');
  }
  if (!newer(latest.version, app.getVersion())) return log('à jour');

  log(`version ${latest.version} disponible, téléchargement`);
  const dir = path.join(app.getPath('userData'), 'update');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'update.zip');
  const download = await fetch(latest.url);
  if (!download.ok) throw new Error(`téléchargement refusé (${download.status})`);
  const hash = crypto.createHash('sha256');
  await pipeline(Readable.fromWeb(download.body), async function* (source) {
    for await (const chunk of source) { hash.update(chunk); yield chunk; }
  }, fs.createWriteStream(zip));
  if (hash.digest('hex') !== latest.sha256) throw new Error("le fichier téléchargé n'a pas la bonne empreinte");

  // ditto garde les liens et les droits du paquet, donc sa signature.
  await run('/usr/bin/ditto', ['-x', '-k', zip, dir]);
  fs.rmSync(zip, { force: true });
  const fresh = path.join(dir, APP_NAME);
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', fresh]);
  const { stdout } = await run('/usr/bin/defaults', ['read', path.join(fresh, 'Contents', 'Info'), 'CFBundleShortVersionString']);
  if (stdout.trim() !== latest.version) throw new Error(`le fichier contient la version ${stdout.trim()}, pas la ${latest.version}`);

  staged = { version: latest.version, app: fresh, dir };
  log(`version ${latest.version} téléchargée, installation à la fermeture`);
  onReady(latest.version);
}

/** Lance le remplacement, qui attend que l'application soit fermée. reopen : la rouvrir ensuite. */
function swap(reopen) {
  const bundle = replaceableBundle();
  if (!staged || swapping || !bundle) return false;
  swapping = true;
  spawn('/bin/sh', ['-c', swapScript, 'sh', String(process.pid), bundle, staged.app, staged.dir, reopen ? '1' : '0'],
    { detached: true, stdio: 'ignore' }).unref();
  return true;
}

/** À chaque lancement puis toutes les deux heures ; la version téléchargée s'installe à la fermeture. */
function start(app, log, onReady) {
  const tick = () => check(app, log, onReady).catch((error) => log(`erreur : ${error.message}`));
  tick();
  setInterval(tick, 2 * 3600_000).unref();
  app.on('will-quit', () => swap(false));
}

/** Bouton « Redémarrer » : installe tout de suite et rouvre l'application. */
function installNow(app) {
  if (swap(true)) app.quit();
}

module.exports = { start, installNow, newer };
