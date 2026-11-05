const { app, BrowserWindow, WebContentsView, clipboard, components, dialog, ipcMain, session, shell } = require('electron');
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

/** CUT et CLOUD : une vue chacun, créée à la première ouverture, gardée tant que le compte ne change pas. */
const toolViews = new Map();
let shownTool = null, frozen = false; // frozen : une fenêtre de l'application (Paramètres…) est ouverte par-dessus
const toolContents = new Set(); // les pages de CUT et CLOUD, seules à pouvoir ouvrir la fenêtre de confirmation // l'outil à l'écran, pour le bouton « précédent » de la souris
// ONIRIQUE_SITE : un site local, pour essayer CUT et CLOUD avant de les mettre en ligne (comme ONIRIQUE_SERVER pour l'API).
const SITE = (process.env.ONIRIQUE_SITE || 'https://onirique.store').replace(/\/+$/, '');
const TOOL_PAGES = { cut: 'cut.html', cloud: 'mes-sons.html' };
// Les pages du site qui ont leur propre écran dans l'application.
const APP_ROUTES = { compte: 'account', boutique: 'plugins', cut: 'cut', 'mes-sons': 'cloud' };
const TOOL_SKIN = fs.readFileSync(path.join(__dirname, 'tool-skin.css'), 'utf8');
// Les connexions aux plateformes (Spotify, Apple Music, et les comptes Google, Apple ou Facebook qu'elles proposent)
// restent dans l'application : la vue y passe, ou une petite fenêtre s'ouvre (MusicKit), puis on revient au CLOUD.
const AUTH_HOSTS = /^(accounts\.spotify\.com|challenge\.spotify\.com|[a-z0-9-]+\.apple\.com|accounts\.google\.com|(www|m)\.facebook\.com)$/;
const isAuth = (url) => { try { const u = new URL(url); return u.protocol === 'https:' && AUTH_HOSTS.test(u.hostname); } catch { return false; } };
const pageOf = (url) => new URL(url).pathname.replace(/^\/+/, '').replace(/\.html$/, '').split('/')[0];

function toolView(tool, lang) {
  if (!TOOL_PAGES[tool]) throw new Error('Outil inconnu.');
  if (!toolViews.has(tool)) toolViews.set(tool, (async () => {
    // Une session à part, gardée d'une ouverture à l'autre : les connexions à Spotify et Apple Music y restent. Le jeton
    // du compte ONIRIQUE, lui, n'y est jamais écrit (stockage de la vue, effacé à sa fermeture).
    const ses = session.fromPartition('persist:onirique-web');
    // Pas de bandeau d'annonce du site dans l'application : il n'est même pas demandé.
    if (!ses.oniriqueReady) {
      ses.oniriqueReady = true;
      ses.webRequest.onBeforeRequest({ urls: [`${SITE}/api/announce.js*`] }, (_details, callback) => callback({ cancel: true }));
    }
    const view = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, session: ses,
      preload: path.join(__dirname, 'tool-preload.js') } });
    toolContents.add(view.webContents.id);
    view.setBackgroundColor('#00000000'); // transparente : le fond de l'application (nuit et braise) continue sous la page
    view.setVisible(false);
    const web = view.webContents;
    // Tout ce qui commence dans l'application y reste : une page du site s'ouvre dans la vue (sauf celles qui ont leur
    // propre écran : compte, boutique, l'autre outil). Seul ce qui sort du site (paiement, réseaux) part au navigateur.
    const route = (url) => {
      if (isAuth(url)) return true;
      const inSite = url === SITE || url.startsWith(SITE + '/');
      const screen = inSite && APP_ROUTES[pageOf(url)];
      if (inSite && (!screen || screen === tool)) return true;
      if (screen) win?.webContents.send('navigate', screen);
      else if (/^https:\/\//.test(url)) shell.openExternal(url);
      return false;
    };
    // Le bouton « précédent » de la souris revient à la page d'avant, comme dans un navigateur.
    win?.on('app-command', (_event, command) => {
      if (command === 'browser-backward' && !web.isDestroyed() && shownTool === tool && web.navigationHistory.canGoBack()) web.navigationHistory.goBack();
    });
    web.setWindowOpenHandler(({ url }) => {
      // MusicKit ouvre sa connexion dans une fenêtre qui lui répond : elle s'ouvre, au-dessus de l'application.
      if (isAuth(url)) return { action: 'allow', overrideBrowserWindowOptions: { parent: win, width: 520, height: 720, autoHideMenuBar: true, backgroundColor: '#09080A' } };
      if (route(url)) web.loadURL(url);
      return { action: 'deny' };
    });
    web.on('will-navigate', (event, url) => { if (!route(url)) event.preventDefault(); });
    // La fenêtre de connexion à Spotify se ferme d'elle-même une fois le compte connecté (son cookie de session posé) ;
    // à sa fermeture, la page relit l'état de la connexion.
    web.on('did-create-window', (child) => {
      child.on('closed', () => { if (!web.isDestroyed()) web.executeJavaScript('window.OniriquePlatforms && window.OniriquePlatforms.spotifyChanged && window.OniriquePlatforms.spotifyChanged()').catch(() => {}); });
      child.webContents.on('did-navigate', async (_event, url) => {
        if (/^https:\/\/open\.spotify\.com\//.test(url) && (await ses.cookies.get({ name: 'sp_dc' }).catch(() => [])).length && !child.isDestroyed()) child.close();
      });
    });
    web.on('dom-ready', () => {
      web.insertCSS(TOOL_SKIN + (accentVars ? `:root { ${accentVars} }` : '')).catch(() => {});
      // Les fenêtres « OK / Annuler » de la page : celles de l'application (voir tool:dialog), plus la boîte de Windows.
      web.executeJavaScript(`if (window.oniriqueDialog) {
        window.alert = (m) => { window.oniriqueDialog('alert', m); };
        window.confirm = (m) => window.oniriqueDialog('confirm', m) === true;
        window.prompt = (m, v) => { const r = window.oniriqueDialog('prompt', m, v); return typeof r === 'string' ? r : null; };
      }`).catch(() => {});
    });
    web.on('zoom-changed', () => web.setZoomLevel(0));
    web.setVisualZoomLevelLimits(1, 1).catch(() => {});
    // La session du compte et la langue de l'application passent par le stockage de la vue, jamais par l'adresse.
    await web.loadURL(SITE + '/robots.txt');
    await web.executeJavaScript(`try { localStorage.setItem("onirique.lang", ${JSON.stringify(lang === 'en' ? 'en' : 'fr')});
      ${store.token ? `sessionStorage.setItem("onirique.token", ${JSON.stringify(store.token)});` : ''} } catch {}`);
    // La vue ne se montre qu'une fois la page chargée et habillée.
    await web.loadURL(`${SITE}/${TOOL_PAGES[tool]}`).catch(() => {});
    return view;
  })());
  return toolViews.get(tool);
}

// La couleur d'accent choisie dans les Paramètres : posée sur CUT, CLOUD (variables de tool-skin.css) et les fenêtres de
// confirmation, à chaque page chargée et à chaque changement.
let accentVars = '';
ipcMain.handle('theme:accent', async (event, p) => {
  if (event.sender !== win?.webContents) return false;
  const ok = (v) => typeof v === 'string' && /^\d{1,3}, \d{1,3}, \d{1,3}$/.test(v);
  if (!p || !ok(p.acc) || !ok(p.hi) || !ok(p.lo)) return false;
  accentVars = `--acc: ${p.acc} !important; --acc-hi: ${p.hi} !important; --acc-lo: ${p.lo} !important;`;
  for (const pending of toolViews.values()) {
    const view = await pending.catch(() => null);
    if (view && !view.webContents.isDestroyed()) view.webContents.executeJavaScript(`document.documentElement.style.cssText += ${JSON.stringify(accentVars)}`).catch(() => {});
  }
  return true;
});

// Spotify connecté sur cet appareil (son cookie de session dans la session de CUT et CLOUD), et la déconnexion.
const webSession = () => session.fromPartition('persist:onirique-web');
ipcMain.handle('tool:spotify', async (event) => {
  if (!toolContents.has(event.sender.id)) return false;
  return (await webSession().cookies.get({ name: 'sp_dc' })).some((c) => /(^|\.)spotify\.com$/.test(c.domain.replace(/^\./, '')));
});
ipcMain.handle('tool:open-external', (event, url) => {
  if (!toolContents.has(event.sender.id) || !/^https:\/\/accounts\.spotify\.com\/authorize\?/.test(url)) return false;
  return shell.openExternal(url).then(() => true);
});
ipcMain.handle('tool:spotify-logout', async (event) => {
  if (!toolContents.has(event.sender.id)) return false;
  const ses = webSession();
  for (const c of await ses.cookies.get({})) {
    const host = c.domain.replace(/^\./, '');
    if (/(^|\.)spotify\.com$/.test(host)) await ses.cookies.remove(`https://${host}${c.path}`, c.name).catch(() => {});
  }
  return true;
});

// La fenêtre de confirmation de CUT et CLOUD, à la DA de l'application : la page attend la réponse (appel synchrone,
// comme alert/confirm/prompt du navigateur) pendant que la fenêtre, posée sur l'application, est ouverte.
ipcMain.on('tool:dialog', (event, kind, message, value) => {
  if (!toolContents.has(event.sender.id) || !['alert', 'confirm', 'prompt'].includes(kind) || !win) { event.returnValue = kind === 'prompt' ? null : false; return; }
  const lines = String(message).split(String.fromCharCode(10)).reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 58)), 0);
  const dialogWin = new BrowserWindow({ parent: win, modal: true, show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true,
    width: 500, height: Math.min(460, 150 + lines * 22 + (kind === 'prompt' ? 56 : 0)), backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'dialog-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  dialogWin.removeMenu();
  let answered = false;
  const reply = (result) => { if (answered) return; answered = true; event.returnValue = result; ipcMain.removeListener('dialog:answer', onAnswer); if (!dialogWin.isDestroyed()) dialogWin.close(); };
  const onAnswer = (e, result) => { if (e.sender === dialogWin.webContents) reply(kind === 'prompt' ? (typeof result === 'string' ? result : null) : result === true); };
  ipcMain.on('dialog:answer', onAnswer);
  dialogWin.on('closed', () => reply(kind === 'prompt' ? null : kind === 'alert'));
  dialogWin.once('ready-to-show', () => dialogWin.show());
  dialogWin.loadFile(path.join(__dirname, '..', 'renderer', 'dialog.html'), { query: { kind, message: String(message).slice(0, 2000), value: String(value).slice(0, 500), accent: accentVars } });
});

/** À la connexion ou à la déconnexion, les vues de l'ancien compte disparaissent. */
async function closeTools() {
  const views = [...toolViews.values()];
  toolViews.clear();
  for (const pending of views) {
    const view = await pending.catch(() => null);
    if (!view) continue;
    win?.contentView.removeChildView(view);
    view.webContents.close();
  }
}

function createWindow() {
  // La fenêtre revient comme on l'a laissée, si elle tient encore sur un écran branché (sinon, la taille par défaut).
  const { screen } = require('electron');
  const saved = store.windowState;
  const fits = saved && Number.isFinite(saved.x) && screen.getAllDisplays().some(({ workArea: a }) =>
    saved.x < a.x + a.width - 100 && saved.x + saved.width > a.x + 100 && saved.y >= a.y - 10 && saved.y < a.y + a.height - 100);
  win = new BrowserWindow({
    width: fits ? saved.width : 1320,
    height: fits ? saved.height : 840,
    ...(fits ? { x: saved.x, y: saved.y } : {}),
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
  win.once('ready-to-show', () => { if (fits && saved.maximized) win.maximize(); win.show(); });
  win.on('close', () => { store.windowState = { ...win.getNormalBounds(), maximized: win.isMaximized() }; });
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
    productId: product.id, machineId: await installer.machineId(), legacyMachineId: await installer.legacyMachineId(), machineName: os.hostname(),
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
  const legacyId = await installer.legacyMachineId(); // les activations faites avant le 15 octobre 2026
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
      const here = me.activations.some((a) => a.productId === product.id && (a.machineId === machineId || a.machineId === legacyId));
      // Un plugin offert (VIP, équipe avec « Mes licences » activé) s'active tout seul là où il est installé :
      // personne n'a de clé à saisir ni de bouton à trouver. Un plugin acheté garde son activation à la main.
      const offered = right?.via === 'vip' && !here && installs[product.id].present;
      // Une activation encore sous l'ancienne empreinte : reprise par le serveur sous la nouvelle, à rafraîchir ici.
      const legacyHere = me.activations.some((a) => a.productId === product.id && a.machineId === legacyId && legacyId !== machineId);
      if (right && (here || offered)) {
        try {
          await activateHere(product);
          activated ||= offered || legacyHere;
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

app.whenReady().then(async () => {
  // Le lecteur des musiques protégées (Spotify, Apple Music) : celui d'Electron de castlabs, prêt avant la fenêtre.
  if (components) await components.whenReady().catch((error) => console.error('Lecteur protégé :', error.message));
  // Sur Mac, le dossier ONIRIQUE des plugins existe dès l'ouverture, avant la première installation.
  if (process.platform === 'darwin') fs.mkdir(store.vst3Dir, { recursive: true }, () => {});
  // Sur Mac, une fois par version : les plugins déjà installés retrouvent une signature valide (voir installer.repairMac).
  if (process.platform === 'darwin' && store.macRepaired !== app.getVersion()) {
    installer.repairMac().then(() => { store.macRepaired = app.getVersion(); }).catch((error) => console.error('Remise en état des plugins :', error.message));
  }
  handle('load', load);

  // Compte avec l'A2F : sans code, la réponse { twoFactor: true } fait apparaître le champ du code.
  handle('auth:login', async (email, password, code) => {
    try {
      const { token } = await api.request('POST', '/api/auth/login', { email, password, ...(code ? { code } : {}) });
      store.token = token;
      await closeTools();
    } catch (error) {
      if (error.twoFactor && !code) return { twoFactor: true };
      throw error;
    }
  });
  // ref : le code de parrainage d'un ami ; newsletter : la case « recevoir les nouveautés d'ONIRIQUE ».
  handle('auth:register', async (email, password, name, ref, newsletter) => {
    const { token } = await api.request('POST', '/api/auth/register', { email, password, name, ref, newsletter: newsletter === true });
    store.token = token;
    await closeTools();
  });
  handle('auth:logout', async () => {
    await api.request('POST', '/api/auth/logout').catch(() => {});
    store.token = '';
    await closeTools();
  });
  handle('auth:password', async (current, next) => {
    const { token } = await api.request('POST', '/api/me/password', { current, next });
    store.token = token;
    await closeTools();
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
  // ONIRIQUE CUT et ONIRIQUE CLOUD, dans la fenêtre de l'application : la page du site posée dans le panneau
  // principal, à l'endroit que l'interface indique, et habillée aux couleurs de l'application (tool-skin.css, ici
  // seulement : le site ne change pas).
  handle('tool:show', async (tool, bounds, lang) => {
    const view = await toolView(tool, lang);
    for (const [name, other] of toolViews) if (name !== tool) (await other).setVisible(false);
    if (!win.contentView.children.includes(view)) win.contentView.addChildView(view);
    view.setBounds(Object.fromEntries(['x', 'y', 'width', 'height'].map((k) => [k, Math.max(0, Math.round(Number(bounds?.[k]) || 0))])));
    view.setVisible(!frozen); // une fenêtre de l'application est ouverte : l'outil reste caché derrière son image
    shownTool = tool;
  });
  // Un clic sur la rubrique déjà ouverte : retour à l'accueil de l'outil (après une page d'écoute, une autre page…).
  handle('tool:home', async (tool) => {
    if (!toolViews.has(tool)) return;
    const web = (await toolViews.get(tool)).webContents;
    if (pageOf(web.getURL()) !== TOOL_PAGES[tool].replace(/\.html$/, '')) await web.loadURL(`${SITE}/${TOOL_PAGES[tool]}`).catch(() => {});
    else web.executeJavaScript('location.hash = ""; scrollTo(0, 0)').catch(() => {});
  });
  // « Reset » : l'outil repart de zéro (la page rechargée, ce qui était en cours oublié).
  handle('tool:reset', async (tool) => {
    if (!toolViews.has(tool)) return;
    const web = (await toolViews.get(tool)).webContents;
    await web.executeJavaScript(`try { for (const k of Object.keys(sessionStorage)) if (k !== 'onirique.token') sessionStorage.removeItem(k); } catch {}`).catch(() => {});
    await web.loadURL(`${SITE}/${TOOL_PAGES[tool]}`).catch(() => {});
  });
  // Une fenêtre de l'application (Paramètres, confirmation…) s'ouvre : la page de l'outil, posée par-dessus
  // l'interface, passerait devant et prendrait les clics. Elle est remplacée par son image le temps de la fenêtre.
  handle('tool:freeze', async () => {
    frozen = true;
    if (!shownTool || !toolViews.has(shownTool)) return null;
    const view = await toolViews.get(shownTool);
    const image = view.getVisible() ? await view.webContents.capturePage().catch(() => null) : null;
    if (frozen) view.setVisible(false);
    return image ? image.toDataURL() : null;
  });
  handle('tool:thaw', async () => {
    frozen = false;
    if (shownTool && toolViews.has(shownTool)) (await toolViews.get(shownTool)).setVisible(true);
  });
  handle('tool:hide', async () => {
    shownTool = null; for (const view of toolViews.values()) (await view).setVisible(false); });
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
  // La photo d'ingé d'un fondateur, reprise de son profil Instagram. Instagram ne la donne plus aux serveurs : une
  // fenêtre invisible ouvre le profil public, comme un visiteur, depuis la connexion de ce PC ; la photo trouvée est
  // envoyée au serveur. Rien n'est gardé de la visite (session à part, effacée ensuite).
  handle('me:instagramAvatar', async (handle) => {
    if (typeof handle !== 'string' || !/^[A-Za-z0-9._]{1,30}$/.test(handle)) throw new Error('Compte Instagram invalide.');
    const { session } = require('electron');
    const visit = session.fromPartition(`instagram-${Date.now()}`);
    const page = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { session: visit, javascript: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      page.webContents.setUserAgent(page.webContents.getUserAgent().replace(/ (Electron|onirique-central)\/[\d.]+/gi, ''));
      await page.loadURL(`https://www.instagram.com/${handle}/`);
      let src = null;
      for (let i = 0; i < 30 && !src; i++) {
        await new Promise((r) => setTimeout(r, 500));
        src = await page.webContents.executeJavaScript(`(() => {
          const img = [...document.images].find((i) => /profile picture|photo de profil/i.test(i.alt) && i.naturalWidth > 0);
          return img ? img.src : (document.querySelector('meta[property="og:image"]') || {}).content || null;
        })()`).catch(() => null);
        // L'image par défaut d'Instagram (sans photo ou profil introuvable) ne compte pas.
        if (src && !/cdninstagram\.com\/v\/|fbcdn\.net\/v\//.test(src)) src = null;
      }
      if (!src) throw new Error("Photo introuvable : vérifiez que le compte Instagram existe et qu'il est public.");
      const url = new URL(src);
      if (url.protocol !== 'https:' || !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)) throw new Error('Adresse de photo inattendue.');
      const response = await visit.fetch(url.href);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok || bytes.length < 500 || bytes.length > 2 * 1024 * 1024) throw new Error("La photo d'Instagram n'a pas pu être lue.");
      const file = path.join(os.tmpdir(), `onirique-instagram-${process.pid}.jpg`);
      fs.writeFileSync(file, bytes);
      try {
        return await api.upload('PUT', '/api/me/engineer-avatar', file, 'image/jpeg', () => {});
      } finally {
        fs.rmSync(file, { force: true });
      }
    } finally {
      page.destroy();
      visit.clearStorageData().catch(() => {});
    }
  });

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
