// Rend les images des patch notes Discord (images.html) dans site/assets/patchnotes/, servies par le site.
//   app/node_modules/electron/dist/electron.exe tools/patchnotes/render.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('force-color-profile', 'srgb');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, frame: false, webPreferences: { offscreen: true } });
  win.setBounds({ x: 0, y: 0, width: 1600, height: 560 });
  await win.loadFile(path.join(__dirname, 'images.html'));
  await win.webContents.executeJavaScript('document.fonts.ready');
  const out = path.join(__dirname, '..', '..', 'site', 'assets', 'patchnotes');
  fs.mkdirSync(out, { recursive: true });
  for (const id of await win.webContents.executeJavaScript('ids')) {
    const [width, height] = await win.webContents.executeJavaScript(`show(${JSON.stringify(id)})`);
    win.setBounds({ x: 0, y: 0, width, height });
    await win.webContents.executeJavaScript('new Promise((r) => setTimeout(r, 250))');
    fs.writeFileSync(path.join(out, `${id}.png`), (await win.webContents.capturePage({ x: 0, y: 0, width, height })).toPNG());
  }
  console.log(`Images dans ${out}`);
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
