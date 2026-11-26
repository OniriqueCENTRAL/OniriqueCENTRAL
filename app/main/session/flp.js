// Écrire un projet FL Studio (.flp) : un clip audio par stem, chacun sur son insert du mixer, routé vers son bus.
// Repris d'ONIRIQUE Session (app/flp.py, dépôt OniriqueSession), où le format est décrit : un .flp est une suite
// d'évènements (id, valeur) ; on part d'un projet écrit par FL lui-même (empty.flp, ou la template de l'utilisateur) et
// on y ajoute canaux, inserts et pistes, sans toucher au reste. Ce qui change d'une version de FL à l'autre :
//   - un insert du mixer s'ouvre par un 42 depuis FL 21 ;
//   - le nombre d'inserts (103) n'existe que depuis FL 24.2 ;
//   - un élément de playlist fait 32 octets jusqu'à FL 20.8, 60 jusqu'à 24.1, 80 jusqu'à 2025, 88 depuis 2026 ;
//   - un canal dit son insert par un 22 jusqu'à 24.1, par un 104 depuis ;
//   - depuis 25.2.3, l'en-tête a un 172 de trois octets.
const fs = require('node:fs');
const path = require('node:path');

const CHANNEL_NEW = 64, CHANNEL_NAME = 203, CHANNEL_COLOR = 128, CHANNEL_INSERT = 22, SAMPLE_PATH = 196;
const CHANNEL_INSERT_WORD = 104;
const ARRANGEMENT_NEW = 99, PLAYLIST = 233, TRACK_DATA = 238, TRACK_NAME = 239, ARRANGEMENT_CURRENT = 100;
const INSERT_COLOR = 149, INSERT_PRELUDE = 42, INSERT_ICON = 95, INSERT_NAME = 204, INSERT_FLAGS = 236;
const INSERT_ROUTING = 235, INSERT_OUTPUT = 147, TEMPO = 156, SONG_MODE = 9, VERSION = 199, INSERT_COUNT = 103;
const TITLE = 194, COMMENTS = 195, GENRE = 206, ARTISTS = 207;
const THREE_BYTES = 172;

const LEVEL = '000000000000000064000000204e0000204e00003075000032000000204e00000000000064000000204e000000000000b680000000000000000000000000000000000000';
const LEVEL_LOW = '040000000000000064000000204e0000204e00003075000032000000204e00000000000064000000204e000000000000b68000000000000000000000000000009bffffff';
// Un canal « clip audio » tel que FL 20.5 / 20.8 l'écrit ; null : rempli pour chaque stem.
const AUDIO_CHANNEL = [
  [64, null], [21, 4], [201, '0000'], [212, '0000000000000000ffffffff0000000050000000030000000000000000000000000000005a000000ae0000000000000000000000'],
  [203, null], [155, 0], [128, null], [0, 1], [209, '0000000000190000000000000400000090000000'], [138, 8388736], [139, 65536],
  [89, 0], [97, 128], [69, 128], [86, 256], [71, 1024], [83, 0], [74, 0], [75, 0], [76, 0], [85, 2048], [131, 8388608], [70, 0],
  [22, null], [219, '00190000bb06000000000000000100000000000000000000'], [229, '0000000000320000000000000000000000000000'],
  [221, '00000000f401000000'],
  // Le 215 (réglages du sample) d'un clip de « Atthar » (FL 20.8) : celui de Trap fait ignorer le clip par FL 2025.
  [215, '8c0000000000000001000000ffffffff3c0000000000803f0000803f0000803f0000803f0000803f000000000300000000000000000400'
    + '003000000000000100a7050000000000000001000000000000010000010000000000000000010000000000000000000000000000000000'
    + '000002000000feffffffffffffff000000000000000000000000000000000000f03f0000000000000000ffffffff0101'],
  [132, 0], [144, 0], [145, 0], [32, 0], [228, '64000000000000000000000000000000'], [228, '3c000000000000000000000000000000'],
  [218, LEVEL], [218, LEVEL_LOW], [218, LEVEL], [218, LEVEL], [218, LEVEL],
  [143, 2], [20, 0], [196, null],
];
const ITEM_TAIL = {
  32: Buffer.alloc(0),
  60: Buffer.from('000000000000000000000000000000000000803f00000000', 'hex'),
  80: Buffer.from('000000000000000000000000000000000000803f0000000000000000000000000000f03f0000000000000000', 'hex'),
  88: Buffer.from('000000000000000000000000000000000000803f0880000000000000000000000000f03f00000000ffffffff0000000000000000', 'hex'),
};

const EMPTY = path.join(__dirname, 'empty.flp'); // le projet vide de FL 20.1 (ouvert par tout FL depuis le 20)

function itemSize(project) {
  const v = project.events.find(([e]) => e === VERSION);
  const version = v ? v[1].toString('latin1').replace(/\0+$/, '') : '';
  const [a = 0, b = 0] = [...version.split('.'), '0', '0'].slice(0, 2).filter((x) => /^\d+$/.test(x)).map(Number);
  const at = a * 1000 + b;
  return at < 20099 ? 32 : at < 24002 ? 60 : at < 26000 ? 80 : 88;
}

const varint = (n) => { const out = []; do { out.push((n & 127) | (n > 127 ? 128 : 0)); n = Math.floor(n / 128); } while (n); return Buffer.from(out); };

function read(file) {
  const b = fs.readFileSync(file);
  if (b.toString('latin1', 0, 4) !== 'FLhd' || b.toString('latin1', 14, 18) !== 'FLdt') throw new Error(`« ${path.basename(file)} » n'est pas un projet FL Studio.`);
  const format = b.readInt16LE(8), ppq = b.readInt16LE(12), events = [];
  let i = 22;
  while (i < b.length) {
    const e = b[i++];
    if (e === THREE_BYTES) { events.push([e, b.subarray(i, i + 3)]); i += 3; }
    else if (e < 64) events.push([e, b[i++]]);
    else if (e < 128) { events.push([e, b.readUInt16LE(i)]); i += 2; }
    else if (e < 192) { events.push([e, b.readUInt32LE(i)]); i += 4; }
    else {
      let n = 0, shift = 0, c;
      do { c = b[i++]; n += (c & 127) * 2 ** shift; shift += 7; } while (c >= 128);
      events.push([e, b.subarray(i, i + n)]); i += n;
    }
  }
  return { format, ppq, events };
}

function write(file, project) {
  const parts = [];
  for (const [e, v] of project.events) {
    parts.push(Buffer.from([e]));
    if (e === THREE_BYTES) parts.push(v);
    else if (e < 64) parts.push(Buffer.from([v & 255]));
    else if (e < 128) { const x = Buffer.alloc(2); x.writeUInt16LE(v & 0xFFFF); parts.push(x); }
    else if (e < 192) { const x = Buffer.alloc(4); x.writeUInt32LE(v >>> 0); parts.push(x); }
    else parts.push(varint(v.length), v);
  }
  const body = Buffer.concat(parts), head = Buffer.alloc(22);
  head.write('FLhd', 0, 'latin1'); head.writeUInt32LE(6, 4); head.writeInt16LE(project.format, 8);
  head.writeInt16LE(project.events.filter(([e]) => e === CHANNEL_NEW).length, 10); head.writeInt16LE(project.ppq, 12);
  head.write('FLdt', 14, 'latin1'); head.writeUInt32LE(body.length, 18);
  fs.writeFileSync(file, Buffer.concat([head, body]));
}

const text = (value) => Buffer.from(`${value}\0`, 'utf16le');
const bgr = (rgb) => ((rgb & 255) << 16) | (rgb & 0xFF00) | ((rgb >> 16) & 255); // FL range ses couleurs en 0x00BBGGRR

/** Les inserts du mixer : [{ index, name, plugins, start, end }], du début de leur bloc à leur sortie (147). */
function inserts(project) {
  const { events } = project, out = [];
  let start = null;
  events.forEach(([e], i) => {
    if (e === INSERT_FLAGS && start === null) {
      start = i;
      while (start > 0 && [INSERT_COLOR, INSERT_ICON, INSERT_NAME, INSERT_PRELUDE].includes(events[start - 1][0])) start--;
    } else if (e === INSERT_OUTPUT && start !== null) {
      const block = events.slice(start, i), name = block.find(([x]) => x === INSERT_NAME);
      out.push({ index: out.length, name: name ? name[1].toString('utf16le').replace(/\0+$/, '') : '', start, end: i,
        plugins: block.filter(([x]) => x === 201).length });
      start = null;
    }
  });
  return out;
}

/** Ce que la template contient, pour que l'interface y retrouve pistes et bus par leur nom. */
function describe(file) {
  return { daw: 'fl', slots: inserts(read(file)).filter((x) => x.name).map((x) => ({ index: x.index, name: x.name })) };
}

/** plan : voir plan.js. Écrit le .flp et rend le nombre de stems posés. */
function build(plan, outPath) {
  const project = read(plan.template || EMPTY), { events, ppq } = project;

  // Le tempo et les infos du morceau (F11 dans FL).
  const { info } = plan;
  let bpm = parseFloat(String(info.bpm || '').replace(',', '.'));
  bpm = bpm >= 10 && bpm <= 522 ? bpm : null; // ce que FL accepte ; sinon le tempo du projet de départ
  const fields = { [TITLE]: info.title, [ARTISTS]: info.artist, [GENRE]: info.genre, [COMMENTS]: info.comments };
  events.forEach(([e], i) => {
    if (fields[e]) events[i] = [e, text(fields[e])];
    else if (e === TEMPO && bpm) events[i] = [e, Math.round(bpm * 1000)];
    else if (e === SONG_MODE) events[i] = [e, 1]; // la playlist joue, pas le pattern
  });
  const tempo = (events.find(([e]) => e === TEMPO)?.[1] ?? 140000) / 1000;

  // Le mixer : chaque stem sur un insert (celui de la template qui porte son nom, ou un nouveau), routé vers son bus.
  let mixer = inserts(project);
  const byName = new Map(mixer.filter((x) => x.name).map((x) => [x.name.toLowerCase(), x.index]));
  const used = new Set(events.filter(([e]) => e === CHANNEL_INSERT || e === CHANNEL_INSERT_WORD).map(([, v]) => v));
  const free = mixer.slice(1, -1).filter((x) => !x.name && !x.plugins && !used.has(x.index)).map((x) => x.index); // ni le master, ni « current »
  const newInserts = []; // [index, name, color, routeTo]
  let nextIndex = mixer.length - 1; // les nouveaux inserts se glissent avant « current », le dernier
  const take = (name, color) => { const index = free.length ? free.shift() : nextIndex++; newInserts.push([index, name, color, 0]); return index; };
  const find = (match) => byName.get(String(match || '').toLowerCase());

  const pending = [];
  for (const stem of plan.stems) {
    const existing = find(stem.match);
    stem._insert = existing ?? take(stem.track, stem.color);
    if (existing === undefined) pending.push([newInserts[newInserts.length - 1], stem.group]);
  }
  const buses = {};
  for (const group of plan.groups) buses[group.name] = find(group.match) ?? take(group.name, group.color);
  for (const [insert, group] of pending) insert[3] = buses[group] ?? 0;

  if (mixer.length < 2 || !events.some(([e]) => e === ARRANGEMENT_NEW)) {
    throw new Error('Cette template FL vient d\'un FL trop ancien (avant FL 20) : choisis une template enregistrée dans FL 20 ou plus récent, ou aucune.');
  }
  // Le modèle d'un nouvel insert : un insert sans effet de la template elle-même, sinon celui du projet vide.
  const source = mixer.slice(1, -1).some((x) => !x.plugins) ? project : read(EMPTY);
  const blank = inserts(source).slice(1, -1).find((x) => !x.plugins);
  const blankEvents = source.events.slice(blank.start, blank.end + 1);
  const extra = Math.max(0, nextIndex - (mixer.length - 1));
  const last = mixer[mixer.length - 1].start;
  events.splice(last, 0, ...Array.from({ length: extra }, () => blankEvents.map(([e, v]) => [e, v])).flat());
  mixer = inserts(project);
  events.forEach(([e], i) => { if (e === INSERT_COUNT) events[i] = [e, mixer.length]; });
  for (const [index, name, color, routeTo] of [...newInserts].sort((a, b) => b[0] - a[0])) { // de la fin, pour garder les positions
    const x = mixer[index];
    let block = events.slice(x.start, x.end + 1).filter(([e]) => ![INSERT_COLOR, INSERT_ICON, INSERT_NAME].includes(e));
    block = block.map(([e, v]) => {
      if (e !== INSERT_ROUTING) return [e, v];
      const routing = Buffer.alloc(Math.max(v.length, routeTo + 1)); // un octet par insert, de la taille que FL avait écrite
      routing[routeTo] = 1;
      return [e, routing];
    });
    const flags = block.findIndex(([e]) => e === INSERT_FLAGS);
    block.splice(flags, 0, [INSERT_NAME, text(name)]);
    // FL écrit la couleur en tête de l'insert ; depuis FL 21, le 42 à 1 lui dit de s'en servir.
    block = block.map(([e, v]) => (e === INSERT_PRELUDE ? [e, 1] : [e, v]));
    block.unshift([INSERT_COLOR, bgr(color)]);
    events.splice(x.start, x.end + 1 - x.start, ...block);
  }

  // Les canaux : un clip audio par stem, après les canaux existants.
  const first = Math.max(-1, ...events.filter(([e]) => e === CHANNEL_NEW).map(([, v]) => v)) + 1;
  const channelsEnd = events.findIndex(([e]) => e === ARRANGEMENT_NEW);
  const newChannels = [];
  plan.stems.forEach((stem, n) => {
    const values = { [CHANNEL_NEW]: first + n, [CHANNEL_NAME]: text(stem.track), [SAMPLE_PATH]: text(stem.dest), [CHANNEL_COLOR]: bgr(stem.color), [CHANNEL_INSERT]: stem._insert };
    for (const [e, v] of AUDIO_CHANNEL) {
      const value = e in values ? values[e] : v;
      newChannels.push([e, typeof value === 'string' ? Buffer.from(value, 'hex') : value]);
    }
  });
  events.splice(channelsEnd, 0, ...newChannels);

  // La playlist de l'arrangement courant : une piste par stem, nommée et colorée, le clip entier posé au début.
  const current = events.find(([e]) => e === ARRANGEMENT_CURRENT)?.[1] ?? 0;
  const starts = events.map(([e], i) => (e === ARRANGEMENT_NEW ? i : -1)).filter((i) => i >= 0);
  const start = starts.find((i) => events[i][1] === current) ?? starts[0];
  const end = starts.find((i) => i > start) ?? events.length;
  let playlist = -1;
  for (let i = start; i < end; i++) if (events[i][0] === PLAYLIST) { playlist = i; break; }
  const size = itemSize(project), old = events[playlist][1], taken = new Set();
  for (let k = 0; k < old.length; k += size) taken.add(499 - old.readUInt16LE(k + 12));
  const track = taken.size ? Math.max(...taken) + 1 : 0;
  const items = [old];
  const tracks = [];
  for (let i = start; i < end; i++) if (events[i][0] === TRACK_DATA) tracks.push(i);
  const names = new Map();
  plan.stems.forEach((stem, n) => {
    const t = track + n;
    if (t >= tracks.length) return; // shortcut: 500 pistes de playlist au plus, comme FL
    const length = Math.max(1, Math.round(stem.seconds * tempo / 60 * ppq));
    const item = Buffer.alloc(32);
    item.writeUInt32LE(0, 0); item.writeUInt16LE(20480, 4); item.writeUInt16LE(first + n, 6); item.writeUInt32LE(length, 8);
    item.writeUInt16LE(499 - t, 12); item.writeUInt16LE(0, 14); Buffer.from('7800400040648080', 'hex').copy(item, 16);
    item.writeFloatLE(-1, 24); item.writeFloatLE(-1, 28); // le début et la fin du clip dans le son : -1, tout
    items.push(item);
    if (size > 32) { const id = Buffer.alloc(4); id.writeUInt32LE(first + n + 2); items.push(id, ITEM_TAIL[size]); }
    names.set(tracks[t], [stem.track, stem.color]);
  });
  const joined = Buffer.concat(items);
  if (joined.length % size) throw new Error('Playlist FL mal formée.');
  events[playlist] = [PLAYLIST, joined];
  for (const i of [...names.keys()].sort((a, b) => b - a)) {
    const [name, color] = names.get(i), data = Buffer.from(events[i][1]);
    data.writeUInt32LE(bgr(color), 4);
    events[i] = [TRACK_DATA, data];
    if (i + 1 < events.length && events[i + 1][0] === TRACK_NAME) events[i + 1] = [TRACK_NAME, text(name)];
    else events.splice(i + 1, 0, [TRACK_NAME, text(name)]);
  }
  write(outPath, project);
  return plan.stems.length;
}

module.exports = { read, write, describe, build, inserts, EMPTY };
