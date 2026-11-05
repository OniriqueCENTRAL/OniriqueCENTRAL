// Construction Mac (GitHub Actions, .github/workflows/mac.yml) : la signature Widevine de castlabs (« Electron
// Framework.sig ») diffère entre Intel et Apple Silicon, ce qui empêche de les fusionner en une application universelle.
// Elle est retirée de chaque architecture avant la fusion : sans le compte castlabs (signature VMP), elle ne serait de
// toute façon pas valable une fois l'application signée.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function dropSig(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const sig = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Frameworks',
    'Electron Framework.framework', 'Versions', 'A', 'Resources', 'Electron Framework.sig');
  fs.rmSync(sig, { force: true });
};
