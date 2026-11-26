// Du dépôt de stems au projet : dossier, copies renommées, bus, correspondance avec la template, puis le DAW choisi.
// Repris d'ONIRIQUE Session (app/plan.py). Ce que la page envoie :
//   { daw: "fl" | "protools", template, info: { artist, title, feat, producer, engineer, bpm, key, genre, label, comments },
//     stems: [{ path, kind, file, track, seconds, rate }], words: [[kind, source regex]] }
const fs = require('node:fs');
const path = require('node:path');

// Chaque type part dans un bus ; l'instru complète et l'inclassable vont droit au master.
const GROUPS = {
  DRUMS: [0x40C4FF, ['Kick', 'Snare', 'Clap', 'Hi-Hat', 'Cymbale', 'Perc', 'Drums']], // bleu ciel
  BASS: [0x536DFE, ['808', 'Bass']],                                                 // indigo vif
  MUSIC: [0x64FFDA, ['Piano', 'Guitare', 'Synth', 'Melodie']],                       // aigue-marine
  VOX: [0xB388FF, ['Lead', 'Backs', 'Adlibs']],                                      // lavande
  FX: [0xFFF59D, ['FX']],                                                            // jaune pâle
};
// Une couleur par famille : le grave, la batterie, la mélodie, chaque voix, les effets.
const FAMILIES = [
  [0xE6194B, ['Kick', '808', 'Bass']], [0xF58231, ['Snare', 'Clap', 'Hi-Hat', 'Cymbale', 'Perc', 'Drums']],
  [0x3CB44B, ['Piano', 'Guitare', 'Synth', 'Melodie']], [0xF032E6, ['Lead']], [0x911EB4, ['Backs']], [0xFABED4, ['Adlibs']],
  [0xFFE119, ['FX']], [0xE8E8E8, ['Instru']], [0x90A4AE, ['Master']], [0xA9A9A9, ['Autre']],
];
const KIND_COLORS = Object.fromEntries(FAMILIES.flatMap(([color, kinds]) => kinds.map((k) => [k, color])));
const BUS_WORDS = /(^|[^a-z])(bus|buss|grp|group|groupe|sum|aux|mix|submix|stem)s?([^a-z]|$)/;
const BUS_WORDS_ALL = new RegExp(BUS_WORDS.source, 'g');

const groupOf = (kind) => Object.keys(GROUPS).find((g) => GROUPS[g][1].includes(kind)) || null;
/** Ce qu'un nom de fichier peut porter sur tous les systèmes (comme OniriqueStems.safe). */
const safe = (value) => String(value ?? '').replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '');
function projectName(info) {
  const artist = [safe(info.artist), safe(info.feat)].filter(Boolean).join(' x ');
  return [artist, safe(info.title)].filter(Boolean).join(' - ') || 'Session';
}
function uniqueDir(dir) {
  let candidate = dir, n = 2;
  while (fs.existsSync(candidate)) candidate = `${dir} (${n++})`;
  return candidate;
}
function kindOf(name, words) {
  const text = String(name).toLowerCase();
  for (const [kind, source] of words) { try { if (new RegExp(source).test(text)) return kind; } catch { /* motif illisible */ } }
  return null;
}

/** Rattache stems et bus aux pistes de la template qui portent leur nom : stem.match, group.match. */
function matchTemplate(slots, plan, words) {
  const names = slots.filter(Boolean), taken = new Set();
  for (const group of plan.groups) {
    for (const name of names) {
      const lower = name.toLowerCase(), plain = lower.replace(BUS_WORDS_ALL, ' ').trim();
      const isBus = BUS_WORDS.test(lower) || lower === group.name.toLowerCase();
      if (isBus && !taken.has(name) && (lower === group.name.toLowerCase() || groupOf(kindOf(plain, words)) === group.name)) {
        group.match = name; taken.add(name); break;
      }
    }
  }
  for (const stem of plan.stems) {
    for (const name of names) {
      if (!taken.has(name) && !BUS_WORDS.test(name.toLowerCase()) && kindOf(name, words) === stem.kind) { stem.match = name; taken.add(name); break; }
    }
  }
}

function buildPlan(request) {
  const stems = [...request.stems].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)); // le nom commence par l'ordre du pack
  for (const s of stems) Object.assign(s, { group: groupOf(s.kind), color: KIND_COLORS[s.kind] ?? KIND_COLORS.Autre });
  const groups = Object.entries(GROUPS).filter(([name]) => stems.some((s) => s.group === name)).map(([name, [color]]) => ({ name, color }));
  const rates = stems.map((s) => s.rate).filter(Boolean), count = {};
  for (const r of rates) count[r] = (count[r] || 0) + 1;
  const rate = rates.length ? Number(Object.keys(count).sort((a, b) => count[b] - count[a])[0]) : 48000;
  return { daw: request.daw, info: request.info, template: request.template || null, name: projectName(request.info), stems, groups, rate };
}

function notes(plan, info) {
  const now = new Date(), pad = (n) => String(n).padStart(2, '0');
  const created = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const rows = [['Artiste', info.artist], ['Featuring', info.feat], ['Titre', info.title], ['Producteur', info.producer], ['Ingé son', info.engineer],
    ['Label', info.label], ['Genre', info.genre], ['BPM', info.bpm], ['Tonalité', info.key], ['Créé le', created], ['Notes', info.comments]];
  const lines = rows.filter(([, v]) => v).map(([k, v]) => `${k} : ${v}`);
  lines.push('', 'Pistes :', ...plan.stems.map((s) => `  ${s.file}  ←  ${path.basename(s.path)}  (${s.kind}, bus ${s.group || 'master'})`));
  return lines.join('\n') + '\n';
}

/** Le champ « commentaires » des infos du projet dans le DAW : tout ce qui n'a pas de case à lui. */
function comments(info) {
  const parts = [['Prod', info.producer], ['Ingé', info.engineer], ['Label', info.label], ['Tonalité', info.key], ['BPM', info.bpm]];
  return [...parts.filter(([, v]) => v).map(([k, v]) => `${k} : ${v}`), ...(info.comments ? [info.comments] : [])].join('\n');
}

/** Crée le projet ; rend { folder, project } (chemins). */
async function create(request, words = request.words || []) {
  const plan = buildPlan(request);
  const root = uniqueDir(path.join(request.folder, safe(plan.name)));
  const typed = plan.info;
  plan.info = { ...typed, comments: comments(typed), artist: [typed.artist, typed.feat].filter(Boolean).join(' feat. ') };

  if (plan.daw === 'protools') {
    const protools = require('./protools'); // Pro Tools crée lui-même son dossier et y copie l'audio
    for (const s of plan.stems) s.dest = s.path;
    const project = await protools.build(plan, root, words, { groupOf, kindOf, GROUPS, KIND_COLORS });
    fs.writeFileSync(path.join(root, 'Infos.txt'), notes(plan, typed), 'utf8');
    return { folder: root, project };
  }
  if (plan.daw !== 'fl') throw new Error('LUNA se prépare dans l\'application ONIRIQUE Session : ce DAW n\'est pas encore dans CENTRAL.');

  const audio = path.join(root, 'Audio');
  fs.mkdirSync(audio, { recursive: true });
  try {
    for (const s of plan.stems) {
      s.dest = path.join(audio, s.file);
      fs.copyFileSync(s.path, s.dest);
    }
    fs.writeFileSync(path.join(root, 'Infos.txt'), notes(plan, typed), 'utf8');
    const flp = require('./flp');
    if (plan.template) matchTemplate(flp.describe(plan.template).slots.map((x) => x.name), plan, words);
    const project = path.join(root, safe(plan.name) + '.flp');
    flp.build(plan, project);
    return { folder: root, project };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true }); // le dossier vient d'être créé (uniqueDir) : rien d'autre dedans
    throw error;
  }
}

module.exports = { GROUPS, KIND_COLORS, groupOf, kindOf, safe, projectName, buildPlan, matchTemplate, notes, comments, create };
