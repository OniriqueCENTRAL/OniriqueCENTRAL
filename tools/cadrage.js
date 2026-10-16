// Cadrage des liens de section de l'accueil : pour chaque lien du menu du haut (« Téléchargement », « Crédits »…),
// la page est ouverte dans un vrai navigateur, le lien cliqué, puis on mesure où la section s'arrête par rapport à
// la barre du haut, le temps que les images et les listes finissent de charger. À relancer après chaque
// modification de la page d'accueil.
//
//   app/node_modules/electron/dist/electron.exe tools/cadrage.js            → le site en ligne, avec les fichiers de site/ de ce dossier
//   app/node_modules/electron/dist/electron.exe tools/cadrage.js --en-ligne → le site en ligne tel quel
//   … --lent : connexion lente (6 Mbit/s), là où la page bouge encore longtemps après le clic
//
// Les données (catalogue, crédits) viennent du site en ligne ; les pages et scripts, de site/ (sauf --en-ligne).
// Sortie 0 : toutes les sections tombent pile sous la barre ; 1 sinon.
const { app, BrowserWindow, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SITE = 'https://onirique.store';
const local = !process.argv.includes('--en-ligne');
const slow = process.argv.includes('--lent');
const siteDir = path.join(__dirname, '..', 'site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };

app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.whenReady().then(async () => {
  if (local) {
    // Les fichiers du site viennent de ce dossier ; l'API et tout le reste, du site en ligne.
    protocol.handle('https', (request) => {
      const url = new URL(request.url);
      if (url.origin === SITE && !url.pathname.startsWith('/api/')) {
        const file = path.join(siteDir, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
        if (file.startsWith(siteDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          return new Response(fs.readFileSync(file), { headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' } });
        }
      }
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    });
  }

  const win = new BrowserWindow({ width: 1575, height: 935, show: false, webPreferences: { backgroundThrottling: false, offscreen: true } });
  const run = (code) => win.webContents.executeJavaScript(code);
  if (slow) {
    await win.loadURL('about:blank');   // l'émulation ne s'attache qu'à une page déjà ouverte
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Network.enable');
    await win.webContents.debugger.sendCommand('Network.emulateNetworkConditions',
      { offline: false, latency: 100, downloadThroughput: 6e6 / 8, uploadThroughput: 1.5e6 / 8 });
  }
  const open = async () => {   // page fraîche, sans cache : le clic part pendant que tout charge encore
    await win.webContents.session.clearCache();
    await new Promise((resolve) => { win.webContents.once('dom-ready', resolve); win.loadURL(SITE + '/'); });
    await new Promise((r) => setTimeout(r, 300));
  };
  await open();

  const links = await run(`[...new Set([...document.querySelectorAll('header a[href^="#"], header a[href^="/#"]')]
    .map((a) => a.getAttribute('href').replace(/^\\//, '')).filter((h) => h.length > 1 && h !== '#top'))]`);
  let failures = 0;
  console.log(`Cadrage des sections (${local ? 'fichiers locaux' : 'site en ligne'}) : écart entre le haut de la section et le bas de la barre, en px`);
  for (const href of links) {
    await open();
    const samples = await run(`(async () => {
      const header = document.querySelector('header');
      const target = document.getElementById(${JSON.stringify(href.slice(1))});
      if (!target) return null;
      document.querySelector('header a[href="${href}"], header a[href="/${href}"]').click();
      const gap = () => Math.round(target.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 12);
      const out = [];
      let t = 0;
      for (const at of ${slow ? '[3000, 8000, 16000]' : '[1500, 4000, 8000]'}) { await new Promise((r) => setTimeout(r, at - t)); t = at; out.push(gap()); }
      // une section en bas de page ne peut pas monter plus haut que la fin de la page
      const bottom = Math.abs(window.scrollY + window.innerHeight - document.documentElement.scrollHeight) < 3;
      return { out, bottom };
    })()`);
    if (!samples) { console.log(`  ${href.padEnd(18)} section introuvable`); failures++; continue; }
    const final = samples.out[samples.out.length - 1];
    const ok = Math.abs(final) <= 3 || (samples.bottom && final > 0);
    if (!ok) failures++;
    const [t1, t2, t3] = slow ? ['3 s', '8 s', '16 s'] : ['1,5 s', '4 s', '8 s'];
    console.log(`  ${href.padEnd(18)} à ${t1} : ${String(samples.out[0]).padStart(6)}   à ${t2} : ${String(samples.out[1]).padStart(6)}   à ${t3} : ${String(final).padStart(6)}   ${ok ? 'ok' : 'DÉCALÉ'}`);
  }
  // Deux clics rapprochés : le second trajet remplace le premier, on finit sur la seconde section.
  for (let i = 0; i + 1 < links.length; i++) {
    const [first, second] = [links[i], links[(i + 1) % links.length]];
    await open();
    const gap = await run(`(async () => {
      const header = document.querySelector('header');
      const click = (h) => document.querySelector('header a[href="' + h + '"], header a[href="/' + h + '"]').click();
      click(${JSON.stringify(first)});
      await new Promise((r) => setTimeout(r, 300));
      click(${JSON.stringify(second)});
      await new Promise((r) => setTimeout(r, ${slow ? 16000 : 8000}));
      return Math.round(document.getElementById(${JSON.stringify(second.slice(1))}).getBoundingClientRect().top - header.getBoundingClientRect().bottom - 12);
    })()`);
    const ok = Math.abs(gap) <= 3;
    if (!ok) failures++;
    console.log(`  ${first} puis ${second} (deux clics à 0,3 s) : ${String(gap).padStart(6)}   ${ok ? 'ok' : 'DÉCALÉ'}`);
  }
  console.log(failures ? `${failures} section(s) mal cadrée(s)` : 'toutes les sections tombent sous la barre');
  app.exit(failures ? 1 : 0);
});
