// Votes de modération, 60 s avec des boutons Pour / Contre, adoptés avec au moins VOTE_MIN voix « Pour » et plus
// de « Pour » que de « Contre » :
// - /mute @membre 10m : rendu muet en vocal (il peut encore écrire). Discord ne rend muet que quelqu'un connecté à un
//   vocal : absent, il l'est dès qu'il en rejoint un ; la sanction est levée à l'heure dite, ou à son retour en vocal
//   si elle finit pendant qu'il n'y est pas. Liste gardée dans /var/lib/onirique-discord-bot/mutes.json.
// - /ban @membre 2h : « Exclure temporairement » de Discord (plus d'écrit ni de vocal), levé seul par Discord.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { VOTE_TIME, MIN_VOTES, parseDuration, formatDuration, tally, loadMutes, saveMutes, same, forget } from './vote-rules.js';

export { VOTE_COMMANDS } from './vote-rules.js';

const COLOR = 0xE23444;

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
      await b.update({ embeds: [view(false)] }).catch((e) => console.error('Vote :', e.message));
    });
    collector.on('end', async () => {
      running.delete(key);
      const { yes, no } = tally(votes);
      let result = yes < MIN_VOTES ? `❎ Vote rejeté : ${yes} « Pour » sur les ${MIN_VOTES} nécessaires.` : `❎ Vote rejeté : ${no} « Contre » pour ${yes} « Pour ».`;
      if (tally(votes).passed) {
        const reason = `Vote lancé par ${i.user.tag}, ${formatDuration(ms)}`;
        try {
          result = kind === 'mute' ? await voiceMute(target, ms, reason) : await exclude(target, ms, reason);
        } catch (e) {
          console.error('Vote :', e.message);
          result = `⚠️ Vote adopté, mais Discord a refusé : ${e.message}`;
        }
      }
      console.log(`Vote ${kind} contre ${target.user.tag} : ${yes} pour, ${no} contre. ${result}`);
      // Par la réponse à la commande (valable 15 min) : la modifier comme un message ordinaire échouait en silence.
      await i.editReply({ embeds: [view(true, result)], components: [buttons(true)] }).catch((e) => console.error('Fin du vote :', e.message));
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
  // Demandé directement à Discord : le cache des vocaux du bot peut croire la personne absente alors qu'elle parle.
  const ok = await setServerMute(target.guild, target.id, true, reason);
  if (!ok) return `🔇 Vote adopté : ${target} sera muet dès qu’il rejoindra un vocal (fin ${when}).`;
  return `🔇 Vote adopté : ${target} est muet en vocal pendant ${formatDuration(ms)} (fin ${when}).`;
}

// true si c'est fait, false si la personne n'est pas en vocal (erreur 40032 de Discord).
async function setServerMute(guild, userId, mute, reason) {
  try {
    await guild.members.edit(userId, { mute, reason });
    return true;
  } catch (e) {
    if (e.code === 40032) return false;
    throw e;
  }
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
      if (!member) continue;
      // absent du vocal : levé à son retour
      await setServerMute(guild, m.userId, false, 'Fin du mute voté').then((ok) => ok && forget(m), (e) => console.error('Fin du mute :', e.message));
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
