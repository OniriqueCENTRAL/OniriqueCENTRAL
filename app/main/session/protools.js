// Créer une session Pro Tools par PTSL, l'interface de script de Pro Tools (2023.3+), sur localhost:31416. Repris
// d'ONIRIQUE Session (app/protools.py). Pro Tools doit être ouvert. Chaque commande est un Request { header { task_id,
// command, version… }, request_body_json } : le corps est du JSON, seule l'enveloppe est en protobuf, encodée ici à la
// main ; l'appel gRPC passe par le http2 de Node (un message préfixé de 5 octets), sans bibliothèque à ajouter.
const http2 = require('node:http2');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ADDRESS = 'http://localhost:31416';
const REGISTER = 70, CREATE_SESSION = 0, IMPORT = 2, GET_TRACKS = 3, SAVE = 18, VERSION = 55;
const SET_OUTPUT = 147, GET_OUTPUT = 165, SET_COLOR = 153, RENAME = 8, PALETTE = 156, DELETE_TRACKS = 157, SESSION_NAME = 42;
const FAILED = 4;

const varint = (n) => { const out = []; do { out.push((n & 127) | (n > 127 ? 128 : 0)); n = Math.floor(n / 128); } while (n); return Buffer.from(out); };
function field(number, value) {
  if (typeof value === 'number') return Buffer.concat([varint(number << 3), varint(value)]);
  const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return Buffer.concat([varint((number << 3) | 2), varint(data.length), data]);
}
/** { numéro: valeur } d'un message protobuf (varints et chaînes seulement, ce que PTSL renvoie ici). */
function fields(data) {
  const out = {};
  let i = 0;
  const read = () => { let n = 0, shift = 0, c; do { c = data[i++]; n += (c & 127) * 2 ** shift; shift += 7; } while (c >= 128); return n; };
  while (i < data.length) {
    const tag = read(), number = Math.floor(tag / 8), kind = tag & 7, n = read();
    if (kind === 2) { out[number] = data.subarray(i, i + n); i += n; } else out[number] = n;
  }
  return out;
}

class ProToolsError extends Error {}

class Client {
  async open() {
    this.version = [2023, 3, 0]; this.session = '';
    this.client = http2.connect(ADDRESS);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new ProToolsError('Pro Tools ne répond pas.')), 3000);
      this.client.once('connect', () => { clearTimeout(timer); resolve(); });
      this.client.once('error', () => { clearTimeout(timer); reject(new ProToolsError('Pro Tools n\'est pas ouvert (ou son interface de script est coupée). Ouvre-le, puis recommence.')); });
    });
    const v = await this.send(VERSION);
    this.version = [v.version ?? 2023, v.version_minor ?? 3, v.version_revision ?? 0];
    this.session = (await this.send(REGISTER, { company_name: 'ONIRIQUE', application_name: 'ONIRIQUE Session' })).session_id;
    return this;
  }

  close() { this.client?.close(); }

  /** Un appel gRPC unaire : POST /ptsl.PTSL/SendGrpcRequest, le message préfixé (0, longueur sur 4 octets). */
  call(message, timeout = 600_000) {
    return new Promise((resolve, reject) => {
      const req = this.client.request({ ':method': 'POST', ':path': '/ptsl.PTSL/SendGrpcRequest', 'content-type': 'application/grpc', te: 'trailers' });
      const chunks = [];
      let status = null, detail = '';
      const timer = setTimeout(() => { req.close(); reject(new ProToolsError('Pro Tools n\'a pas répondu à temps.')); }, timeout);
      req.on('response', (headers) => { if (headers['grpc-status'] !== undefined) { status = Number(headers['grpc-status']); detail = headers['grpc-message'] || ''; } });
      req.on('trailers', (trailers) => { status = Number(trailers['grpc-status'] ?? 0); detail = trailers['grpc-message'] || ''; });
      req.on('data', (c) => chunks.push(c));
      req.on('error', (e) => { clearTimeout(timer); reject(new ProToolsError(`Pro Tools : ${e.message}`)); });
      req.on('end', () => {
        clearTimeout(timer);
        if (status) return reject(new ProToolsError(`Pro Tools a refusé l'appel (${status}) : ${decodeURIComponent(detail)}`));
        const all = Buffer.concat(chunks);
        resolve(all.length >= 5 ? all.subarray(5, 5 + all.readUInt32BE(1)) : Buffer.alloc(0));
      });
      const head = Buffer.alloc(5);
      head.writeUInt32BE(message.length, 1);
      req.end(Buffer.concat([head, message]));
    });
  }

  async send(command, body) {
    const [major, minor, revision] = this.version;
    const header = Buffer.concat([field(1, crypto.randomUUID()), field(2, command), field(3, major), field(4, this.session), field(5, minor), field(6, revision)]);
    const reply = fields(await this.call(Buffer.concat([field(1, header), field(2, JSON.stringify(body || {}))])));
    const status = fields(reply[1] || Buffer.alloc(0))[3] || 0;
    const error = (reply[3] || Buffer.alloc(0)).toString('utf8');
    let warningsOnly = false; // un avertissement (paramètre déprécié…) n'empêche pas la commande d'aboutir
    try { warningsOnly = JSON.parse(error).errors.every((e) => e.is_warning); } catch { /* pas du JSON */ }
    if (status === FAILED || (error && !warningsOnly)) throw new ProToolsError(`Pro Tools a refusé la commande ${command} : ${error || 'sans détail'}`);
    const text = (reply[2] || Buffer.alloc(0)).toString('utf8');
    return text ? JSON.parse(text) : {};
  }
}

/** L'indice de la couleur de la palette de Pro Tools (« #AARRGGBB ») la plus proche, hors de celles déjà prises. */
function nearest(palette, rgb, taken) {
  const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
  const distance = (hex) => { const v = parseInt(hex.replace('#', '').slice(-6), 16); return (((v >> 16) & 255) - r) ** 2 + (((v >> 8) & 255) - g) ** 2 + ((v & 255) - b) ** 2; };
  let best = -1;
  for (let i = 0; i < palette.length; i++) if (!taken.has(i) && (best < 0 || distance(palette[i]) < distance(palette[best]))) best = i;
  return best;
}
/** ({ type: indice }, { bus: indice }) : un indice de palette par couleur, tous différents. */
function colors(palette, KIND_COLORS, GROUPS) {
  const byRgb = new Map();
  for (const rgb of [...new Set(Object.values(KIND_COLORS)), ...Object.values(GROUPS).map(([c]) => c)]) {
    if (!byRgb.has(rgb)) byRgb.set(rgb, nearest(palette, rgb, new Set(byRgb.values())));
  }
  return [Object.fromEntries(Object.entries(KIND_COLORS).map(([k, c]) => [k, byRgb.get(c)])),
    Object.fromEntries(Object.entries(GROUPS).map(([bus, [c]]) => [bus, byRgb.get(c)]))];
}

const documents = () => { try { return require('electron').app.getPath('documents'); } catch { return path.join(os.homedir(), 'Documents'); } };

/** Crée la session dans sessionDir, importe les stems, colore et route. Rend son chemin. */
async function build(plan, sessionDir, words, { groupOf, kindOf, GROUPS, KIND_COLORS }) {
  const pt = await new Client().open();
  try {
    const name = path.basename(sessionDir); // Pro Tools crée « <dossier>/<nom>/<nom>.ptx »
    let template = plan.template;
    const fallback = path.join(documents(), 'Pro Tools', 'Session Templates', 'ONIRIQUE', 'ONIRIQUE Session.ptxt');
    if (!template && fs.existsSync(fallback)) template = fallback; // ses aux DRUMS, BASS, MUSIC, VOX
    const body = { session_name: name, session_location: path.dirname(sessionDir), file_type: 'FT_WAVE',
      sample_rate: { 44100: 'SR_44100', 48000: 'SR_48000', 88200: 'SR_88200', 96000: 'SR_96000' }[plan.rate] || 'SR_48000',
      bit_depth: 'Bit24', input_output_settings: 'IO_Last', is_interleaved: true,
      is_cloud_project: false, create_from_template: false, create_from_aaf: false }; // Pro Tools 2026 exige ces champs
    if (template) Object.assign(body, { create_from_template: true, template_group: path.basename(path.dirname(template)), template_name: path.basename(template, path.extname(template)) });
    await pt.send(CREATE_SESSION, body);
    // Une session déjà ouverte (modifiée) peut empêcher la création sans erreur : on n'importe rien dans la mauvaise.
    if ((await pt.send(SESSION_NAME)).session_name !== name) {
      throw new ProToolsError('Pro Tools n\'a pas pu créer la session : ferme la session ouverte (sans dialogue en attente), puis recommence.');
    }
    const tracks = async () => (await pt.send(GET_TRACKS, { page_limit: 1000, track_filter_list: [{ filter: 'All', is_inverted: false }] })).track_list || [];
    let existing = await tracks();
    const palette = (await pt.send(PALETTE, { color_palette_target: 'CPTarget_Tracks' })).color_list || [];
    const [kinds, buses] = palette.length > new Set(Object.values(KIND_COLORS)).size + Object.keys(GROUPS).length ? colors(palette, KIND_COLORS, GROUPS) : [{}, {}];

    // Les bus : une piste audio de la template déjà routée vers un bus dit où envoyer les stems de sa famille.
    // shortcut: PTSL ne sait ni créer un bus ni régler l'entrée d'une aux : les bus viennent d'une template tant qu'Avid ne l'ouvre pas.
    const routes = {};
    for (const track of existing) {
      const group = groupOf(kindOf(track.name, words));
      if (['TT_Audio', 'TType_Audio', 'AudioTrack'].includes(track.type) && group && !routes[group]) {
        routes[group] = (await pt.send(GET_OUTPUT, { track_ids: [track.id] })).signalpath_ids || [];
      }
    }
    const refs = existing.filter((t) => t.name.endsWith('(routing)')).map((t) => t.name);
    if (refs.length) { await pt.send(DELETE_TRACKS, { track_names: refs }); existing = await tracks(); }

    // Les stems, importés un par un ; la nouvelle piste se retrouve par son id.
    const known = new Set(existing.map((t) => t.id));
    for (const stem of plan.stems) {
      await pt.send(IMPORT, { import_type: 'Audio', audio_data: {
        file_list: [stem.dest], audio_operations: 'CopyAudio', destination_path: path.join(sessionDir, 'Audio Files'),
        destination: 'MD_NewTrack', location: 'ML_SessionStart',
        location_data: { location_type: 'SLType_Start', location_value: '0', location_options: 'TOOptions_Samples' } } });
      const fresh = (await tracks()).filter((t) => !known.has(t.id));
      if (fresh.length !== 1) throw new ProToolsError(`Pro Tools n'a pas créé de piste pour ${path.basename(stem.dest)} : la limite de pistes de ta version de Pro Tools est peut-être atteinte (Intro : 8).`);
      known.add(fresh[0].id);
      await pt.send(RENAME, { track_id: fresh[0].id, current_name: fresh[0].name, new_name: stem.track });
      if (stem.kind in kinds) await pt.send(SET_COLOR, { track_ids: [fresh[0].id], color_index: kinds[stem.kind] + 1 });
    }
    for (const group of plan.groups) {
      const members = plan.stems.filter((s) => s.group === group.name).map((s) => s.track);
      if (routes[group.name]?.length) await pt.send(SET_OUTPUT, { track_names: members, signalpath_ids: routes[group.name] });
    }
    const aux = new Set(existing.filter((t) => ['TT_Aux', 'TType_Aux'].includes(t.type)).map((t) => t.name));
    for (const bus of Object.keys(GROUPS)) if (aux.has(bus) && bus in buses) await pt.send(SET_COLOR, { track_names: [bus], color_index: buses[bus] + 1 });
    await pt.send(SAVE);
    return path.join(sessionDir, name + '.ptx');
  } finally {
    pt.close();
  }
}

module.exports = { build, fields, field, colors, nearest, ProToolsError };
