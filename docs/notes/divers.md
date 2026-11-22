# Divers

## ROCKY (mascotte 3D)
- `tools/rocky/rocky3d.py` (Blender, Cycles CPU) rend les animations ; `tools/rocky/pack.py` produit
  `site/assets/rocky/` (7 humeurs, planches CLOUD, portrait). Rendu complet : environ 20 min.
- Inspiré d'un film protégé : garder l'esprit, pas le personnage (visage et braise ONIRIQUE).
- Après un rendu : augmenter `?v=` dans `rocky.js` et `rocky-builder.js` (et `site-nav.js?v=` sur toutes les
  pages si `rocky.js` change). Si la pose HOLD change, recaler `SPRITE` et `CARD` avec le `hands.json` de pack.py.

## Trailer et Instagram (`trailer/`, non suivi par git)
- Rendu par `app/node_modules/electron/dist/electron.exe trailer/render.js` (sans ffmpeg). Ne pas commiter le MP4.
- Pièges : une fenêtre Electron plus grande que l'écran est réduite (`setBounds` après création) ; l'encodeur AAC
  n'accepte que 96, 128, 160 ou 192 kbit/s. Les données plugins et outils y sont écrites en dur.

## Scan des prods volées (ACRCloud)
- 4 extraits de 12 s par prod ; un titre n'est retenu que s'il est reconnu sur au moins 2 extraits au même
  décalage (±3 s). Clés posées par `onirique-acrcloud`. En cas d'échec, lire l'erreur dans `sound_scans`.

## Chiffres Spotify des profils (CaptAPI)
- Ce sont des chiffres **publics** (auditeurs mensuels, abonnés, écoutes des titres du top, villes), pas ceux de
  Spotify for Artists, qui n'a pas d'API. Réservé aux fondateurs (rôle `founder`) : chaque lecture coûte un crédit
  CaptAPI, une par jour au plus par artiste (`server/src/spotifystats.js`). Clé posée par `onirique-captapi`.

## IA des paroles (CUT, CLOUD : `site/assets/ai-lyrics.js`)
- Demucs isole la voix ; des paroles écrites sont calées lettre par lettre sur cette voix (wav2vec2 français,
  `ctc-worker.js` + `ctc-align.js`, 632 Mo, WebGPU avec demi-précision) ; sans texte, Whisper écrit puis chaque mot est
  recalé de la même façon. Sans carte graphique adaptée, l'ancien calage par les mots de Whisper prend le relais.
- Mesuré sur les titres du CLOUD calés à la main (8 titres mot par mot, 42 ligne par ligne) : erreur médiane 50 ms,
  73 % des mots à moins de 100 ms (contre 160 ms et 26 % avant). Réglages dans `SETTINGS` de `ctc-align.js`.
- Références : les titres calés à la main ont ~50 % de centièmes pairs et des écarts irréguliers ; ceux calés par l'IA
  ont surtout des centièmes pairs, et des écarts réguliers trahissent des temps interpolés (pas une référence).
- Pièges : les modèles MMS de Meta (forced-aligner) sont sous licence CC-BY-NC, interdite ici ; vérifier la licence de
  tout modèle avant de l'essayer. Deux titres du CLOUD ont des temps faits sur une autre version du son (décalage
  constant d'une minute) : les écarter d'une mesure.
- Voix (CUT, `voices.js` + `voices-worker.js`) : une empreinte WeSpeaker ResNet34 (26 Mo, CC BY 4.0 : le crédit reste
  dans l'aide de CUT) par phrase, puis regroupement. Seuils mesurés : dialogue de film ~0,5 même voix, ~0,3 entre deux
  (seuil 0,4) ; voix d'un son plus proches (seuil 0,36, et lissage par parties). Isoler la voix d'un film n'aide pas.
  Limites : une phrase de moins d'une seconde (« Quoi ? ») et deux rappeurs au timbre proche peuvent tomber dans la
  mauvaise voix : un clic sur la phrase corrige. WavLM-sv écarté (pas de licence indiquée).

## Arborescence de CUT et AUTOMATIQUE (`server/src/cutbrain.js`, `cut-brain.json`)
- L'arbre part de la recette de `cut-brain.json` (une feuille = un réglage de `prefs` dans `site/cut.html`, mêmes clés et
  mêmes valeurs) : une feuille ajoutée là doit exister dans CUT. Menu « Arborescence » de CUT, réservé aux fondateurs.
- Nourri par les exports (case « Aider CUT à apprendre », cochée au départ) : réglages, 3 images réduites, mesures du
  passage (tempo, place, énergie, drop ; jamais le son), noms des fonds, textes ; et le rôle du compte, jamais qui. Aussi par
  les corrections faites après AUTOMATIQUE (comptent triple) et les leçons des fondateurs. Les TikToks d'AUTOMATIQUE ne votent
  pas. Proposition à valider : 5 TikToks et 60 % d'accord ; un refus tient 30 jours. Images et textes gardés un an.
- Cadre légal : article 19 des CGU (licence limitée à l'amélioration de CUT) et paragraphe « cut » de la confidentialité
  (intérêt légitime, opposition par la case). Changer ce qui part = changer ces deux textes.
- AUTOMATIQUE : durée de l'arbre et meilleur passage, paroles par l'IA, style de l'arbre, fonds tirés au hasard dans la
  banque si aucun clip (3 films essayés), réplique qui reprend des mots du passage et finit sur une question, image froide
  retirée sur un film sombre, export sans Shorts ni Reels automatiques, gardé dans le cloud CUT.
- Avant de monter un TikTok soi-même pour un fondateur : lire l'arbre (`/api/cut/brain`, session fondateur).
- Superviseur (`server/src/cutagent.js`) : une IA gratuite sur le VPS (Ollama + `gemma3:4b`, licence Gemma ; Qwen écarté,
  licence non indiquée), installée par `onirique-superviseur`. Seulement sur le bouton « Demander son avis » ; bridée par
  systemd (3 cœurs, Nice 19, disque en idle, 6 Go, modèle déchargé après chaque réponse, 127.0.0.1 seulement). Une relecture
  prend quelques minutes. Une panne n'est qu'un état gardé (« sans-ia », « erreur ») : le site n'en dépend pas.
- Les liens TikTok des leçons sont lus par le serveur (yt-dlp en priorité basse, sinon la page d'intégration de TikTok) :
  description, auteur, vues, j'aime, musique, couverture réduite ; montrés dans l'arbre et donnés au superviseur.
- « Analyser un compte TikTok » (`server/src/cutaccount.js`) : yt-dlp liste les 40 dernières vidéos d'un profil public
  (`--flat-playlist -J` donne vues, j'aime, partages, enregistrements, durée, musique, couverture), télécharge en 480p les 3
  plus vues et la moins vue pour 3 images ffmpeg et leurs sous-titres, puis l'IA du VPS compare (forme de réponse imposée).
  Une analyse à la fois, file commune avec le superviseur, tout en priorité basse ; gardée un an.
- Pièges : le `fetch` de Node abandonne une requête sans réponse au bout de 5 minutes (délai d'en-têtes d'undici), or
  Ollama ne répond qu'une fois tout calculé : appeler l'IA par `node:http`. Sur le VPS (3 cœurs bridés), gemma3:4b lit
  ~12 jetons de texte par seconde, ~2 minutes par image, écrit ~2 jetons par seconde : peu d'images, réponses courtes.

## BPM et tonalité (`site/assets/bpm-key-worker.js`), blanc du Downloader
- Le même worker sert à BPM et tonalité, PROD du Downloader, CUT, Mes sons, Stems et Transposition : après une
  modification, augmenter son `?v=` dans ces six pages.
- Mesuré sur 95 prods dont le nom donne le BPM (60 avec la tonalité), les 240 s du milieu : BPM juste 87 %, tonalité
  juste 60 %. Profils de Krumhansl : 27 % (quinte ou majeur lus à cause des harmoniques des 808). Un profil appris sur
  ces prods n'a rien gagné en validation croisée. Les noms se trompent parfois (même prod nommée 114 et 127 BPM).
- Pièges : compter 3 temps pour choisir le battement fait lire un tempo aux deux tiers (164 → 109) ; un MP3 garde
  25 ms de blanc (retard de l'encodeur) dans les logiciels qui ignorent son en-tête LAME : le WAV est exact partout.
  Les MP3 exportés par FL Studio n'ont pas cet en-tête (~29 ms de blanc au début).

## Application CENTRAL et navigateur
- L'application reste sur Electron ; son coût vient de l'application elle-même, pas du moteur.
- Navigateur : ~20 % de RAM en moins que Chrome, même CPU sur la page active. Ne pas promettre plus.
