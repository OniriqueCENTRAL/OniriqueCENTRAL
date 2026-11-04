// Signature VMP de castlabs, à chaque construction : Widevine (Spotify, Apple Music) exige une application signée par
// castlabs pour lire en entier. Sans l'outil castlabs-evs et son compte, la construction continue et le signale :
//   pip install castlabs-evs
//   python -m castlabs_evs.account signup     (une fois, compte gratuit ; ensuite : python -m castlabs_evs.account reauth)
// L'application n'a pas de signature Authenticode : la signature VMP se fait donc juste après l'empaquetage.
const { execFileSync } = require('node:child_process');

exports.default = async function vmpSign(context) {
  try {
    execFileSync('python', ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: 'inherit' });
  } catch {
    console.warn('  • signature VMP de castlabs non faite : Spotify et Apple Music joueront les extraits de 30 s. '
      + 'Voir app/build/vmp-sign.js (pip install castlabs-evs, puis python -m castlabs_evs.account signup).');
  }
};
