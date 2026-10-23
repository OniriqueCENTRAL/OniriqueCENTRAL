// Recopie l'interface commune des plugins (plugin-ui/*.h) dans les dépôts des plugins, après avoir demandé à qui
// s'applique le changement :
//
//   node tools/plugin-ui.mjs           demande : « tes plugins » ou « les plugins de tout le monde »
//   node tools/plugin-ui.mjs --mes     tes plugins seulement : ta version va dans plugin-ui/<toi>/, la commune ne change pas
//   node tools/plugin-ui.mjs --tous    tous les plugins : la version commune change pour tout le monde
//   --qui=Nov                          à la place du nom git (git config user.name)
//
// À qui est quel plugin : plugin-ui/plugins.json. Les dépôts des plugins sont cherchés à côté de ce dépôt
// (../ONIRIQUE PLUGINS/<nom> ou ../<nom>) ; un plugin sans le fichier (partenaires, autre style) n'est pas touché.
// Rien n'est commité dans les plugins : chacun relit et pousse ses dépôts (un push peut publier une version).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execFileSync } from 'node:child_process';

const central = path.resolve(import.meta.dirname, '..');
const ui = path.join(central, 'plugin-ui');
const { proprietaires } = JSON.parse(fs.readFileSync(path.join(ui, 'plugins.json'), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: central, encoding: 'utf8' });
const args = process.argv.slice(2);
const same = (a, b) => a.replace(/\r/g, '') === b.replace(/\r/g, '');

const gitName = args.find((a) => a.startsWith('--qui='))?.slice(6) || git('config', 'user.name').trim();
const moi = Object.keys(proprietaires).find((o) => o === gitName || proprietaires[o].git.includes(gitName));
if (!moi) {
  console.error(`« ${gitName} » n'est dans aucune liste de plugin-ui/plugins.json : relancez avec --qui=<${Object.keys(proprietaires).join('|')}>.`);
  process.exit(1);
}
const owner = (plugin) => Object.keys(proprietaires).find((o) => proprietaires[o].plugins.includes(plugin));
const others = Object.keys(proprietaires).filter((o) => o !== moi).map((o) => `${o} (${proprietaires[o].plugins.join(', ')})`);

let choix = args.includes('--mes') ? 'mes' : args.includes('--tous') ? 'tous' : null;
const question = `Ce changement de D.A s'applique à :\n  1. tes plugins seulement (${proprietaires[moi].plugins.join(', ')})\n  2. les plugins de tout le monde, y compris ceux de ${others.join(' ; ')}`;
if (!choix) {
  if (!process.stdin.isTTY) {
    console.error(question + '\nRelancez avec --mes (1) ou --tous (2).');
    process.exit(2);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question + '\nTon choix (1 ou 2) : ')).trim();
  rl.close();
  choix = { 1: 'mes', 2: 'tous' }[answer];
  if (!choix) { console.error('Rien n\'a été fait.'); process.exit(1); }
}

// Les fichiers communs modifiés depuis le dernier commit.
const files = fs.readdirSync(ui).filter((f) => f.endsWith('.h'));
const changed = files.filter((f) => {
  const now = fs.readFileSync(path.join(ui, f), 'utf8');
  try { return !same(now, git('show', `HEAD:plugin-ui/${f}`)); } catch { return true; }
});
for (const f of changed) {
  if (choix === 'mes') {
    // Ta version devient la tienne, la commune revient à celle du dépôt.
    fs.mkdirSync(path.join(ui, moi), { recursive: true });
    fs.copyFileSync(path.join(ui, f), path.join(ui, moi, f));
    try { fs.writeFileSync(path.join(ui, f), git('show', `HEAD:plugin-ui/${f}`)); } catch { fs.rmSync(path.join(ui, f)); }
  } else {
    // Pour tout le monde : les versions personnelles de ce fichier disparaissent, sinon elles l'emporteraient.
    for (const o of Object.keys(proprietaires)) fs.rmSync(path.join(ui, o, f), { force: true });
  }
}

const findFile = (dir, name) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || /^build/i.test(entry.name) || entry.name === 'JuceLibraryCode') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { const found = findFile(p, name); if (found) return found; } else if (entry.name === name) return p;
  }
  return null;
};
const targets = choix === 'mes' ? proprietaires[moi].plugins : Object.values(proprietaires).flatMap((o) => o.plugins);
for (const plugin of targets) {
  const repo = [path.join(central, '..', 'ONIRIQUE PLUGINS', plugin), path.join(central, '..', plugin)].find((p) => fs.existsSync(path.join(p, 'Source')));
  if (!repo) { console.log(`${plugin} : pas de copie sur cet ordinateur, à faire chez son propriétaire (${owner(plugin)})`); continue; }
  const done = [];
  for (const f of fs.readdirSync(ui).filter((f) => f.endsWith('.h'))) {
    const own = path.join(ui, owner(plugin), f);
    const source = fs.readFileSync(fs.existsSync(own) ? own : path.join(ui, f), 'utf8');
    const target = findFile(path.join(repo, 'Source'), f);
    if (!target || same(fs.readFileSync(target, 'utf8'), source)) continue;
    fs.writeFileSync(target, source);
    done.push(path.relative(repo, target));
  }
  console.log(`${plugin} : ${done.length ? 'mis à jour (' + done.join(', ') + ')' : 'déjà à jour'}${owner(plugin) !== moi && done.length ? ` — plugin de ${owner(plugin)} : pense à prévenir ${owner(plugin)}` : ''}`);
}
console.log(`\nÀ commiter : plugin-ui/ dans ONIRIQUE CENTRAL, puis chaque dépôt de plugin mis à jour (un push peut publier une version).`);
