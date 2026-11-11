// Publie une note de version (patch notes) sur le salon Discord d'ONIRIQUE (celle de la journée part chaque soir) :
//
//   node deploy/patchnote.mjs notes.md     envoie la note
//   node deploy/patchnote.mjs --last       le dernier commit déjà annoncé (git log <commit>..origin/main : ce qui reste à annoncer)
//
// notes.md : une ligne « # Titre », puis des rubriques « ## Nom » suivies de leurs lignes (« - … »). L'adresse du webhook
// reste sur le serveur (/etc/onirique/discord-webhook) : elle n'est ni dans le dépôt ni sur les PC.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const HOST = 'root@212.227.165.177', LAST = '/etc/onirique/patchnote-last';
const ssh = (command, input) => execFileSync('ssh', ['-o', 'BatchMode=yes', HOST, command], { input, encoding: 'utf8' });

if (process.argv[2] === '--last') {
  process.stdout.write(ssh(`cat ${LAST} 2>/dev/null || true`));
  process.exit(0);
}
const file = process.argv[2];
if (!file) { console.error('Usage : node deploy/patchnote.mjs notes.md'); process.exit(1); }

// Une rubrique devient un encadré, avec la vignette de sa catégorie (tools/patchnotes, servies par le site) ; la bannière
// ouvre la note. Discord prend dix encadrés par message, 4096 caractères chacun, 6000 en tout.
const IMG = 'https://onirique.store/assets/patchnotes', V = '?v=1', COLOR = 0xE23444;
// Les rubriques « des packs » ont leur propre image : mails et YouTube passent avant packs.
const KINDS = [['mail', 'mails'], ['youtube', 'youtube'], ['cloud', 'cloud'], ['pack', 'packs'], ['plugin', 'plugins'], ['navigateur', 'navigateur'],
  ['discord', 'discord'], ['bot', 'discord'], ['appli', 'application'], ['site', 'site'], ['boutique', 'site'], ['correctif', 'correctifs']];
const kindOf = (head) => (KINDS.find(([word]) => head.toLowerCase().includes(word)) || [, 'autre'])[1];

const text = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
const title = (text.match(/^# (.+)$/m) || [])[1]?.trim() || 'Patch notes';
const embeds = text.split(/^## /m).slice(1).map((block) => {
  const [head, ...lines] = block.split('\n');
  return { title: head.trim().slice(0, 256), description: lines.join('\n').trim().slice(0, 4096), color: COLOR, thumbnail: { url: `${IMG}/${kindOf(head)}.png${V}` } };
}).filter((e) => e.description);
if (!embeds.length) { console.error('Aucune rubrique « ## … » dans la note.'); process.exit(1); }
embeds.unshift({ author: { name: 'ONIRIQUE · Patch notes', icon_url: 'https://onirique.store/assets/logo-small.png', url: 'https://onirique.store' },
  title: title.slice(0, 256), color: COLOR, image: { url: `${IMG}/banner.png${V}` } });
Object.assign(embeds.at(-1), { footer: { text: 'onirique.store', icon_url: 'https://onirique.store/assets/logo-small.png' }, timestamp: new Date().toISOString() });
const messages = [];
for (const embed of embeds) {
  const size = embed.title.length + (embed.description?.length || 0) + 60, last = messages.at(-1);
  if (last && last.embeds.length < 10 && last.size + size <= 5800) { last.embeds.push(embed); last.size += size; }
  else messages.push({ embeds: [embed], size });
}
// Envoyée par le bot ONIRIQUE dans le salon des patch notes (/etc/onirique/patchnote-channel : celui du webhook) ;
// sans bot (onirique-discord off), par le webhook lui-même.
const SEND = `if [ -f /etc/onirique/discord-bot.env ] && [ -s /etc/onirique/patchnote-channel ]; then . /etc/onirique/discord-bot.env;
  curl -sS -f -o /dev/null -H "Authorization: Bot $DISCORD_BOT_TOKEN" -H "Content-Type: application/json" --data-binary @- "https://discord.com/api/v10/channels/$(cat /etc/onirique/patchnote-channel)/messages";
else curl -sS -f -o /dev/null -H "Content-Type: application/json" --data-binary @- "$(cat /etc/onirique/discord-webhook)"; fi`;
for (const m of messages) ssh(SEND, JSON.stringify({ embeds: m.embeds, allowed_mentions: { parse: [] } }));
// Le dernier commit annoncé, pour savoir ce qui reste à annoncer la prochaine fois.
const head = execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim();
ssh(`printf %s ${head} > ${LAST}`);
console.log(`Note envoyée sur Discord (${messages.length} message${messages.length > 1 ? 's' : ''}).`);
