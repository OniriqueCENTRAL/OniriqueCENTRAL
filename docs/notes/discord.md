# Discord

- Bot : `server/discord-bot`, copié dans `/opt/onirique-discord-bot` par `onirique-deploy`, service
  `onirique-discord-bot` (jeton dans `/etc/onirique/discord-bot.env`, posé par `onirique-discord`).
- Musique : `/play` (yt-dlp dans `/opt/yt-dlp`, mis à jour chaque nuit par `/etc/cron.daily/onirique-yt-dlp`).
- Annonces des sorties : `releases.js` + `artists.json` (ajouter un artiste = une ligne, puis `deploy.sh`),
  minuteur `onirique-releases.timer` le jeudi à 23 h 59.
- Patch notes : chaque soir à 23 h 59, tous les commits de tout le monde, sauf ce qui est réservé aux fondateurs
  (VANISH, onglet KNOB, simulation d'achat, administration). Envoi : `node deploy/patchnote.mjs <fichier>`
  (fichier hors du dépôt) ; `--last` donne le dernier commit annoncé. Vignettes : `tools/patchnotes/render.js`.
- Aucune mention d'outil dans les notes ; apostrophes françaises.

## Pièges
- yt-dlp : le client `android_vr` répond 403.
- Pages publiques Spotify : seul l'en-tête `User-Agent: Mozilla/5.0` reçoit la page complète.
