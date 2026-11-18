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
    globalShortcut: {}, dialog: {}, ipcMain: { on() {} }, screen: {}, session: {}, shell: { trashItem: async (f) => fs.rmSync(f) }, BrowserWindow: class {} },
  './api': { request: async (m, r, b) => { calls.push([m, r, b]);
      if (r === '/api/me') return { user: { role: 'user' } };
      if (r === '/api/clips/K1') return { id: 'K1', status: 'ready', url: 'https://onirique.store/clip?c=K1', title: 'Le pentakill' };
      return {}; },
    upload: async (m, r, f, ct, p) => { calls.push([m, r]); p(1); return { id: 'K1', status: 'wait', url: 'https://onirique.store/clip?c=K1', title: 'Le pentakill' }; } },
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
  const shared = await handlers['clips:share'](c.name, 'Le pentakill');
  assert.deepEqual(shared, { id: 'K1', url: 'https://onirique.store/clip?c=K1', title: 'Le pentakill' });
  assert.ok(sent.some((x) => x[0] === 'clip' && x[1] === shared.url), 'le lien est copié');
  assert.deepEqual(calls.find((x) => x[0] === 'POST' && x[1].startsWith('/api/clips?')).slice(0, 2), ['POST', '/api/clips?title=Le%20pentakill']);
  assert.deepEqual((await handlers['clips:list']())[0].shared, shared, 'le lien reste avec le clip');
  await handlers['clips:unshare'](c.name);
  assert.ok(calls.some((x) => x[0] === 'DELETE' && x[1] === '/api/clips/K1'));
  assert.equal((await handlers['clips:list']())[0].shared, null);
  const cut = await handlers['clips:save-cut'](c.name, new Uint8Array([1, 2]), 12.5, 'video/mp4');
  assert.match(cut, /^clip-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d-coupe\.mp4$/);
  await handlers['clips:delete'](c.name);
  assert.deepEqual((await handlers['clips:list']()).map((x) => x.name), [cut]);
  fs.rmSync(tmp, { recursive: true });
  console.log('clips : tous les essais passent');
})().catch((e) => { console.error(e); process.exit(1); });
