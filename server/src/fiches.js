// LES FICHES DES PLUGINS (site et application : le même catalogue), réécrites le 07/11/2026 d'un ton plus humain : on parle à
// l'artiste, ce que le plugin change pour lui d'abord. Posées une seule fois (réglage plugin_fiches) : une retouche faite
// ensuite dans l'admin reste. VOCALBOX a la sienne (vocalbrain.js) ; RELIC BLOOM n'est pas touché.
import { get, run } from './db.js';

const FICHES = [
   {
      "description" : "Tu veux une voix propre, équilibrée, qui sonne pro, sans passer ta soirée dans les réglages ? Vocal Mini est fait pour ça.\n\nUne compression efficace et les outils essentiels réunis dans un seul plugin, avec des réglages qui parlent d'eux-mêmes. Tu le poses, tu ajustes deux ou trois choses, et ta voix est prête à rejoindre le mix.\n\nMoins de réglages. Plus de mix.",
      "slug" : "onirique-vocal-mini",
      "tagline" : "Moins de réglages. Plus de mix."
   },
   {
      "description" : "Le bas qui fait du bien, rond et chaud, même sur des petites enceintes. Le haut qui s'ouvre sans jamais devenir dur. C'est tout l'esprit de Weight, l'égaliseur de programme à lampes des années 50, avec son fameux tour du bas.\n\nPousse le BOOST du grave (20, 30, 60 ou 100 Hz) : plus tu montes, plus les lampes épaississent la basse. Ajoute l'ATTEN en même temps et tu retrouves le tour connu : le sub monte, la boue juste au-dessus se creuse. En haut, le BOOST ouvre l'air de 3 à 16 kHz, avec une largeur réglable de SHARP à BROAD, et l'ATTEN adoucit ce qui pique. Les aigus ne passent pas par les lampes : ils restent propres.\n\nLa façade est une vraie photo : chaque pièce a été modélisée en 3D et éclairée comme en studio, bakélite, chrome et verre taillé, et les reflets restent en place quand tu tournes un potard. Survole un réglage pour voir sa valeur exacte, double-clic pour le remettre à zéro.\n\nMono ou stéréo, traitement à fréquence doublée pour des aigus fidèles (latence de quelques échantillons, compensée par ton DAW). VST3 pour Windows ; VST3 et AU pour Mac (Intel et Apple Silicon).",
      "slug" : "onirique-weight",
      "tagline" : "Un égaliseur à lampes dans l'esprit de l'EQP-1A : un bas qui pèse, et un haut plein d'air."
   },
   {
      "description" : "Massif, c'est l'égaliseur qu'on trouve en bout de chaîne dans les studios de mastering : deux canaux de quatre bandes, des lampes, et ce bas qui reste rond même quand on insiste.\n\nDans le grave et le bas-médium, c'est le circuit passif d'origine, tel quel : des cloches qui se resserrent quand on pousse, des étagères qui résonnent juste ce qu'il faut, et des bandes qui se répondent entre elles, comme sur l'appareil. Dans le haut, un hybride passif et classe A : l'aigu s'ouvre avec douceur et précision, sans durcir.\n\nPar bande : gain jusqu'à 20 dB en boost ou en cut, largeur, onze fréquences, cloche ou étagère. Par canal : un passe-haut, un passe-bas et le gain de sortie. LINK fait tourner les deux côtés ensemble.\n\nLa façade est une vraie photo, modélisée en 3D : les fenêtres s'allument en vert pour BOOST, en rouge pour CUT. Survole un réglage pour voir sa valeur, double-clic pour revenir au départ.\n\nMono ou stéréo, côtés liés ou indépendants, traitement à fréquence doublée (latence de quelques échantillons, compensée par ton DAW). VST3 pour Windows ; VST3 et AU pour Mac (Intel et Apple Silicon).",
      "slug" : "onirique-massif",
      "tagline" : "Le grand égaliseur passif à lampes des studios de mastering, en stéréo."
   },
   {
      "description" : "Le son de la console qu'on entend sur des milliers de disques. N73 recrée le préampli et l'égaliseur du célèbre module 1073 d'après ses schémas d'origine, transformateurs compris. Plus tu pousses le gain, plus il colore, d'abord dans le grave, exactement comme le vrai.\n\nTu retrouves la façade d'origine : gain micro ou ligne, impédance, HIGH à 12 kHz, MID de 360 Hz à 7,2 kHz, LOW de 35 à 220 Hz, passe-haut, phase et sortie. En plus : un PAD, un fader de console, LEVEL MATCH pour comparer à volume égal, A/B et presets.\n\nPresque aucune latence (4 échantillons, aucune à 96 kHz) et léger pour ton processeur. Windows et Mac (VST3 et AU).",
      "slug" : "onirique-n73",
      "tagline" : "Le préampli et l'EQ des consoles britanniques de 1973, recréés pièce par pièce."
   },
   {
      "description" : "Ce compresseur « colle » les mix depuis quarante ans. Glue en garde tout : propre quand tu le caresses, un peu crémeux quand tu le pousses, et une image stéréo qui ne bouge pas.\n\nTout est là : THRESHOLD, MAKE-UP, ATTACK et RELEASE à crans, avec le RELEASE AUTO qui relâche vite après un coup isolé et lentement quand la compression dure. RATIO 2, 4 ou 10:1. Le filtre de side-chain empêche le kick et la basse de le faire pomper, HR choisit entre propre et crémeux, et MIX te donne la compression parallèle. Bonus : l'AUTO FADE de la console, un fondu jusqu'au silence et retour.\n\nLa façade est une vraie photo, modélisée en 3D : le VU s'éclaire en rouge tant qu'il travaille. Survole un réglage pour voir sa valeur, double-clic pour revenir au départ.\n\nMono ou stéréo, traitement à fréquence doublée pour des crêtes arrondies sans artefact (latence de quelques échantillons, compensée par ton DAW). VST3 pour Windows ; VST3 et AU pour Mac (Intel et Apple Silicon).",
      "slug" : "onirique-glue",
      "tagline" : "Le compresseur de bus des grandes consoles des années 80 : il colle ton mix."
   },
   {
      "description" : "Il y a des compresseurs qui tiennent la voix, et il y a ceux qui la rendent belle. OptoBox est de ceux-là. Sa cellule optique suit la musique avec un léger retard et se souvient des passages forts : la compression devient douce, presque invisible. Derrière, la lampe et ses transformateurs réchauffent le son dès que tu pousses la sortie.\n\nDeux caractères : le mk I d'origine, plus lent, plus chaud, plus doux dans le haut, et le mk II, plus vif et plus ouvert. Tu règles THRESHOLD, RATIO, ATTACK, RELEASE et la sortie ; ou tu laisses la cellule faire le travail en mode fixed. Le filtre de side-chain évite le pompage dans le grave, et PARALLEL COMP. mêle le son d'origine au son compressé.\n\n15 presets d'usine rangés par usage (voix, batterie, basse, instruments, mix, mastering), tes propres presets, A/B, copier-coller entre instances, fenêtre de 75 à 200 %.\n\nMono ou stéréo, entrée side-chain, aucune latence. VST3 pour Windows ; VST3 et AU pour Mac (Intel et Apple Silicon).",
      "slug" : "onirique-optobox",
      "tagline" : "Un compresseur optique à lampe dans l'esprit du CL 1B : doux, musical, deux générations en une."
   },
   {
      "description" : "Tu connais ce souffle qui monte juste avant que la voix démarre ? Avant, il fallait exporter, retourner l'audio, bricoler une piste de reverb. Avec Riser, tu lances la lecture, tu arrêtes, et ta montée est prête.\n\nAttrape la forme d'onde et glisse-la dans ton DAW, sur la mesure indiquée : elle finit pile là où la voix commence. Un grand bouton règle la durée au tempo (d'un temps à 4 mesures), les S sont nettoyés tout seuls pour qu'aucune sifflante ne ressorte à l'envers, et tu choisis l'espace (ROOM, PLATE, DARK, HALL, SHIMMER) et un effet en un clic (PHONE, CHORUS, TREMOLO, SWEEP, WIDE).\n\nÉcoute et boucle dans le plugin, choix de la phrase, et le mode IN SYNC pour l'entendre au bon moment sans même la glisser. Presets d'usine et presets perso. Windows et Mac (VST3 et AU).",
      "slug" : "onirique-riser",
      "tagline" : "La montée de reverb inversée parfaite, en un geste."
   },
   {
      "description" : "Tu tires les bandes directement sur le spectre de ton son, et c'est réglé. Cloche, étagères, notch, coupe-bas et coupe-haut jusqu'à 48 dB par octave. Une bande peut devenir dynamique : elle n'agit que quand sa zone déborde. Maintiens un point pour écouter sa bande seule et trouver la fréquence qui gêne en deux secondes.\n\nTrois façons de traiter, selon ce que tu cherches : ZERO LATENCY pour travailler en direct, NATURAL PHASE pour le comportement d'un vrai EQ analogique (toujours sans latence), LINEAR PHASE pour ne toucher à aucune phase.\n\nAnalyseur en direct, presets d'usine (voix, kick, basse, bus, master, anti-ronflette) et presets perso. Windows et Mac (VST3 et AU).",
      "slug" : "onirique-eq",
      "tagline" : "Un EQ 8 bandes qui va droit au but, sans latence."
   },
   {
      "description" : "Ta voix se noie dans l'instru et tu n'as pas les pistes séparées ? Vocal Spacer écoute ta voix et creuse l'instru juste là où elle la cache, et seulement pendant qu'elle chante. La place suit tes phrases, pas tes syllabes : rien ne pompe.\n\nPas de side-chain ? Le mode STATIC pose une place fixe à la forme d'une voix. SPACE élargit l'instru, ramène les graves au centre et fait briller les côtés. RESTORE redonne du punch au kick et de l'énergie au médium. L'AUTO GAIN garde le volume constant pour que tu compares le son, pas le niveau.\n\nAucune latence. Presets d'usine et presets perso. VST3 et version autonome pour Windows ; VST3 et AU pour Mac.",
      "slug" : "onirique-vocal-spacer",
      "tagline" : "Fait de la place à ta voix dans une instru déjà terminée."
   },
   {
      "description" : "Ta voix chante un peu à côté ? TUNER la remet sur la note, si doucement que personne ne l'entend. Tu veux le son des refrains d'aujourd'hui ? Monte la vitesse et pousse l'effet jusqu'au robot.\n\nLIVE corrige sans aucune latence, pour t'enregistrer avec l'effet dans le casque. HQ est encore plus précis, pour le mix. Tous les réglages qu'on attend : Retune Speed, Flex-Tune, Humanize, Natural Vibrato, Formant et Throat.\n\nEt un vocodeur piloté par ta propre voix, avec la sortie MIDI des notes que tu chantes.",
      "slug" : "tuner",
      "tagline" : "L'autotune, de la justesse invisible à l'effet robot."
   },
   {
      "description" : "Une sifflante qui pique, une note qui ressort, une dureté dans le médium : ResoBox les repère en direct et les calme, fréquence par fréquence, seulement quand elles sont là. Le reste de ton son ne bouge pas.\n\nCe n'est pas un compresseur multibande : il ne touche que ce qui dépasse vraiment autour de lui, et jamais la phase. DEPTH dose la quantité, DETAIL choisit entre bosses larges et sifflements précis, SOFT / HARD le caractère, TILT penche le travail vers le grave ou l'aigu.\n\nTu peux dessiner où il doit travailler plus fort ou épargner, sur toute l'image ou seulement la gauche, la droite, le centre ou les côtés, ou passer en mode MULTIBAND à quatre bandes. DELTA te fait écouter uniquement ce qui est retiré.\n\nStéréo, mid/side ou mono, side-chain, MIX, AUTO GAIN, trois qualités et un mode basse latence. Neuf presets d'usine, presets perso, A/B. VST3 pour Windows ; VST3 et AU pour Mac (Intel et Apple Silicon).",
      "slug" : "onirique-resobox",
      "tagline" : "Il adoucit ce qui agresse l'oreille, sans toucher au reste."
   },
   {
      "description" : "DoubleBox entoure ta voix de quatre doubles, deux de chaque côté, comme si tu avais refait la prise. Tu les places à la souris : de gauche à droite dans la stéréo, de bas en haut en volume. Chacun a son retard et son léger désaccord, et DRIFT les fait vivre comme de vraies secondes prises.\n\nTu veux aller plus loin ? PITCH et FORMANT changent la hauteur ou le timbre des voix de ton choix. MANIPULATE les transforme complètement : harmoniques, grain, voix robot, octave en dessous, notes tenues ou glissées, nappes, stéréo large.\n\nPresets classés par type (doubleurs, voix graves, aiguës, robot, alien…) et tes propres presets. La voix du centre reste intacte tant que tu n'y touches pas.\n\nPensé pour une voix seule. Latence de 28 ms, compensée par ton DAW. VST3 pour Windows ; VST3 et AU pour Mac (Intel et Apple Silicon).",
      "slug" : "onirique-doublebox",
      "tagline" : "Ta voix, rechantée quatre fois autour d'elle."
   },
   {
      "description" : "Un seul plugin pour tout ce qui ondule : flanger, chorus, dimension, vibrato. De l'effet à peine perceptible au mur de son, avec jusqu'à huit voix.\n\nLe bouton CIRCUIT fait passer ton son du numérique parfait à un vieux circuit analogique, avec son grain, sa dérive et son souffle. Tu règles la vitesse et la profondeur, l'écart stéréo, un second mouvement pour casser la régularité, et un feedback métallique ou liquide. BASS KEEP laisse le grave intact, TEXTURE salit les voix sans toucher au son direct (bit crusher, downsample, distorsion), et l'AUTO GAIN garde le volume constant pour que tu juges l'effet, pas le niveau.\n\nL'écran te montre en direct ce que l'effet fait à ton son. Presets classés par type, presets perso, A/B.\n\nMono ou stéréo en entrée, sortie stéréo, aucune latence. VST3 pour Windows ; VST3 et AU pour Mac (Intel et Apple Silicon).",
      "slug" : "onirique-modbox",
      "tagline" : "Flanger, chorus et vibrato, du numérique le plus propre à l'analogique lofi."
   },
   {
      "description" : "Huit modules dans un seul plugin : noise gate, tranche SSL, deux de-essers, saturation, 1176, Fairchild 670 et EQ paramétrique.\n\nChange l'ordre comme tu veux, sans un clic dans le son. La saturation monte jusqu'à 8x de suréchantillonnage pour rester propre, et 9 presets d'usine te donnent un point de départ.",
      "slug" : "based",
      "tagline" : "Une tranche de console complète pour ta voix, dans l'ordre que tu veux."
   },
   {
      "description" : "PitchBox découpe ta prise en notes, et tu décides : tu corriges tout d'un geste sur la bonne gamme (il trouve même la tonalité pour toi), ou tu reprends chaque note à la main. Une note se déplace, s'accorde, ou reste comme tu l'as chantée.\n\nPour chaque note : la hauteur, ce que tu gardes de ton vibrato et de tes inflexions, le volume, et le formant pour changer le timbre sans changer la note. Chaque modification s'entend tout de suite, sans nouveau rendu.\n\nDans Studio One, Logic Pro, Cubase, Nuendo, REAPER ou Cakewalk (ARA 2), ta prise arrive toute seule. Dans FL Studio ou Ableton Live, le mode TRANSFER l'enregistre au passage, ou tu glisses le fichier sur la fenêtre. Écoute d'une note en la maintenant, boucle, annuler / rétablir, export MIDI.\n\nPensé pour une voix seule. VST3 pour Windows ; VST3 et AU pour Mac (Intel et Apple Silicon).",
      "slug" : "onirique-pitchbox",
      "tagline" : "Corrige la justesse de ta voix, note par note."
   },
   {
      "description" : "Six espaces : ROOM, deux PLATES, HALL, SHIMMER, et ONIRIQUE, une salle immense et sombre qui ondule et rêve. Tu règles la taille et la durée en glissant directement dans le PORTAIL, la reverb vue de face. Et ton dosage reste verrouillé quand tu changes de preset.\n\nLa reverb ne doit jamais salir ta voix : DUCKING l'efface quand tu chantes et la rouvre entre les phrases, CLEAN retire les sifflantes et la boue de la queue. Un EQ avant et un EQ après la reverb, à tirer à la souris. INFINITE fige la queue sans fin.\n\nLe bouton BPM cale la reverb et le pre-delay sur le tempo, STUTTER découpe la queue en rythme et PULSE la fait respirer.\n\nAucune latence. Presets d'usine et presets perso. VST3 pour Windows ; VST3 et AU pour Mac.",
      "slug" : "onirique-verb",
      "tagline" : "La reverb pensée pour la voix."
   },
   {
      "description" : "Tourne CHARACTER et ton delay voyage : tout à gauche, des répétitions nettes et précises ; au milieu, une bande chaude qui sature doucement ; tout à droite, une vieille bande sombre qui pleure, chaque écho s'y enfonçant un peu plus.\n\nLe temps se cale sur ton morceau (du 1/32 à la ronde, pointé ou triolet). Pousse le FEEDBACK au-delà de 100 % et l'écho s'emballe tout seul. Trois têtes de lecture pour créer des rythmes, FREEZE pour figer une boucle et jouer par-dessus. TONE, PITCH (jusqu'à une octave, en cascade), WOBBLE, PING-PONG et SPACE pour noyer les échos dans une reverb.\n\nL'écran montre la machine qui change sous tes yeux, d'une puce mémoire à un magnéto à bobines, et chaque écho qui s'allume quand il sonne. 23 presets d'usine classés par type, presets perso, A/B.\n\nMono ou stéréo en entrée, sortie stéréo, aucune latence. VST3 pour Windows ; VST3 et AU pour Mac (Intel et Apple Silicon).",
      "slug" : "onirique-echobox",
      "tagline" : "Un delay qui passe, d'un seul bouton, du numérique pur à la bande usée."
   },
   {
      "description" : "Pose MeterBox en dernier sur ton master : il ne touche pas au son, il te montre tout.\n\nLe loudness aux normes (intégré, true peak, LRA), avec l'écart à ta cible : Spotify et YouTube -14, Apple Music -16, master fort -9, ou la tienne. L'historique de ton titre, avec chaque dépassement marqué. Le spectre comparé à celui d'un titre fini, et même à ton propre morceau de référence grâce à CAPTURE. La forme d'onde du titre entier. Et la phase, pour voir d'un coup d'œil ce que ton mix perd en mono.\n\nPendant un export, tout le fichier est mesuré. Survole une partie pour savoir ce qu'elle montre.\n\nMono ou stéréo, aucune latence. VST3 pour Windows ; VST3 et AU pour Mac (Intel et Apple Silicon).",
      "slug" : "onirique-meterbox",
      "tagline" : "Tout ce que tu dois vérifier avant d'exporter ton master, dans une seule fenêtre."
   },
   {
      "description" : "Tu veux partager ton écran sur Discord et que tes potes entendent ce que tu fais ? Pose Stream en dernier sur ton master, partage la fenêtre de ton DAW avec le son, c'est tout. Ton DAW reste sur l'ASIO de ta carte son, et toi tu n'entends rien en double.\n\nPas de câble audio virtuel installé ? Stream télécharge VB-CABLE, vérifie sa signature et l'installe pour toi. Si le son revient dans ton DAW, ECHO GUARD coupe le stream avant le larsen. Et tes réglages reviennent tout seuls à chaque nouveau projet.",
      "slug" : "onirique-stream",
      "tagline" : "Fais écouter ta session sur Discord, sans quitter ton ASIO."
   },
   {
      "description" : "Broadcast fait de ta voix traitée un micro que Discord, OBS et tes jeux voient comme un vrai. Et parce qu'il mélange et route plusieurs sources à la fois, tu gères tout ton son de stream au même endroit, sur Windows.",
      "slug" : "onirique-broadcast",
      "tagline" : "Ta voix traitée en direct, en micro virtuel pour Discord, OBS et tes jeux."
   },
   {
      "description" : "Tu composes sur un clip, un extrait de film ou une vidéo TikTok ? Player ouvre la vidéo dans ton DAW et la cale sur ta lecture : tu lances, elle part ; tu stoppes, elle s'arrête ; tu déplaces le curseur, l'image suit.\n\nLa fenêtre prend tout de suite le format de ta vidéo (16:9, 9:16 ou carré) et se redimensionne sans la déformer. SYNC éteint, c'est un lecteur libre, avec boucle.\n\nLe son de ton projet n'est jamais touché, et ta vidéo revient toute seule à la réouverture. Fichiers .mp4 et .mov, Windows et Mac.",
      "slug" : "player-onirique",
      "tagline" : "Ta vidéo dans ton DAW, calée sur ta lecture."
   },
   {
      "description" : "Toute une chaîne de studio dans un seul plugin, branchée dans le bon ordre : un préampli à lampe, un EQ de console, un niveleur, un flanger, la plaque d'ONIRIQUE VERB et un limiteur.\n\nPousse la voix dans la lampe : elle se densifie sans monter en volume, et les filaments s'allument derrière la vitre. L'EQ de console va à l'essentiel : AIR pour le souffle, TREBLE pour la présence, DE-MUD pour sortir la voix de la boue, BASS pour le corps. Le niveleur la tient, le VU te montre ce qu'il fait. Le flanger l'ouvre en stéréo, la plaque s'efface quand tu chantes. MIX mêle l'original et le traité, et le limiteur protège ta sortie.\n\nLatence de 2,75 ms, compensée par ton DAW. Fenêtre redimensionnable, double-clic pour revenir au départ, Maj pour un réglage fin.",
      "slug" : "onirique-enhancer",
      "tagline" : "Ta voix devant, chaude et brillante, en quelques boutons."
   }
]
;
export function applyPluginFiches() {
  if (get("SELECT value FROM settings WHERE key = 'plugin_fiches'")?.value === '1') return;
  for (const f of FICHES) run('UPDATE products SET tagline = ?, description = ? WHERE slug = ?', f.tagline, f.description, f.slug);
  run("INSERT INTO settings (key, value) VALUES ('plugin_fiches', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
}
