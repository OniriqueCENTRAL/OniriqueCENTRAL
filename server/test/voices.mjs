// Regroupement des phrases par voix (site/assets/voices.js) sur des empreintes simulées.
import assert from 'node:assert/strict';
import { groupVoices } from '../../site/assets/voices.js';

// Des empreintes de 64 nombres : chaque voix a sa direction, chaque phrase s'en écarte un peu (graine fixe : résultat stable).
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
const voice = () => unit(Array.from({ length: 64 }, rand));
const [A, B, C] = [voice(), voice(), voice()];
const say = (v, noise = 0.9) => unit(v.map((x) => x + noise * rand() / 4));

// Une réplique : A, A, B (court, « Quoi ? »), B, A. La phrase courte rejoint la voix la plus proche.
assert.deepEqual(groupVoices([say(A), say(A), say(B, .3), say(B), say(A)], [2, 1.8, .4, 1.6, 1.7]), [1, 1, 2, 2, 1]);
// Une seule voix : tout en 1.
assert.deepEqual(groupVoices([say(A), say(A), say(A)], [2, 2, 2]), [1, 1, 1]);
// Jamais plus de max voix, numérotées dans l'ordre d'arrivée.
const four = groupVoices([say(C), say(A), say(B), say(voice())], [2, 2, 2, 2], { max: 3 });
assert.equal(Math.max(...four), 3);
assert.equal(four[0], 1);
// Un son : un couplet A, une phrase seule qui ressemble à C au milieu, puis un refrain B. Avec smooth, elle rejoint le couplet.
const embs = [say(A), say(A), say(C, .2), say(A), say(B), say(B), say(B)], durs = [2, 2, 1.2, 2, 2, 2, 2];
assert.deepEqual(groupVoices(embs, durs, { smooth: true }), [1, 1, 1, 1, 2, 2, 2]);
assert.deepEqual(groupVoices([], []), []);
console.log('voix : ok');
