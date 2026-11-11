// Le bot musique ONIRIQUE sur Discord : /play joue un son cherché par son nom ou un lien YouTube / SoundCloud (yt-dlp),
// un lien d'écoute ONIRIQUE (un titre, un projet ou un pack entier) ou l'adresse d'un fichier audio, dans le salon
// vocal de la personne. Une file par serveur Discord.
// Tourne sur le VPS à côté de l'API (service onirique-discord-bot, réglé par deploy/onirique-discord).
import { Client, GatewayIntentBits, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, AudioPlayerStatus,
  VoiceConnectionStatus, entersState, NoSubscriberBehavior,
} from '@discordjs/voice';
import { tracksOf } from './tracks.js';
import { resourceOf } from './audio.js';

const API = (process.env.ONIRIQUE_API || 'http://127.0.0.1:4850').replace(/\/+$/, '');
const COLOR = 0xE23444;
const MAX_QUEUE = 200;          // titres en attente par serveur
const LOAD_TIMEOUT = 30_000;    // un titre qui ne démarre pas en 30 s est passé
const ALONE_TIMEOUT = 60_000;   // seul dans le salon depuis 1 min : le bot s'en va
// id du serveur Discord → { player, connection, tracks, current, channel, skipping, alone, loading }
const queues = new Map();

const COMMANDS = [
  { name: 'play', description: 'Joue un son : son nom, un lien YouTube ou un lien d’écoute ONIRIQUE', options: [{ name: 'son', description: 'Nom du son (« ninho jefe »), lien YouTube ou onirique.store/ecoute?t=…', type: 3, required: true }] },
  { name: 'skip', description: 'Passe au titre suivant' },
  { name: 'pause', description: 'Met en pause ou reprend la lecture' },
  { name: 'stop', description: 'Arrête la musique et quitte le salon' },
  { name: 'file', description: 'Montre le titre en cours et ce qui suit' },
];

const embed = (title, description) => new EmbedBuilder().setColor(COLOR).setTitle(title).setDescription(description || null);
const line = (t) => `**${t.title.slice(0, 120)}**${t.artist ? ` · ${t.artist.slice(0, 60)}` : ''}`;
const say = (q, message) => q.channel.send(typeof message === 'string' ? message : { embeds: [message] }).catch(() => {});
const botChannelId = (q) => q.connection.joinConfig.channelId;

// Quitter le salon et oublier la file ; sans danger si c'est déjà fait.
function leave(guildId) {
  const q = queues.get(guildId);
  if (!q) return;
  queues.delete(guildId);
  clearTimeout(q.alone);
  clearTimeout(q.loading);
  q.tracks = [];
  q.player.state.resource?.metadata.kill();
  q.player.stop(true);
  if (q.connection.state.status !== VoiceConnectionStatus.Destroyed) q.connection.destroy();
}

function next(guildId) {
  const q = queues.get(guildId);
  if (!q) return;
  q.skipping = false;
  clearTimeout(q.loading);
  q.current = q.tracks.shift() || null;
  if (!q.current) return leave(guildId);
  const resource = resourceOf(q.current);
  q.player.play(resource);
  // yt-dlp ou ffmpeg bloqué (réseau, YouTube) : le titre est passé au lieu de garder le salon muet.
  q.loading = setTimeout(() => { if (q.player.state.resource === resource && resource.playbackDuration === 0) q.player.stop(true); }, LOAD_TIMEOUT);
  if (!q.current.retried) say(q, embed('▶ En lecture', line(q.current)).setThumbnail(q.current.cover || null));
}

function createQueue(i, voice) {
  const guildId = i.guildId;
  const connection = joinVoiceChannel({ channelId: voice.id, guildId, adapterCreator: i.guild.voiceAdapterCreator, selfDeaf: true });
  // Pendant une coupure de la connexion, le titre continue au lieu de se mettre en pause pour toujours.
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  connection.subscribe(player);
  const q = { player, connection, tracks: [], current: null, channel: i.channel, skipping: false, alone: null, loading: null };
  queues.set(guildId, q);

  player.on('stateChange', (before, after) => {
    if (after.status !== AudioPlayerStatus.Idle || before.status === AudioPlayerStatus.Idle) return;
    const { track, kill } = before.resource.metadata;
    kill();
    if (queues.get(guildId) !== q) return;
    // Fini sans avoir rien joué, et pas passé à la main : YouTube a refusé, lien mort, fichier illisible.
    // Un son YouTube est retenté une fois (refus passager de YouTube) avant d'être déclaré illisible.
    if (before.resource.playbackDuration < 1500 && !q.skipping) {
      if (track.yt && !track.retried) q.tracks.unshift({ ...track, retried: true });
      else say(q, `⚠️ Impossible de lire ${line(track)}, titre passé.`);
    }
    next(guildId);
  });
  player.on('error', (e) => console.error('Lecture :', e.message));
  connection.on('error', (e) => console.error('Salon vocal :', e.message));
  // Déconnecté (kick, salon supprimé, coupure réseau) : 5 s pour revenir, sinon la file s'arrête.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5000), entersState(connection, VoiceConnectionStatus.Connecting, 5000)]);
    } catch {
      if (queues.get(guildId) === q) leave(guildId);
    }
  });
  connection.on(VoiceConnectionStatus.Destroyed, () => { if (queues.get(guildId) === q) leave(guildId); });
  return q;
}

// Une autre personne ne pilote pas la musique depuis un autre salon.
function notHere(i, q) {
  const voice = i.member?.voice?.channel;
  if (!voice) return "Rejoins d'abord un salon vocal.";
  if (q && voice.id !== botChannelId(q)) return `La musique tourne dans <#${botChannelId(q)}> : rejoins ce salon.`;
  return null;
}

async function play(i) {
  const voice = i.member?.voice?.channel;
  let q = queues.get(i.guildId);
  const refused = notHere(i, q);
  if (refused) return i.reply({ content: refused, flags: MessageFlags.Ephemeral });
  // Salon plein (limite de places) ou sans droit Se connecter : Discord ignore la demande sans rien répondre.
  if (!q && !voice.joinable) {
    const why = voice.full ? `**${voice.name}** est plein (${voice.userLimit} places) : agrandis la limite, ou donne au bot la permission « Déplacer des membres ».` : `Le bot n'a pas le droit de se connecter à **${voice.name}**.`;
    return i.reply({ content: why, flags: MessageFlags.Ephemeral });
  }
  await i.deferReply();
  let tracks;
  try {
    tracks = await tracksOf(i.options.getString('son', true), API);
  } catch (e) {
    return i.editReply(`⚠️ ${e.message || 'Impossible de lire ce son.'}`);
  }
  q = queues.get(i.guildId);
  if (q && notHere(i, q)) return i.editReply(notHere(i, q)); // la recherche a pris du temps : la situation a pu changer
  if (!q) {
    q = createQueue(i, voice);
    try {
      await entersState(q.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      leave(i.guildId);
      return i.editReply('⚠️ Impossible de rejoindre le salon vocal, réessaie dans un instant.');
    }
    if (queues.get(i.guildId) !== q) return i.editReply('⏹ Musique arrêtée entre-temps.');
  }
  const room = MAX_QUEUE - q.tracks.length;
  if (room <= 0) return i.editReply(`⚠️ La file est pleine (${MAX_QUEUE} titres).`);
  const added = tracks.slice(0, room);
  q.tracks.push(...added);
  const cut = tracks.length > added.length ? ` (${tracks.length - added.length} laissés de côté : file pleine)` : '';
  await i.editReply({ embeds: [embed('ONIRIQUE', added.length > 1 ? `${added.length} titres ajoutés : ${line(added[0])}…${cut}` : `Ajouté : ${line(added[0])}`)] });
  if (!q.current) next(i.guildId);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once('clientReady', async () => {
  await client.application.commands.set(COMMANDS);
  console.log(`Connecté en tant que ${client.user.tag} sur ${client.guilds.cache.size} serveur(s).`);
});

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand() || !i.guildId) return;
  const q = queues.get(i.guildId);
  const private_ = (content) => i.reply({ content, flags: MessageFlags.Ephemeral });
  try {
    if (i.commandName === 'play') return await play(i);
    if (i.commandName === 'file') {
      if (!q?.current) return private_('La file est vide.');
      const rest = q.tracks.slice(0, 10).map((t, n) => `${n + 1}. ${line(t)}`).join('\n');
      const more = q.tracks.length > 10 ? `\n… et ${q.tracks.length - 10} autre(s)` : '';
      return i.reply({ embeds: [embed('File d’attente', `▶ ${line(q.current)}${rest ? `\n\n${rest}${more}` : ''}`)] });
    }
    if (!q?.current) return private_('Rien en lecture.');
    const refused = notHere(i, q);
    if (refused) return private_(refused);
    switch (i.commandName) {
      case 'skip':
        q.skipping = true;
        q.player.stop(true); // passe en Idle, qui lance le suivant
        return i.reply('⏭ Titre suivant.');
      case 'pause':
        if (q.player.state.status === AudioPlayerStatus.Paused) { q.player.unpause(); return i.reply('▶ Reprise.'); }
        q.player.pause();
        return i.reply('⏸ En pause.');
      case 'stop':
        leave(i.guildId);
        return i.reply('⏹ Musique arrêtée.');
    }
  } catch (e) {
    console.error(e);
    const msg = { content: 'Une erreur est survenue, réessaie.', flags: MessageFlags.Ephemeral };
    (i.deferred || i.replied ? i.followUp(msg) : i.reply(msg)).catch(() => {});
  }
});

// Seul dans le salon (tout le monde est parti) : le bot attend une minute, puis s'en va.
client.on('voiceStateUpdate', (before, after) => {
  const guild = after.guild, q = queues.get(guild.id);
  if (!q) return;
  const humans = guild.channels.cache.get(botChannelId(q))?.members.filter((m) => !m.user.bot).size ?? 0;
  if (humans > 0) { clearTimeout(q.alone); q.alone = null; return; }
  q.alone ??= setTimeout(() => {
    if (queues.get(guild.id) !== q) return;
    leave(guild.id);
    say(q, '👋 Plus personne dans le salon : musique arrêtée.');
  }, ALONE_TIMEOUT);
});

client.on('error', (e) => console.error('Discord :', e.message));
process.on('unhandledRejection', (e) => console.error('Non géré :', e));

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error('DISCORD_BOT_TOKEN manquant (onirique-discord sur le VPS).');
  process.exit(1);
}
client.login(process.env.DISCORD_BOT_TOKEN);
