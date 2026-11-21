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
