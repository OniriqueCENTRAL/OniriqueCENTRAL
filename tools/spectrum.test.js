// Essai du calcul de l'outil « Comparer à une référence » : node tools/spectrum.test.js
const assert = require('node:assert/strict');
const { analyse } = require('../site/assets/spectrum-worker.js');

const rate = 48000, n = rate * 4;
const tone = (hz, gain = 0.5) => Float32Array.from({ length: n }, (_, i) => gain * Math.sin(2 * Math.PI * hz * i / rate));

// Une note de 1 kHz en mono : toute l'énergie dans les médiums, rien sur les côtés, corrélation 1.
const sine = tone(1000);
const mono = analyse({ channels: [sine, sine], sampleRate: rate });
const band = (r, id) => r.bands.find((b) => b.id === id);
for (const id of ['sub', 'bass', 'lowmid', 'presence', 'high', 'air']) assert.ok(band(mono, 'mid').mid - band(mono, id).mid > 40, `1 kHz : ${id} loin sous les médiums`);
assert.ok(band(mono, 'mid').mid - band(mono, 'mid').side > 100, 'mono : aucun côté');
assert.ok(Math.abs(mono.correlation - 1) < 1e-6, 'mono : corrélation 1');
const peak = mono.points.reduce((best, p) => (p.mid > best.mid ? p : best));
assert.ok(peak.hz > 900 && peak.hz < 1120, `pic de la courbe vers 1 kHz (${Math.round(peak.hz)} Hz)`);

// Canaux en opposition de phase : corrélation −1, tout sur les côtés.
const inverted = Float32Array.from(sine, (v) => -v);
const wide = analyse({ channels: [sine, inverted], sampleRate: rate });
assert.ok(Math.abs(wide.correlation + 1) < 1e-6, 'opposition de phase : corrélation −1');
assert.ok(band(wide, 'mid').side - band(wide, 'mid').mid > 100, 'opposition de phase : tout sur les côtés');

// Basse à 50 Hz sur un seul canal : les basses ne sont plus centrées (corrélation basse faible).
const silence = new Float32Array(n);
const lopsided = analyse({ channels: [tone(50), silence], sampleRate: rate });
assert.ok(lopsided.lowCorrelation < 0.5, 'basse sur un seul canal : corrélation des basses faible');

// Deux fois plus fort : +6 dB partout.
const louder = analyse({ channels: [tone(1000, 1), tone(1000, 1)], sampleRate: rate });
assert.ok(Math.abs(band(louder, 'mid').mid - band(mono, 'mid').mid - 6.02) < 0.05, '+6 dB pour une amplitude doublée');

assert.equal(analyse({ channels: [new Float32Array(1000)], sampleRate: rate }).error, 'Ce fichier est trop court (quelques secondes au moins).');
console.log('spectre : 9 vérifications réussies');
