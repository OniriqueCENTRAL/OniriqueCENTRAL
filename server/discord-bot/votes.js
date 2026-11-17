// Votes de modération, 60 s avec des boutons Pour / Contre, adoptés avec au moins VOTE_MIN voix « Pour » et plus
// de « Pour » que de « Contre » :
// - /mute @membre 10m : rendu muet en vocal (il peut encore écrire). Discord ne rend muet que quelqu'un connecté à un
//   vocal : absent, il l'est dès qu'il en rejoint un ; la sanction est levée à l'heure dite, ou à son retour en vocal
//   si elle finit pendant qu'il n'y est pas. Liste gardée dans /var/lib/onirique-discord-bot/mutes.json.
// - /ban @membre 2h : « Exclure temporairement » de Discord (plus d'écrit ni de vocal), levé seul par Discord.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';

const COLOR = 0xE23444;
const VOTE_TIME = 60_000;
const MIN_VOTES = Math.max(1, Number(process.env.VOTE_MIN) || 3);
const MAX = 28 * 86_400_000; // limite de Discord pour une exclusion temporaire
const MUTES = process.env.MUTES_STATE || '/var/lib/onirique-discord-bot/mutes.json';
const UNITS = { s: 1000, m: 60_000, min: 60_000, h: 3_600_000, j: 86_400_000, d: 86_400_000 };

export const VOTE_COMMANDS = [
  ['mute', 'Propose un vote de 60 s pour rendre muet un membre en vocal un moment'],
  ['ban', 'Propose un vote de 60 s pour exclure temporairement un membre (plus d’écrit ni de vocal)'],
].map(([name, description]) => ({
  name, description,
  options: [
    { name: 'membre', description: 'La personne visée', type: 6, required: true },
    { name: 'durée', description: 'Par exemple 10m, 2h ou 1j', type: 3, required: true },
  ],
}));

// « 10m », « 2h », « 1j30m », « 90 » (minutes) → millisecondes.
export function parseDuration(text) {
  const s = String(text).trim().toLowerCase().replace(/\s+/g, '');
  let ms = 0;
  if (/^\d+$/.test(s)) ms = Number(s) * 60_000;
  else {
    const parts = [...s.matchAll(/(\d+)(min|s|m|h|j|d)/g)];
    if (!parts.length || parts.map((p) => p[0]).join('') !== s) throw new Error('Durée illisible : écris par exemple 10m, 2h ou 1j.');
    for (const [, n, u] of parts) ms += Number(n) * UNITS[u];
  }
  if (ms < 60_000) throw new Error('La durée minimale est 1 minute.');
  if (ms > MAX) throw new Error(`La durée maximale est ${formatDuration(MAX)}.`);
  return ms;
}

export function formatDuration(ms) {
  const parts = [];
  for (const [label, size] of [['j', 86_400_000], ['h', 3_600_000], ['min', 60_000]]) {
    const n = Math.floor(ms / size);
    if (n) { parts.push(`${n} ${label}`); ms -= n * size; }
  }
  return parts.join(' ') || 'moins d’une minute';
}

// votes : Map id du votant → true (pour) / false (contre).
export function tally(votes, min = MIN_VOTES) {
  let yes = 0, no = 0;
  for (const v of votes.values()) v ? yes++ : no++;
  return { yes, no, passed: yes >= min && yes > no };
}

// Mutes vocaux votés : [{ guildId, userId, until }].
export function loadMutes(file = MUTES) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return []; }
}
export function saveMutes(list, file = MUTES) {
  try { writeFileSync(`${file}.tmp`, JSON.stringify(list)); renameSync(`${file}.tmp`, file); } catch (e) { console.error('Mutes :', e.message); }
}
const same = (a, b) => a.guildId === b.guildId && a.userId === b.userId;
const forget = (entry) => saveMutes(loadMutes().filter((m) => !(same(m, entry) && m.until === entry.until)));

const running = new Set(); // `${serveur}:${membre}` : un seul vote à la fois par personne

// Ce qui empêche le vote, ou null.
function refusal(i, kind, target) {
  if (!target) return 'Cette personne n’est pas sur le serveur.';
  if (target.user.bot) return 'On ne vote pas contre un bot.';
  if (target.id === i.user.id) return 'Tu ne peux pas lancer un vote contre toi-même.';
  if (target.id === i.guild.ownerId || target.permissions.has(PermissionFlagsBits.Administrator)) return 'Impossible de voter contre un administrateur.';
  const me = i.guild.members.me;
  if (kind === 'mute' && !me.permissions.has(PermissionFlagsBits.MuteMembers)) return 'Le bot n’a pas la permission « Rendre les membres muets ».';
  if (kind === 'ban' && !me.permissions.has(PermissionFlagsBits.ModerateMembers)) return 'Le bot n’a pas la permission « Exclure temporairement des membres ».';
  if (kind === 'ban' && !target.moderatable) return `Le rôle du bot doit être placé au-dessus de celui de ${target} dans les rôles du serveur.`;
  if (running.has(`${i.guildId}:${target.id}`)) return `Un vote contre ${target} est déjà en cours.`;
  return null;
}

const buttons = (disabled) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('vote:yes').setLabel('Pour').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(disabled),
  new ButtonBuilder().setCustomId('vote:no').setLabel('Contre').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(disabled),
);

export async function startVote(i) {
  const kind = i.commandName;
  const target = i.options.getMember('membre');
  const refused = refusal(i, kind, target);
  if (refused) return i.reply({ content: refused, flags: MessageFlags.Ephemeral });
  let ms;
  try { ms = parseDuration(i.options.getString('durée', true)); } catch (e) { return i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); }

  const key = `${i.guildId}:${target.id}`;
  running.add(key);
  const end = Math.floor((Date.now() + VOTE_TIME) / 1000);
  const votes = new Map([[i.user.id, true]]); // la personne qui lance le vote vote « Pour »
  const view = (closed, result) => {
    const { yes, no } = tally(votes);
    return new EmbedBuilder().setColor(COLOR)
      .setTitle(kind === 'mute' ? '🔇 Vote : mute vocal' : '⛔ Vote : exclusion temporaire')
      .setDescription(`${i.user} propose ${kind === 'mute' ? 'de rendre muet en vocal' : 'd’exclure'} ${target} pendant **${formatDuration(ms)}**.\n` +
        `Il faut au moins **${MIN_VOTES}** voix « Pour », et plus de « Pour » que de « Contre ».\n` +
        (closed ? `\n${result}` : `\nFin du vote <t:${end}:R>.`))
      .addFields({ name: '✅ Pour', value: String(yes), inline: true }, { name: '❌ Contre', value: String(no), inline: true });
  };

  try {
    const { resource } = await i.reply({ embeds: [view(false)], components: [buttons(false)], withResponse: true });
    const message = resource.message;
    const collector = message.createMessageComponentCollector({ time: VOTE_TIME });
    collector.on('collect', async (b) => {
      if (b.user.id === target.id) return b.reply({ content: 'Tu ne peux pas voter sur ton propre cas.', flags: MessageFlags.Ephemeral }).catch(() => {});
      votes.set(b.user.id, b.customId === 'vote:yes');
      await b.update({ embeds: [view(false)] }).catch(() => {});
    });
    collector.on('end', async () => {
      running.delete(key);
      let result = '❎ Vote rejeté.';
      if (tally(votes).passed) {
        const reason = `Vote lancé par ${i.user.tag}, ${formatDuration(ms)}`;
        try {
          result = kind === 'mute' ? await voiceMute(target, ms, reason) : await exclude(target, ms, reason);
        } catch (e) {
          console.error('Vote :', e.message);
          result = `⚠️ Vote adopté, mais Discord a refusé : ${e.message}`;
        }
      }
      await message.edit({ embeds: [view(true, result)], components: [buttons(true)] }).catch(() => {});
    });
  } catch (e) {
    running.delete(key);
    throw e;
  }
}

async function exclude(target, ms, reason) {
  await target.timeout(ms, reason);
  return `⛔ Vote adopté : ${target} est exclu pendant ${formatDuration(ms)}.`;
}

async function voiceMute(target, ms, reason) {
  const entry = { guildId: target.guild.id, userId: target.id, until: Date.now() + ms };
  saveMutes([...loadMutes().filter((m) => !same(m, entry)), entry]);
  const when = `<t:${Math.floor(entry.until / 1000)}:R>`;
  if (!target.voice.channelId) return `🔇 Vote adopté : ${target} sera muet dès qu’il rejoindra un vocal (fin ${when}).`;
  await target.voice.setMute(true, reason);
  return `🔇 Vote adopté : ${target} est muet en vocal pendant ${formatDuration(ms)} (fin ${when}).`;
}

// Lève les mutes arrivés à terme (chaque minute) et applique ou lève ceux des membres qui rejoignent un vocal.
export function watchMutes(client) {
  const check = async () => {
    const now = Date.now();
    for (const m of loadMutes().filter((m) => m.until <= now)) {
      const guild = client.guilds.cache.get(m.guildId);
      if (!guild) { forget(m); continue; }
      const member = await guild.members.fetch(m.userId).catch((e) => (e.code === 10007 ? null : undefined)); // 10007 : a quitté le serveur
      if (member === null) { forget(m); continue; }
      if (!member?.voice.channelId) continue; // absent du vocal : levé à son retour
      await member.voice.setMute(false, 'Fin du mute voté').then(() => forget(m), (e) => console.error('Fin du mute :', e.message));
    }
  };
  check();
  setInterval(check, 60_000);

  client.on('voiceStateUpdate', async (before, after) => {
    if (!after.channelId || before.channelId === after.channelId) return; // seulement en rejoignant ou en changeant de vocal
    const entry = loadMutes().find((m) => m.guildId === after.guild.id && m.userId === after.id);
    if (!entry) return;
    try {
      if (entry.until <= Date.now()) {
        if (after.serverMute) await after.setMute(false, 'Fin du mute voté');
        forget(entry);
      } else if (!after.serverMute) await after.setMute(true, 'Mute voté');
    } catch (e) { console.error('Mute vocal :', e.message); }
  });
}
