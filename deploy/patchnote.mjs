// Publie une note de version (patch notes) sur le salon Discord d'ONIRIQUE, pour les changements qui comptent :
//
//   node deploy/patchnote.mjs notes.md     envoie la note
//   node deploy/patchnote.mjs --last       le dernier commit déjà annoncé (git log <commit>..origin/main : ce qui reste à annoncer)
//
// notes.md : une ligne « # Titre », puis des rubriques « ## Nom » suivies de leurs lignes (« - … »). L'adresse du webhook
// reste sur le serveur (/etc/onirique/discord-webhook) : elle n'est ni dans le dépôt ni sur les PC.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const HOST = 'root@217.160.106.244', LAST = '/etc/onirique/patchnote-last';
const ssh = (command, input) => execFileSync('ssh', ['-o', 'BatchMode=yes', HOST, command], { input, encoding: 'utf8' });

if (process.argv[2] === '--last') {
  process.stdout.write(ssh(`cat ${LAST} 2>/dev/null || true`));
  process.exit(0);
}
const file = process.argv[2];
if (!file) { console.error('Usage : node deploy/patchnote.mjs notes.md'); process.exit(1); }

// Une rubrique devient un encadré ; Discord en prend dix par message, 4096 caractères chacun, 6000 en tout.
const text = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
const title = (text.match(/^# (.+)$/m) || [])[1]?.trim() || 'Patch notes';
const embeds = text.split(/^## /m).slice(1).map((block) => {
  const [head, ...lines] = block.split('\n');
  return { title: head.trim().slice(0, 256), description: lines.join('\n').trim().slice(0, 4096), color: 0xE23444 };
}).filter((e) => e.description);
if (!embeds.length) { console.error('Aucune rubrique « ## … » dans la note.'); process.exit(1); }
const messages = [];
for (const embed of embeds) {
  const size = embed.title.length + embed.description.length, last = messages.at(-1);
  if (last && last.embeds.length < 10 && last.size + size <= 5800) { last.embeds.push(embed); last.size += size; }
  else messages.push({ embeds: [embed], size: size + title.length });
}
messages.forEach((m, i) => {
  const body = JSON.stringify({ username: 'ONIRIQUE', content: i ? undefined : `**${title}**`, embeds: m.embeds, allowed_mentions: { parse: [] } });
  ssh('curl -sS -f -o /dev/null -H "Content-Type: application/json" --data-binary @- "$(cat /etc/onirique/discord-webhook)"', body);
});
// Le dernier commit annoncé, pour savoir ce qui reste à annoncer la prochaine fois.
const head = execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim();
ssh(`printf %s ${head} > ${LAST}`);
console.log(`Note envoyée sur Discord (${messages.length} message${messages.length > 1 ? 's' : ''}).`);
