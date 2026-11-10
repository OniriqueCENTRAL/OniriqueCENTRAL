// Transfert de playlist : lecture des pages Tidal et YouTube (sans réseau) : node test/transfer.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'onirique-transfer-'));
const { tidalTracks, youtubeTracks } = await import('../src/transfer.js');
assert.deepEqual(tidalTracks('{"441":{"album":"A","artist":"Kehlani","artwork":[{"src":"x"}],"title":"Folded \\"live\\""}}'), [{ artist: 'Kehlani', title: 'Folded "live"' }]);
const lockup = (title, channel) => ({ lockupViewModel: { metadata: { lockupMetadataViewModel: { title: { content: title },
  metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: channel } }] }] } } } } } });
const html = `<script>var ytInitialData = ${JSON.stringify({ a: [lockup('BELLAKEO (Video Oficial) - Peso Pluma, Anitta', 'Peso Pluma'), lockup('Arcángel - FN8 ( Video Lyric )', 'Arcangel'), lockup('Nuit', 'Nov - Topic')] })};</script>`;
assert.deepEqual(youtubeTracks(html), [{ artist: 'Peso Pluma', title: 'BELLAKEO' }, { artist: 'Arcangel', title: 'FN8' }, { artist: 'Nov', title: 'Nuit' }]);
console.log('transfer : ok');
