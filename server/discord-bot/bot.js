// Le bot musique ONIRIQUE sur Discord : /play joue un son cherché par son nom ou un lien YouTube (yt-dlp), un lien
// d'écoute ONIRIQUE (un titre, un projet ou un pack entier) ou l'adresse d'un fichier audio, dans le salon vocal de la
// personne. Une file par serveur Discord.
// Tourne sur le VPS à côté de l'API (service onirique-discord-bot, réglé par deploy/onirique-discord).
import { spawn } from 'node:child_process';
import { Client, GatewayIntentBits, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType,
  VoiceConnectionStatus, entersState, getVoiceConnection,
} from '@discordjs/voice';
import { tracksOf, YTDLP } from './tracks.js';

const API = (process.env.ONIRIQUE_API || 'http://127.0.0.1:4850').replace(/\/+$/, '');
const COLOR = 0xE23444;
const queues = new Map(); // id du serveur Discord → { player, tracks, current, channel }

const COMMANDS = [
  { name: 'play', description: 'Joue un son : son nom, un lien YouTube ou un lien d’écoute ONIRIQUE', options: [{ name: 'son', description: 'Nom du son (« ninho jefe »), lien YouTube ou onirique.store/ecoute?t=…', type: 3, required: true }] },
  { name: 'skip', description: 'Passe au titre suivant' },
  { name: 'pause', description: 'Met en pause ou reprend la lecture' },
  { name: 'stop', description: 'Arrête la musique et quitte le salon' },
  { name: 'file', description: "Montre le titre en cours et ce qui suit" },
];

// ffmpeg sort de l'Ogg Opus : rien à encoder côté Node. Un son YouTube arrive par yt-dlp, au moment de le jouer.
const OUT = ['-vn', '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-f', 'ogg', '-loglevel', 'error', 'pipe:1'];
const resourceOf = (track) => {
  let ff;
  if (track.yt) {
    const yt = spawn(YTDLP, ['--js-runtimes', 'node', '-f', 'bestaudio/best', '--no-playlist', '--no-warnings', '-q', '-o', '-', track.url], { stdio: ['ignore', 'pipe', 'inherit'] });
    ff = spawn('ffmpeg', ['-i', 'pipe:0', ...OUT], { stdio: ['pipe', 'pipe', 'inherit'] });
    yt.stdout.pipe(ff.stdin);
    ff.stdin.on('error', () => {}); // ffmpeg arrêté (titre passé) : yt-dlp écrit dans le vide
    ff.on('close', () => yt.kill());
  } else {
    // L'adresse vient d'un membre Discord : ffmpeg ne suit que du http(s), jamais un fichier du VPS (playlist piégée).
    ff = spawn('ffmpeg', ['-protocol_whitelist', 'http,https,tcp,tls', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-i', track.url, ...OUT],
      { stdio: ['ignore', 'pipe', 'inherit'] });
  }
  return createAudioResource(ff.stdout, { inputType: StreamType.OggOpus, metadata: track });
};

const embed = (title, description) => new EmbedBuilder().setColor(COLOR).setTitle(title).setDescription(description || null);
const line = (t) => `**${t.title}**${t.artist ? ` · ${t.artist}` : ''}`;

function next(guildId) {
  const q = queues.get(guildId);
  if (!q) return;
  q.current = q.tracks.shift() || null;
  if (!q.current) {
    getVoiceConnection(guildId)?.destroy();
    queues.delete(guildId);
    return;
  }
  q.player.play(resourceOf(q.current));
  q.channel.send({ embeds: [embed('▶ En lecture', line(q.current)).setThumbnail(q.current.cover || null)] }).catch(() => {});
}

async function play(i) {
  const voice = i.member?.voice?.channel;
  if (!voice) return i.reply({ content: "Rejoins d'abord un salon vocal.", flags: MessageFlags.Ephemeral });
  await i.deferReply();
  let tracks;
  try {
    tracks = await tracksOf(i.options.getString('son', true), API);
  } catch (e) {
    return i.editReply(e.message || "Impossible de lire ce lien.");
  }
  let q = queues.get(i.guildId);
  if (!q) {
    const connection = joinVoiceChannel({ channelId: voice.id, guildId: i.guildId, adapterCreator: i.guild.voiceAdapterCreator, selfDeaf: true });
    const player = createAudioPlayer();
    connection.subscribe(player);
    q = { player, tracks: [], current: null, channel: i.channel };
    queues.set(i.guildId, q);
    player.on(AudioPlayerStatus.Idle, () => next(i.guildId));
    player.on('error', (e) => { console.error('Lecture :', e.message); });
    // Déconnecté du salon (kick, salon supprimé) : on essaie de revenir 5 s, sinon on laisse tomber la file.
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5000), entersState(connection, VoiceConnectionStatus.Connecting, 5000)]);
      } catch {
        connection.destroy();
        queues.delete(i.guildId);
      }
    });
  }
  q.tracks.push(...tracks);
  const added = tracks.length > 1 ? `${tracks.length} titres ajoutés : ${line(tracks[0])}…` : `Ajouté : ${line(tracks[0])}`;
  await i.editReply({ embeds: [embed('ONIRIQUE', added)] });
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
  try {
    switch (i.commandName) {
      case 'play': return await play(i);
      case 'skip':
        if (!q?.current) return i.reply({ content: 'Rien en lecture.', flags: MessageFlags.Ephemeral });
        q.player.stop(); // passe en Idle, qui lance le suivant
        return i.reply('⏭ Titre suivant.');
      case 'pause':
        if (!q?.current) return i.reply({ content: 'Rien en lecture.', flags: MessageFlags.Ephemeral });
        if (q.player.state.status === AudioPlayerStatus.Paused) { q.player.unpause(); return i.reply('▶ Reprise.'); }
        q.player.pause();
        return i.reply('⏸ En pause.');
      case 'stop':
        if (q) { q.tracks = []; q.player.stop(); }
        getVoiceConnection(i.guildId)?.destroy();
        queues.delete(i.guildId);
        return i.reply('⏹ Musique arrêtée.');
      case 'file': {
        if (!q?.current) return i.reply({ content: 'La file est vide.', flags: MessageFlags.Ephemeral });
        const rest = q.tracks.slice(0, 10).map((t, n) => `${n + 1}. ${line(t)}`).join('\n');
        const more = q.tracks.length > 10 ? `\n… et ${q.tracks.length - 10} autre(s)` : '';
        return i.reply({ embeds: [embed('File d’attente', `▶ ${line(q.current)}${rest ? `\n\n${rest}${more}` : ''}`)] });
      }
    }
  } catch (e) {
    console.error(e);
    const msg = { content: 'Une erreur est survenue.', flags: MessageFlags.Ephemeral };
    (i.deferred || i.replied ? i.followUp(msg) : i.reply(msg)).catch(() => {});
  }
});

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error('DISCORD_BOT_TOKEN manquant (onirique-discord sur le VPS).');
  process.exit(1);
}
client.login(process.env.DISCORD_BOT_TOKEN);
