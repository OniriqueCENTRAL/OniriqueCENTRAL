# Discord

- Bot : `server/discord-bot`, copié dans `/opt/onirique-discord-bot` par `onirique-deploy`, service
  `onirique-discord-bot` (jeton dans `/etc/onirique/discord-bot.env`, posé par `onirique-discord`).
- Votes de modération (`votes.js`) : `/mute @membre 10m` (muet en vocal) et `/ban @membre 2h` (« Exclure
  temporairement » de Discord, pas un vrai ban), vote de 60 s, au moins 3 « Pour » (`VOTE_MIN`) et plus de « Pour »
  que de « Contre ». Le rôle du bot doit avoir « Rendre les membres muets » et « Exclure temporairement des membres »,
  et être placé au-dessus des rôles visés. Mutes en cours : `/var/lib/onirique-discord-bot/mutes.json`.
- Musique : `/play` (yt-dlp dans `/opt/yt-dlp`, mis à jour chaque nuit par `/etc/cron.daily/onirique-yt-dlp`),
  avec les cookies du compte YouTube de secours du Downloader (`onirique-youtube-cookies`).
- Annonces des sorties : `releases.js` + `artists.json` (ajouter un artiste = une ligne, puis `deploy.sh`),
  minuteur `onirique-releases.timer` le jeudi à 23 h 59.
- Patch notes : chaque soir à 23 h 59, tous les commits de tout le monde, sauf ce qui est réservé aux fondateurs
  (VANISH, onglet KNOB, simulation d'achat, administration). Envoi : `node deploy/patchnote.mjs <fichier>`
  (fichier hors du dépôt) ; `--last` donne le dernier commit annoncé. Vignettes : `tools/patchnotes/render.js`.
- Aucune mention d'outil dans les notes ; apostrophes françaises.

## Pièges
- yt-dlp : le client `android_vr` répond 403.
- Pages publiques Spotify : seul l'en-tête `User-Agent: Mozilla/5.0` reçoit la page complète.
- `/play` : « YouTube bloque le bot » = l'adresse du VPS est bloquée et les cookies du compte de secours sont absents
  ou périmés : relancer `onirique-youtube-cookies` (voir google.md).
- Votes /mute : ne pas se fier à `member.voice.channelId` (cache du bot, parfois faux) ; demander le mute à Discord et lire l'erreur 40032 (« pas en vocal »).
