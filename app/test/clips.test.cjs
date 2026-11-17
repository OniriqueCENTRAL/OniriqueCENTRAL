const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
// Essais des clips sans Electron : node app/test/clips.test.cjs
const APP = path.join(__dirname, '..');
const { pick } = require(APP + '/renderer/clips-recorder.js');
// Deux enregistreurs relancés toutes les 30 s : le clip couvre toujours les 30 dernières secondes.
const S = 30;
for (let t = 61_000; t < 200_000; t += 1700) {
  const recs = []; for (let k = 0; k * S * 1000 <= t; k++) recs.push({ at: k * S * 1000 }); while (recs.length > 2) recs.shift();
  const r = pick(recs, t, S);
  assert(r.at <= t - S * 1000 && t - r.at < 2 * S * 1000, `t=${t}`);
}
assert.equal(pick([{ at: 5000 }], 10_000, 30).at, 5000); // juste après le lancement : clip plus court
assert.equal(pick([], 1, 30), null);

// clips.js avec un faux electron et une fausse API
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-'));
const handlers = {}, sent = [], calls = [];
let prefs = {};
const fakes = {
  electron: { app: { getPath: () => tmp, on() {} }, clipboard: { writeText: (t) => sent.push(['clip', t]) }, desktopCapturer: { getSources: async () => [] },
    globalShortcut: {}, ipcMain: { on() {} }, screen: {}, session: {}, shell: { trashItem: async (f) => fs.rmSync(f) }, BrowserWindow: class {} },
  './api': { request: async (m, r, b) => { calls.push([m, r, b]);
      if (r === '/api/me') return { user: { role: 'user' } };
      if (r === '/api/envois') return { id: 'E1' };
      if (r.endsWith('/files/new')) return { id: 7, chunk: 4 };
      return {}; },
    upload: async (m, r, f, ct, p, range) => { calls.push([m, r, range]); p(1); } },
  './store': { get prefs() { return prefs; }, setPref: (k, v) => { prefs[k] = v; } },
};
const load = Module._load;
Module._load = (req, ...rest) => fakes[req] || load(req, ...rest);
const clips = require(APP + '/main/clips.js');
clips.init({ handle: (c, fn) => { handlers[c] = fn; }, getWin: () => ({ webContents: { send: (...a) => sent.push(a) } }), site: 'https://onirique.store' });
(async () => {
  await assert.rejects(handlers['clips:set']({ on: true }), /réservés/); // un simple utilisateur n'a pas les clips
  assert.equal(prefs.clips, undefined);
  await assert.rejects(async () => handlers['clips:read']('../config.json'), /inconnu/);
  const d = path.join(tmp, 'ONIRIQUE Clips'); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'clip-2026-11-17_21-04-33.mp4'), Buffer.alloc(10));
  fs.writeFileSync(path.join(d, 'clip-2026-11-17_21-04-33.json'), JSON.stringify({ at: 1, duration: 50, start: 20 }));
  const [c] = await handlers['clips:list']();
  assert.deepEqual([c.name, c.size, c.start, c.duration], ['clip-2026-11-17_21-04-33.mp4', 10, 20, 50]);
  const url = await handlers['clips:share'](c.name);
  assert.equal(url, 'https://onirique.store/envoi?id=E1');
  const puts = calls.filter((x) => x[0] === 'PUT');
  assert.deepEqual(puts.map((x) => [x[1], x[2]]), [['/api/envois/E1/files/7?offset=0', { start: 0, end: 3 }], ['/api/envois/E1/files/7?offset=4', { start: 4, end: 7 }], ['/api/envois/E1/files/7?offset=8', { start: 8, end: 9 }]]);
  const cut = await handlers['clips:save-cut'](c.name, new Uint8Array([1, 2]), 12.5, 'video/mp4');
  assert.match(cut, /^clip-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d-coupe\.mp4$/);
  await handlers['clips:delete'](c.name);
  assert.deepEqual((await handlers['clips:list']()).map((x) => x.name), [cut]);
  fs.rmSync(tmp, { recursive: true });
  console.log('clips : tous les essais passent');
})().catch((e) => { console.error(e); process.exit(1); });
