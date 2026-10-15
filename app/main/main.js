const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const { autoUpdater } = require('electron-updater');
const macUpdate = require('./mac-update');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = require('./api');
const installer = require('./installer');
const store = require('./store');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    // Sur Mac, les trois boutons du système restent en place, posés sur la barre de titre de l'application.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : { frame: false }),
    backgroundColor: '#0d0809',
    show: false,
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized', false));

  // La fenêtre n'affiche que l'application : aucun lien ne peut la faire naviguer ailleurs.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

/** Les erreurs remontent à l'interface sous forme de données, avec leur message d'origine. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (error) {
      if (!(error instanceof api.ApiError)) console.error(channel, error);
      return { ok: false, error: error.message || 'Erreur inattendue.', status: error.status ?? null };
    }
  });
}

const progress = (id) => (phase, ratio) => win?.webContents.send('progress', { id, phase, ratio });

async function productById(id) {
  const { products } = await api.request('GET', '/api/catalog');
  const product = products.find((p) => p.id === id);
  if (!product) throw new Error('Produit introuvable.');
  return product;
}

async function activateHere(product) {
  const { license } = await api.request('POST', '/api/licenses/activate', {
    productId: product.id, machineId: await installer.machineId(), machineName: os.hostname(),
  });
  installer.writeLicense(product.slug, license);
}

/**
 * Tout ce dont l'interface a besoin, en un appel. Au passage, les fichiers de licence de ce PC
 * sont remis d'accord avec le serveur : renouvelés s'ils sont encore valables, retirés sinon.
 */
async function load() {
  const catalog = await api.request('GET', '/api/catalog');
  const machineId = await installer.machineId();
  let me = null;
  if (store.token) {
    try {
      me = await api.request('GET', '/api/me');
    } catch (error) {
      if (error.status !== 401) throw error;
      store.token = '';
    }
  }
  const installs = await installer.status(catalog.products);
  if (me) {
    let activated = false;
    for (const product of catalog.products) {
      const right = me.entitlements[product.id];
      const here = me.activations.some((a) => a.productId === product.id && a.machineId === machineId);
      // Un plugin offert (VIP, équipe avec « Mes licences » activé) s'active tout seul là où il est installé :
      // personne n'a de clé à saisir ni de bouton à trouver. Un plugin acheté garde son activation à la main.
      const offered = right?.via === 'vip' && !here && installs[product.id].present;
      if (right && (here || offered)) {
        try {
          await activateHere(product);
          activated ||= offered;
        } catch { /* limite de machines atteinte, serveur injoignable : le plugin reste en démo */ }
      } else {
        // Un fichier qui résiste ne doit jamais empêcher l'application de s'ouvrir.
        try { installer.removeLicense(product.slug); } catch (error) { console.error(`Licence ${product.slug} :`, error.message); }
      }
      installs[product.id].licensed = installer.hasLicense(product.slug);
    }
    // Les activations qui viennent d'être faites doivent se voir tout de suite dans l'interface.
    if (activated) me = await api.request('GET', '/api/me');
  }
  return {
    catalog, me, machineId,
    machineName: os.hostname(),
    installs,
    settings: { serverUrl: store.serverUrl, vst3Dir: store.vst3Dir, licenseDir: installer.LICENSE_DIR, appVersion: app.getVersion() },
  };
}

//==============================================================================
//  Fichiers choisis par l'admin : seuls les chemins sortis d'une boîte de dialogue sont acceptés.
//==============================================================================
const pickedFiles = new Set();

async function pickFile(kind) {
  const filters = kind === 'image'
    ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    : [{ name: 'Plugin ou installateur', extensions: ['vst3', 'zip', 'exe', 'msi', 'pkg'] }];
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (result.canceled) return null;
  const filePath = result.filePaths[0];
  pickedFiles.add(filePath);
  return { path: filePath, name: path.basename(filePath), size: fs.statSync(filePath).size };
}

function picked(filePath) {
  if (!pickedFiles.has(filePath)) throw new Error('Fichier non autorisé.');
  return filePath;
}

app.whenReady().then(() => {
  handle('load', load);

  handle('auth:login', async (email, password) => {
    const { token } = await api.request('POST', '/api/auth/login', { email, password });
    store.token = token;
  });
  // ref : le code de parrainage d'un ami ; newsletter : la case « recevoir les nouveautés d'ONIRIQUE ».
  handle('auth:register', async (email, password, name, ref, newsletter) => {
    const { token } = await api.request('POST', '/api/auth/register', { email, password, name, ref, newsletter: newsletter === true });
    store.token = token;
  });
  handle('auth:logout', async () => {
    await api.request('POST', '/api/auth/logout').catch(() => {});
    store.token = '';
  });
  handle('auth:password', async (current, next) => {
    const { token } = await api.request('POST', '/api/me/password', { current, next });
    store.token = token;
  });

  // Passe-plat vers l'API pour tout ce qui n'a pas besoin du disque ni du jeton.
  handle('api', (method, route, body) => {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('Méthode invalide.');
    return api.request(method, route, body);
  });

  // productIds : les plugins choisis pour un abonnement à la carte (kind "pick").
  // promo : le code promo entré au moment de payer (le serveur recalcule le prix).
  handle('checkout', async (kind, id, productIds, promo) => {
    const result = await api.request('POST', '/api/checkout', { kind, id, productIds, promo });
    if (result.url) {
      // Seules les pages de paiement de Stripe et de Lemon Squeezy s'ouvrent d'ici.
      if (!/^https:\/\/(checkout\.stripe\.com|[a-z0-9-]+\.lemonsqueezy\.com)\//.test(result.url)) throw new Error('Adresse de paiement inattendue.');
      await shell.openExternal(result.url);
    }
    return { mode: result.mode };
  });

  handle('plugin:install', async (productId) => {
    const product = await productById(productId);
    const record = await installer.install(product, progress(productId));
    await activateHere(product).catch(() => {});
    return record;
  });
  handle('plugin:uninstall', async (productId) => installer.uninstall(await productById(productId)));
  // « Ouvrir » : le chemin vient de l'état calculé ici, jamais de l'interface.
  handle('plugin:open', async (productId) => {
    const product = await productById(Number(productId));
    const { launch } = (await installer.status([product]))[product.id];
    if (!launch) throw new Error("Ce logiciel est introuvable sur ce PC : réinstallez-le.");
    const problem = await shell.openPath(launch);
    if (problem) throw new Error(`Impossible d'ouvrir ${product.name} : ${problem}`);
  });
  handle('plugin:reveal', (productId) => {
    const record = store.installed[productId];
    if (record?.path && fs.existsSync(record.path)) shell.showItemInFolder(record.path);
    else shell.openPath(store.vst3Dir);
  });
  handle('license:activate', async (productId) => activateHere(await productById(productId)));
  handle('license:deactivate', async (productId, machineId) => {
    const product = await productById(productId);
    const own = await installer.machineId();
    await api.request('POST', '/api/licenses/deactivate', { productId, machineId: machineId || own });
    if (!machineId || machineId === own) installer.removeLicense(product.slug);
  });

  handle('admin:pick', pickFile);

  /**
   * Fabrique la démo interactive d'un plugin à partir de son .vst3 (outil onirique-probe : il charge le plugin,
   * ouvre son interface à l'écran et photographie chaque bouton à chaque position), puis l'envoie au serveur
   * avec l'image de l'interface. Un échec ici n'annule pas la version déjà publiée.
   */
  async function publishDemo(productId, vst3Path, report) {
    const probe = app.isPackaged
      ? path.join(process.resourcesPath, 'onirique-probe.exe')
      : path.join(__dirname, '..', '..', 'tools', 'probe', 'build', 'OniriqueProbe_artefacts', 'Release', 'OniriqueProbe.exe');
    if (!fs.existsSync(probe)) throw new Error("l'outil de démo n'est pas installé avec cette application.");

    // Le plugin est photographié activé : sans licence sur ce PC, sa page « Activation requise » couvre l'interface
    // et se retrouve sur l'image du produit et dans toute la démo.
    const product = await productById(productId);
    if (product.priceCents > 0) {
      await activateHere(product).catch(() => {});
      if (!installer.hasLicense(product.slug)) {
        throw new Error("le plugin n'est pas activé sur ce PC, son aperçu montrerait la page d'activation. Activez-le dans Mes plugins, puis relancez.");
      }
    }

    const out = fs.mkdtempSync(path.join(app.getPath('temp'), 'onirique-demo-'));
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(probe, [vst3Path, out], { windowsHide: false });
        let message = '';
        child.stdout.on('data', (chunk) => {
          for (const line of chunk.toString().split(/\r?\n/)) {
            const step = line.match(/^PROGRESSION (\d+)\/(\d+)/);
            if (step) report('demo', Number(step[1]) / Number(step[2]));
            if (line.startsWith('ERREUR')) message = line.slice(7);
          }
        });
        const timer = setTimeout(() => child.kill(), 15 * 60_000);
        child.on('error', reject);
        child.on('close', (code) => {
          clearTimeout(timer);
          code === 0 ? resolve() : reject(new Error(message || "le plugin n'a pas pu être chargé."));
        });
      });
      await api.upload('PUT', `/api/admin/products/${productId}/image`, path.join(out, 'base.png'), 'image/png', () => {});
      await api.upload('PUT', `/api/admin/products/${productId}/demo`, path.join(out, 'demo.json'), 'application/octet-stream', (ratio) => report('demo-upload', ratio));
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }
  handle('admin:uploadVersion', async ({ productId, version, notes, filePath, platform }) => {
    const file = picked(filePath);
    const report = progress(`upload:${productId}`);
    const query = new URLSearchParams({ version, notes: notes || '', filename: path.basename(file), platform: platform === 'mac' ? 'mac' : 'win' });
    const published = await api.upload('POST', `/api/admin/products/${Number(productId)}/versions?${query}`, file,
      'application/octet-stream', (ratio) => report('upload', ratio));
    let demo = null; // null : pas un .vst3, donc pas de démo
    if (/\.vst3$/i.test(file) && platform !== 'mac') {
      demo = await publishDemo(Number(productId), file, report).then(() => ({ ok: true }), (error) => ({ ok: false, message: error.message }));
    }
    return { ...published, demo };
  });
  handle('admin:refreshDemo', async (productId) => {
    const product = await productById(Number(productId));
    if (!product.latest || !/\.vst3$/i.test(product.latest.filename)) throw new Error("La version en ligne n'est pas un fichier .vst3.");
    const report = progress(`upload:${product.id}`);
    const temp = path.join(app.getPath('temp'), 'onirique-central', `demo-${product.latest.id}.vst3`);
    try {
      await api.download(`/api/download/${product.latest.id}`, temp, product.latest, (ratio) => report('download', ratio));
      await publishDemo(product.id, temp, report);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  });

  handle('open:webmail', () => shell.openExternal('https://mail.ionos.fr'));
  // Le site ONIRIQUE, dans le navigateur : l'accueil ou une de ses pages (jamais une adresse venue d'ailleurs).
  handle('open:site', (page) => {
    const allowed = ['', 'boutique.html', 'compte.html', 'support.html', 'outils.html', 'compte.html#parrainage'];
    return shell.openExternal('https://onirique.store/' + (allowed.includes(page) ? page : ''));
  });
  // Répondre à une demande de support : la messagerie de ce PC s'ouvre sur un message adressé à la personne.
  handle('open:mail', (email, subject) => {
    if (typeof email !== 'string' || !/^[^\s@<>"'?&]+@[^\s@<>"'?&]+\.[^\s@<>"'?&]+$/.test(email)) throw new Error('Adresse e-mail invalide.');
    return shell.openExternal(`mailto:${email}?subject=${encodeURIComponent(`Re: ${String(subject || '').slice(0, 120)}`)}`);
  });

  const imageType = (file) => {
    const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(file).toLowerCase()];
    if (!type) throw new Error('Image attendue : PNG, JPEG ou WebP.');
    return type;
  };
  // L'image choisie est remise à l'interface pour y être cadrée, puis revient rognée (JPEG) pour être envoyée.
  handle('admin:imageData', (filePath) => {
    const file = picked(filePath);
    if (fs.statSync(file).size > 30 * 1024 * 1024) throw new Error('Image trop lourde (30 Mo au plus).');
    return `data:${imageType(file)};base64,${fs.readFileSync(file).toString('base64')}`;
  });
  handle('admin:uploadImageData', async ({ productId, dataUrl }) => {
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
    if (!match) throw new Error('Image invalide.');
    const file = path.join(app.getPath('temp'), `onirique-image-${crypto.randomBytes(6).toString('hex')}.jpg`);
    fs.writeFileSync(file, Buffer.from(match[1], 'base64'));
    try {
      return await api.upload('PUT', `/api/admin/products/${Number(productId)}/image?manual=1`, file, 'image/jpeg', () => {});
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
  handle('admin:uploadImage', ({ productId, filePath }) => {
    const file = picked(filePath);
    return api.upload('PUT', `/api/admin/products/${Number(productId)}/image?manual=1`, file, imageType(file), () => {});
  });

  // Photo de profil : une image choisie sur cet ordinateur. Rien n'est envoyé si la fenêtre de choix est refermée.
  handle('me:avatar', async () => {
    const file = await pickFile('image');
    if (!file) return null;
    return api.upload('PUT', '/api/me/avatar', file.path, imageType(file.path), () => {});
  });

  // Les images du serveur sont remises à l'interface en data: URL (la CSP n'autorise aucune origine distante).
  const media = new Map();
  handle('media', async (route) => {
    if (!/^\/api\/media\/[a-f0-9]{32}\.(png|jpg|webp)$/.test(route)) throw new Error('Image invalide.');
    if (!media.has(route)) {
      const response = await fetch(store.serverUrl + route);
      if (!response.ok) throw new Error('Image introuvable.');
      const type = response.headers.get('content-type') || 'image/png';
      media.set(route, `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`);
    }
    return media.get(route);
  });

  // La démo interactive d'un plugin (gros fichier JSON, images comprises) est gardée en mémoire après le premier affichage.
  const demos = new Map();
  handle('demo', async (route) => {
    if (!/^\/api\/media\/[a-f0-9]{32}\.json$/.test(route)) throw new Error('Démo invalide.');
    if (!demos.has(route)) {
      const response = await fetch(store.serverUrl + route);
      if (!response.ok) throw new Error('Démo introuvable.');
      const demo = await response.json();
      if (demo.format !== 'onirique-demo-v1') throw new Error('Démo illisible.');
      demos.set(route, demo);
    }
    return demos.get(route);
  });

  handle('settings:server', async (url) => {
    const parsed = new URL(String(url).trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("L'adresse doit commencer par http:// ou https://");
    const clean = parsed.origin;
    const response = await fetch(`${clean}/api/health`).catch(() => null);
    if (!response?.ok) throw new Error(`Aucun serveur ONIRIQUE CENTRAL à l'adresse ${clean}.`);
    if (clean !== store.serverUrl) {
      store.serverUrl = clean;
      store.token = '';
      media.clear();
    }
  });
  handle('settings:vst3Dir', async (reset) => {
    if (reset) return void (store.vst3Dir = store.DEFAULT_VST3_DIR);
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: store.vst3Dir });
    if (!result.canceled) store.vst3Dir = result.filePaths[0];
  });

  // Aperçu d'un e-mail du panel admin : sa propre fenêtre, sans script, sans navigation (les liens ne s'ouvrent pas).
  handle('admin:previewMail', (html) => {
    const preview = new BrowserWindow({ width: 720, height: 900, title: 'Aperçu de l\'e-mail', parent: win, autoHideMenuBar: true, backgroundColor: '#0d0809',
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    preview.webContents.on('will-navigate', (event) => event.preventDefault());
    preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    preview.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(String(html).slice(0, 2_000_000)));
  });
  handle('clipboard', (text) => clipboard.writeText(String(text).slice(0, 5000)));

  ipcMain.on('window', (_event, action) => {
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
    else if (action === 'reload') win.webContents.reload(); // changement de langue
  });

  createWindow();
  startAutoUpdate();
});

/**
 * Mise à jour automatique : à chaque lancement (puis toutes les deux heures), l'application regarde sur le site
 * s'il existe une version plus récente, la télécharge en arrière-plan et l'installe à la fermeture.
 * À la réouverture, c'est la nouvelle version. Le journal est dans le dossier de données de l'application (update.log).
 */
let updateReady = null;
function startAutoUpdate() {
  if (!app.isPackaged) return; // en développement, il n'y a rien à mettre à jour
  const logFile = path.join(app.getPath('userData'), 'update.log');
  const log = (text) => fs.appendFile(logFile, `${new Date().toISOString()} ${text}\n`, () => {});
  try { if (fs.statSync(logFile).size > 200_000) fs.rmSync(logFile); } catch { /* pas encore de journal */ }
  const ready = (version) => {
    updateReady = version;
    win?.webContents.send('update:ready', version);
  };
  // Sur Mac, macOS refuse le mécanisme habituel pour une application non signée : elle se met à jour elle-même.
  if (process.platform === 'darwin') {
    log(`vérification (version installée ${app.getVersion()})`);
    return macUpdate.start(app, log, ready);
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => log(`vérification (version installée ${app.getVersion()})`));
  autoUpdater.on('update-available', (info) => log(`version ${info.version} disponible, téléchargement`));
  autoUpdater.on('update-not-available', () => log('à jour'));
  autoUpdater.on('error', (error) => log(`erreur : ${error.message}`));
  autoUpdater.on('update-downloaded', (info) => {
    log(`version ${info.version} téléchargée, installation à la fermeture`);
    ready(info.version);
  });

  const check = () => autoUpdater.checkForUpdates().catch((error) => log(`vérification impossible : ${error.message}`));
  check();
  setInterval(check, 2 * 3600_000).unref();
}

ipcMain.handle('update:state', () => updateReady);
ipcMain.on('update:install', () => {
  if (!updateReady) return;
  if (process.platform === 'darwin') macUpdate.installNow(app);
  else autoUpdater.quitAndInstall(true, true);
});

app.on('window-all-closed', () => app.quit());
