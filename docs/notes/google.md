# Google (YouTube, Gmail) et Pinterest

Si « ça ne publie pas » ou « accès bloqué » : regarder les réglages Google avant le code.

- Shorts YouTube (fondateurs seulement) : `server/src/youtube.js`, tables `youtube_accounts` / `youtube_videos`,
  envoi par une minuterie dans `index.js`. Vidéos de prods des packs : `server/src/beattube.js` (ffmpeg sur le VPS).
- Client OAuth : URI de redirection `https://central.onirique.store/api/youtube/callback` (sert aussi à Gmail),
  réglé sur le VPS par `onirique-youtube`.
- Sans audit de l'API YouTube, les vidéos d'un projet non vérifié restent privées ou non répertoriées ;
  l'écran de consentement non publié coupe l'accès au bout de 7 jours.
- Gmail (envoi des packs) : API Gmail à activer dans le projet Google, scope `gmail.send` sur l'écran de
  consentement, testeurs ajoutés tant que le projet n'est pas vérifié.
- Pinterest : `server/src/pinterest.js`, réglé par `onirique-pinterest`. L'API ne donne ni le fil d'accueil
  ni la recherche globale.

## Pièges
- `redirect_uri_mismatch` = URI non déclarée dans le client OAuth, pas un bug du code.
