// Calage des paroles écrites (site/assets/ctc-align.js) sur des probabilités de lettres simulées.
import assert from 'node:assert/strict';
import { alignLines, lettersOf, LETTERS, VOCAB, SETTINGS } from '../../site/assets/ctc-align.js';

assert.deepEqual(lettersOf('**J’suis**'), ['j', "'", 's', 'u', 'i', 's'].map((c) => VOCAB[c]));
assert.deepEqual(lettersOf('Ça'), [VOCAB['ç'], VOCAB.a]);
assert.deepEqual(lettersOf('&'), []);
assert.deepEqual(lettersOf("'yeah'"), lettersOf('yeah'));

// 4 s de son : « salut » à 0,40 s, « toi » à 1,00 s, du chant non écrit vers 1,6 s, « encore » à 2,40 s. L'ad-lib écrit
// « (yeah) » n'est pas chanté.
const T = 200, lp = new Float32Array(T * LETTERS).fill(-12);
for (let t = 0; t < T; t++) lp[t * LETTERS] = 0; // « rien » partout…
const say = (word, frame) => [...word].forEach((ch, i) => { const t = frame + 2 * i; lp[t * LETTERS] = -12; lp[t * LETTERS + VOCAB[ch]] = 0; });
say('salut', 20); say('toi', 50); say('zrkxz', 80); say('encore', 120);
const out = alignLines(lp, [['Salut', 'toi', '(yeah)'], ['encore', '&']]);
const near = (got, want) => assert.ok(Math.abs(got - want) < 0.021, `${got} au lieu de ${want}`);
near(out[0].at, 0.40 + SETTINGS.off);
near(out[1].at, 1.00 + SETTINGS.off);
near(out[3].at, 2.40 + SETTINGS.off);
assert.ok(out[2].at > out[1].at && out[2].at < out[3].at, 'l’ad-lib non chanté reste entre ses voisins');
assert.ok(out[4].at >= out[3].at, 'un mot sans lettre suit le précédent');
console.log('paroles : ok');
