// Vitesse d'une page du site : ce qu'elle télécharge, et quand elle s'affiche. À relancer après un changement.
//
//   app/node_modules/electron/dist/electron.exe tools/vitesse.js [page] [--lent]
//
// page : chemin sur le site (par défaut l'accueil, « / »). --lent : connexion 4G moyenne (6 Mbit/s, 100 ms).
// Cache vidé : c'est la première visite, la plus lente. Les chiffres viennent du navigateur lui-même.
const { app, BrowserWindow } = require('electron');

const SITE = 'https://onirique.store';
const page = process.argv.find((a) => a.startsWith('/')) || '/';
const slow = process.argv.includes('--lent');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { backgroundThrottling: false, offscreen: true } });
  await win.loadURL('about:blank');
  if (slow) {
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Network.enable');
    await win.webContents.debugger.sendCommand('Network.emulateNetworkConditions',
      { offline: false, latency: 100, downloadThroughput: 6e6 / 8, uploadThroughput: 1.5e6 / 8 });
  }
  await win.webContents.session.clearCache();
  await win.webContents.executeJavaScript('0');
  await win.loadURL(SITE + page);
  await new Promise((r) => setTimeout(r, slow ? 15000 : 6000));

  const report = await win.webContents.executeJavaScript(`(async () => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
    const lcp = await new Promise((resolve) => {
      let last = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries()) last = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      setTimeout(() => resolve(Math.round(last)), 50);
    });
    const cls = await new Promise((resolve) => {
      let sum = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) sum += e.value; }).observe({ type: 'layout-shift', buffered: true });
      setTimeout(() => resolve(Math.round(sum * 1000) / 1000), 50);
    });
    const files = performance.getEntriesByType('resource').map((r) => ({
      url: r.name.replace(location.origin, ''), type: r.initiatorType, kb: Math.round(r.transferSize / 1024), raw: Math.round(r.decodedBodySize / 1024),
      end: Math.round(r.responseEnd) }));
    return { html: Math.round(nav.transferSize / 1024), htmlRaw: Math.round(nav.decodedBodySize / 1024), ttfb: Math.round(nav.responseStart),
      domReady: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), paint, lcp, cls, files };
  })()`);

  const total = report.files.reduce((s, f) => s + f.kb, report.html);
  console.log(`${SITE}${page}${slow ? '  (4G moyenne)' : ''}`);
  console.log(`  premier octet ${report.ttfb} ms · premier affichage ${report.paint['first-contentful-paint'] ?? '?'} ms · plus grand élément ${report.lcp} ms · page prête ${report.domReady} ms · tout chargé ${report.load} ms`);
  console.log(`  décalages de mise en page (CLS) ${report.cls} · téléchargé ${total} Ko en ${report.files.length + 1} fichiers`);
  console.log(`  page HTML : ${report.html} Ko transférés (${report.htmlRaw} Ko décompressés)`);
  for (const f of report.files.sort((a, b) => b.kb - a.kb).slice(0, 25))
    console.log(`  ${String(f.kb).padStart(6)} Ko  (${String(f.raw).padStart(6)} Ko)  fini à ${String(f.end).padStart(5)} ms  ${f.type.padEnd(14)} ${f.url.slice(0, 90)}`);
  app.exit(0);
});
