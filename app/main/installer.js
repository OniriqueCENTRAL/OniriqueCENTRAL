const { app } = require('electron');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = require('./api');
const store = require('./store');

const MAC = process.platform === 'darwin';
// Dossier commun à tous les comptes de la machine, lisible par les plugins dans n'importe quel DAW.
const LICENSE_DIR = MAC
  ? '/Users/Shared/Onirique/Licenses'
  : path.join(process.env.ProgramData || 'C:\\ProgramData', 'Onirique', 'Licenses');
// Où vont les applications autonomes (un .exe qui est le logiciel lui-même, pas un installateur) : dossier de l'utilisateur, sans droits admin.
const APPS_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Onirique');

// Sur Mac, le dossier des Audio Units de l'utilisateur (Logic Pro, GarageBand).
const AU_DIR = path.join(os.homedir(), 'Library', 'Audio', 'Plug-Ins', 'Components');

const exec = (command, args) => new Promise((resolve, reject) => {
  execFile(command, args, { windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
});

/** Littéral PowerShell entre apostrophes : rien n'y est interprété. */
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

function safeName(filename) {
  const name = path.basename(String(filename || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  if (!name || name.startsWith('.')) throw new Error('Nom de fichier invalide.');
  return name;
}

//==============================================================================
//  Machine
//==============================================================================
let machineIdCache = null;

/** Empreinte stable de cette machine : SHA-256 de "onirique:" + MachineGuid de Windows (IOPlatformUUID sur Mac), 40 premiers caractères. */
async function machineId() {
  if (machineIdCache) return machineIdCache;
  let guid;
  try {
    if (MAC) {
      guid = (await exec('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])).match(/"IOPlatformUUID"\s*=\s*"([0-9a-fA-F-]+)"/)?.[1];
    } else {
      const out = await exec('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']);
      guid = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/)?.[1];
    }
  } catch { /* repli ci-dessous */ }
  guid ||= `${os.hostname()}:${os.userInfo().username}`;
  machineIdCache = crypto.createHash('sha256').update(`onirique:${guid.toLowerCase()}`).digest('hex').slice(0, 40);
  return machineIdCache;
}

//==============================================================================
//  Fichiers de licence, lus par les plugins
//==============================================================================
const licensePath = (slug) => {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Identifiant de produit invalide.');
  return path.join(LICENSE_DIR, `${slug}.lic`);
};

function writeLicense(slug, license) {
  fs.mkdirSync(LICENSE_DIR, { recursive: true });
  fs.writeFileSync(licensePath(slug), JSON.stringify(license));
}

const removeLicense = (slug) => fs.rmSync(licensePath(slug), { force: true });
const hasLicense = (slug) => fs.existsSync(licensePath(slug));

//==============================================================================
//  Installation
//==============================================================================
/** Lance un script PowerShell, avec demande d'élévation (UAC) si nécessaire. */
async function powershell(script, elevated) {
  if (!elevated) return exec('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  const file = path.join(app.getPath('temp'), `onirique-central-${crypto.randomBytes(6).toString('hex')}.ps1`);
  fs.writeFileSync(file, `\ufeff$ErrorActionPreference = 'Stop'\ntry { ${script} } catch { exit 1 }\n`);
  try {
    await exec('powershell', ['-NoProfile', '-Command',
      `$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList ` +
      `@('-NoProfile','-ExecutionPolicy','Bypass','-File',${quote(`"${file}"`)}); exit $p.ExitCode`]);
  } catch {
    throw new Error("L'opération demande les droits administrateur et n'a pas abouti.");
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const needsElevation = (error) => ['EPERM', 'EACCES'].includes(error.code);
const busy = (error) => error.code === 'EBUSY';
const BUSY_MESSAGE = 'Le fichier est en cours d\'utilisation : fermez votre DAW ou l\'application, puis réessayez.';

async function place(source, destination) {
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.copyFileSync(source, destination);
  } catch (error) {
    if (busy(error)) throw new Error(BUSY_MESSAGE);
    if (MAC || !needsElevation(error)) throw error;
    await powershell(
      `New-Item -ItemType Directory -Force -Path ${quote(path.dirname(destination))} | Out-Null; ` +
      `if (Test-Path -LiteralPath ${quote(destination)}) { Remove-Item -LiteralPath ${quote(destination)} -Recurse -Force }; ` +
      `Copy-Item -LiteralPath ${quote(source)} -Destination ${quote(destination)} -Force`, true);
  }
  if (!fs.existsSync(destination)) throw new Error("Le fichier n'a pas pu être copié.");
}

async function unzip(source, directory) {
  if (MAC) {
    fs.mkdirSync(directory, { recursive: true });
    return exec('ditto', ['-x', '-k', source, directory]); // garde les droits et les liens d'un plugin Mac
  }
  const script = `New-Item -ItemType Directory -Force -Path ${quote(directory)} | Out-Null; ` +
    `Expand-Archive -LiteralPath ${quote(source)} -DestinationPath ${quote(directory)} -Force`;
  try {
    await powershell(`$ErrorActionPreference = 'Stop'; ${script}`, false);
  } catch {
    await powershell(script, true);
  }
}

/**
 * Le .zip d'un plugin Mac peut porter, à côté du .vst3, sa version Audio Unit (« NOM.component ») : elle est
 * déplacée dans le dossier des Audio Units. Renvoie les chemins, pour pouvoir les retirer à la désinstallation.
 */
async function moveAudioUnits(directory) {
  const moved = [];
  for (const entry of fs.readdirSync(directory)) {
    if (!/\.component$/i.test(entry)) continue;
    const target = path.join(AU_DIR, entry);
    fs.mkdirSync(AU_DIR, { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
    await exec('ditto', [path.join(directory, entry), target]);
    fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
    moved.push(target);
  }
  // macOS relit alors la liste des Audio Units, sans attendre la prochaine ouverture de session.
  if (moved.length) await exec('killall', ['-9', 'AudioComponentRegistrar']).catch(() => {});
  return moved;
}

async function runSetup(source) {
  const start = /\.msi$/i.test(source)
    ? `Start-Process msiexec -ArgumentList @('/i', ${quote(`"${source}"`)}) -Wait -PassThru`
    : `Start-Process -FilePath ${quote(source)} -Wait -PassThru`;
  try {
    await powershell(`$ErrorActionPreference = 'Stop'; $p = ${start}; exit $p.ExitCode`, false);
  } catch {
    throw new Error("L'installateur a été annulé ou a échoué.");
  }
}

/** Vrai si ce .exe est un installateur (NSIS, Inno Setup, InstallShield, WiX, Squirrel), faux si c'est l'application elle-même. */
function isSetup(file) {
  const data = fs.readFileSync(file);
  return ['Nullsoft', 'Inno Setup', 'InstallShield', 'WixBurn', 'Squirrel'].some((mark) => data.includes(mark));
}

async function install(product, onProgress) {
  const version = product.latest;
  if (!version) throw new Error('Aucune version disponible pour ce plugin.');
  const name = safeName(version.filename);
  const temp = path.join(app.getPath('temp'), 'onirique-central', `${version.id}-${name}`);

  await api.download(`/api/download/${version.id}`, temp, version, (ratio) => onProgress('download', ratio));
  onProgress('install', 1);

  const ext = path.extname(name).toLowerCase();
  const record = { version: version.version, versionId: version.id, installedAt: Date.now(), path: null };
  try {
    if (ext === '.vst3') {
      record.path = path.join(store.vst3Dir, name);
      await place(temp, record.path);
    } else if (ext === '.zip') {
      await unzip(temp, store.vst3Dir);
      // « NOM.vst3.zip » contient « NOM.vst3 » (un dossier, sur Mac) : il pourra être retrouvé et désinstallé.
      const inside = path.join(store.vst3Dir, name.slice(0, -4));
      if (/\.vst3\.zip$/i.test(name) && fs.existsSync(inside)) Object.assign(record, { path: inside, kind: 'vst3' });
      if (MAC) record.extra = await moveAudioUnits(store.vst3Dir);
    } else if (ext === '.pkg' && MAC) {
      record.kind = 'setup';
      await exec('open', ['-W', temp]).catch(() => { throw new Error("L'installateur a été annulé ou a échoué."); });
    } else if (ext === '.exe' && !isSetup(temp)) {
      // Application autonome : elle est rangée dans le dossier des applications Onirique, d'où elle se lance.
      record.path = path.join(APPS_DIR, name);
      record.kind = 'app';
      await place(temp, record.path);
    } else if (ext === '.exe' || ext === '.msi') {
      record.kind = 'setup';
      await runSetup(temp);
    } else {
      throw new Error(`Type de fichier non pris en charge : ${ext}`);
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
  store.setInstalled(product.id, record);
  return record;
}

async function uninstall(product) {
  const record = store.installed[product.id];
  if (record && !record.path) throw new Error('Ce logiciel a son propre désinstallateur : retirez-le depuis « Applications installées » de Windows.');
  if (record?.path && fs.existsSync(record.path)) {
    try {
      fs.rmSync(record.path, { recursive: true, force: true });
    } catch (error) {
      if (busy(error)) throw new Error(BUSY_MESSAGE);
      if (MAC || !needsElevation(error)) throw error;
      await powershell(`Remove-Item -LiteralPath ${quote(record.path)} -Recurse -Force`, true);
    }
    if (fs.existsSync(record.path)) throw new Error("Le plugin n'a pas pu être supprimé.");
  }
  for (const extra of record?.extra ?? []) fs.rmSync(extra, { recursive: true, force: true }); // la version Audio Unit
  store.setInstalled(product.id, null);
}

/** Version inscrite dans un fichier .exe (celle que Windows affiche dans ses propriétés), ou null. */
async function fileVersion(file) {
  try {
    // Sur Mac, la version d'un plugin (un dossier) est dans son Info.plist.
    if (MAC) return (await exec('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(file, 'Contents', 'Info.plist')])).trim() || null;
    const out = await exec('powershell', ['-NoProfile', '-Command', `(Get-Item -LiteralPath ${quote(file)}).VersionInfo.ProductVersion`]);
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** Les programmes installés d'après Windows (ceux de « Applications installées ») : nom, version, exécutable. */
async function installedPrograms() {
  const keys = ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'].map(quote).join(',');
  try {
    const out = await exec('powershell', ['-NoProfile', '-Command',
      `[Console]::OutputEncoding = [Text.Encoding]::UTF8; @(Get-ItemProperty ${keys} -ErrorAction SilentlyContinue | Where-Object DisplayName | `
      + 'Select-Object DisplayName, DisplayVersion, InstallLocation, DisplayIcon) | ConvertTo-Json -Compress']);
    return [].concat(JSON.parse(out || '[]')).map((entry) => {
      const icon = String(entry.DisplayIcon || '').replace(/,-?\d+$/, '').replace(/^"|"$/g, '');
      return { name: String(entry.DisplayName), version: entry.DisplayVersion ? String(entry.DisplayVersion) : null,
        dir: entry.InstallLocation ? String(entry.InstallLocation).replace(/^"|"$/g, '') : '', icon };
    });
  } catch {
    return [];
  }
}

const sameName = (a, b) => a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Retrouve un programme installé par son installateur, où qu'il ait été mis : nom du produit, avec ou sans numéro de version. */
function findProgram(programs, product) {
  const hit = programs.find((p) => sameName(p.name, product.name) || sameName(p.name.replace(/\s+v?\d[\d.]*$/, ''), product.name));
  if (!hit) return null;
  const candidates = [/\.exe$/i.test(hit.icon) && !/unins/i.test(hit.icon) ? hit.icon : null,
    hit.dir && path.join(hit.dir, `${product.name}.exe`), hit.dir && product.latest && path.join(hit.dir, path.basename(product.latest.filename))];
  return { version: hit.version, exe: candidates.find((c) => c && fs.existsSync(c)) || null };
}

/** État d'installation de chaque produit sur ce PC, y compris ce qui a été installé sans passer par l'application. */
async function status(products) {
  const out = {};
  let programs = null; // la liste de Windows n'est lue que si un produit en a besoin
  for (const product of products) {
    let record = store.installed[product.id];
    if (record?.path && !fs.existsSync(record.path)) {
      store.setInstalled(product.id, null);
      record = null;
    }
    // Un plugin envoyé en « NOM.vst3.zip » est installé sous le nom « NOM.vst3 ».
    const file = product.latest ? path.basename(product.latest.filename).replace(/\.vst3\.zip$/i, '.vst3') : '';
    const ext = path.extname(file).toLowerCase();
    let version = record?.version ?? null, location = record?.path ?? null, present = !!record;

    if (!record && ext === '.vst3' && fs.existsSync(path.join(store.vst3Dir, file))) {
      // Plugin déjà dans le dossier VST3 (posé à la main, ou installé avant ONIRIQUE CENTRAL) : il est repris tel quel,
      // avec la version inscrite dans son fichier, pour pouvoir être mis à jour ou désinstallé d'ici.
      location = path.join(store.vst3Dir, file);
      const inner = path.join(location, 'Contents', 'x86_64-win', file); // un .vst3 peut être un dossier
      version = (await fileVersion(!MAC && fs.existsSync(inner) ? inner : location)) || '0.0.0';
      present = true;
      store.setInstalled(product.id, { version, versionId: null, installedAt: Date.now(), path: location, kind: 'vst3' });
    } else if (!record && ext === '.exe' && fs.existsSync(path.join(APPS_DIR, file))) {
      // Application déjà dans le dossier Onirique (ONIRIQUE CENTRAL réinstallé, par exemple) : elle est reprise telle quelle.
      location = path.join(APPS_DIR, file);
      version = await fileVersion(location);
      present = true;
      if (version) store.setInstalled(product.id, { version, versionId: null, installedAt: Date.now(), path: location, kind: 'app' });
    } else if (!location && (ext === '.exe' || ext === '.msi')) {
      // Passé par un installateur : Windows sait où il a été mis.
      programs ??= await installedPrograms();
      const program = findProgram(programs, product);
      if (program) {
        present = true;
        version ??= program.version;
        location = program.exe;
      } else if (record) {
        // Désinstallé depuis Windows, ou ancien enregistrement d'un .exe qui n'avait été que lancé une fois.
        store.setInstalled(product.id, null);
        present = false;
        version = null;
      }
    }

    out[product.id] = {
      version, present,
      path: location,
      launch: location && /\.exe$/i.test(location) ? location : null, // ce que le bouton « Ouvrir » lance
      removable: !!(record?.path || (location && (location.startsWith(APPS_DIR) || ext === '.vst3'))),
      licensed: hasLicense(product.slug),
    };
  }
  return out;
}

module.exports = { machineId, writeLicense, removeLicense, hasLicense, install, uninstall, status, LICENSE_DIR };
