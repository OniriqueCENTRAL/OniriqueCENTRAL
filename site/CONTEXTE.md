# Site Onirique VocalBox : note de passation

Site de vente du plugin **ONIRIQUE VOCALBOX** (VST3 + Standalone, Windows 64 bits), créé par Novi.
État au 11 octobre 2026. Le site ne présente **que VocalBox** : le plugin Onirique Channel Strip a été retiré volontairement pour l'instant.

## Fichiers

| Fichier | Rôle |
|---|---|
| `onirique.html` | **Source à modifier.** Page complète (CSS + HTML + JS dans un seul fichier), sans `<!doctype>` ni `<head>` : elle commence par `<title>`. Les images y sont référencées en `assets/...`. |
| `index.html` | **Version à mettre en ligne**, générée par `build.ps1` : `onirique.html` + doctype + logos intégrés en base64. Ne pas modifier à la main. |
| `build.ps1` | Régénère `index.html` : `powershell -ExecutionPolicy Bypass -File build.ps1` |
| `assets/logo.png` | Sigil du logo détouré (blanc sur transparent), utilisé dans le hero. |
| `assets/logo-small.png` | Même sigil en 160 px (menu, maquette, crédits). |
| `assets/logo-original.png` | Logo d'origine (sigil blanc sur dégradé rouge sang → noir). |
| `assets/demo.mp3` | Morceau de la démo d'écoute : « (FREE) Zamdane x TIF Type Beat - Shy » (2:39). **Licence à vérifier** avant usage commercial, ou à remplacer (même nom de fichier). N'est pas intégré dans `index.html` : il faut mettre en ligne `index.html` **et** le dossier `assets/`. |

## Direction artistique (reprise du logo et de l'interface du plugin)

- Couleurs (tokens CSS dans `:root`) : `--night #0D0809`, `--blood #5C0008`, `--deep #1A080A`, `--deep-2 #2A0A0E`, `--mist #F6EEEE`, `--haze #A88F92`, `--ember #E23444` (braise, accent), `--bone #FFECEE`. Ce sont exactement les couleurs de `UIStyle` / `PluginEditor.h` du plugin.
- Polices (Google Fonts) : Unbounded (titres), Grenze Gotisch (mots mis en valeur, blancs et lumineux), Hanken Grotesk (texte), JetBrains Mono (valeurs, libellés techniques).
- Motifs : étoiles à 4 branches et réticules du logo, halo braise, grain argentique. Thème sombre unique, assumé.

## Structure de la page

1. **Nav** : Interface, Fonctions, Écouter, Presets, Crédits, Tarif, FAQ + bouton Acheter.
2. **Hero** : titre « Ta voix, comme dans un rêve. », sigil animé dans un réticule, rubans et étoiles sur canvas.
3. **#vocalbox, L'interface** : maquette interactive fidèle au plugin (voir plus bas).
4. **#fonctions** : chaîne en 9 étages, 6 points forts (MIX/LIVE, suréchantillonnage, analyseur, ordre libre, presets, sans clic), 3 types de saturation (canvas), 8 specs.
5. **#ecouter** : démo audio Web Audio (voir plus bas).
6. **#presets** : listes des presets d'usine et des presets multibande.
7. **#credits** : titres mixés avec VocalBox (pochette + lecteur Spotify intégré).
8. **#tarif** : une offre, prix et lien depuis `SHOP`.
9. **#faq** puis pied de page (mention des marques 1176 / LA-2A / Pultec).

## Le JavaScript (dans l'ordre du fichier)

- **`SHOP`** (tout en haut du script) : `{ vocalbox: { price: 49, url: "" } }`. Mettre l'URL de paiement (Lemon Squeezy, Payhip, Gumroad, Stripe Payment Link). Tant que `url` est vide, les boutons `[data-buy]` affichent un toast « Paiement bientôt disponible ». Les prix s'affichent via `[data-price]` / `[data-price-big]`.
- **`P`** : registre des paramètres avec les **vraies plages** de `Source/Parameters.h` (min, max, défaut, skew `centre`, format). Le site garde les noms courts (`fetIn`, `laPeak`, `resoAmt`...).
- **`defaults()`, `FACTORY`, `MB_PRESETS`** : valeurs par défaut du plugin, presets d'usine (`PresetManager.h` : Init, Clean Pop Vocal, Rap Lead, Airy Ballad, Warm Tape Vocal, Aggressive Rock) et presets multibande (`MultibandPresets.h`). La page s'ouvre sur « Clean Pop Vocal ».
- **`buildVB()`** : construit la maquette en coordonnées du plugin (base **1480 × 910**, `--u = 100cqw / 1480`), positions reprises de `PluginEditor::resized()` : en-tête (ordre des 6 modules en glisser-déposer, OS OFF/2X/4X/8X, MIX/LIVE, barre de presets, BYPASS), EQ, DE-ESSER / PLOSIVES, SATURATION LAB, RESONANCE (afficheur, faders, AMOUNT, LISTEN), COMPRESSION avec onglets 1176 / LA-2A (VU-mètres) et MULTIBAND, INPUT, ANALYZER / PARAMETRIC EQ (6 points déplaçables, double-clic = on/off, barre de la bande sélectionnée), AUTO GAIN, OUTPUT (+ OVER). Composants : `knob`, `fader`, `hfader`, `dv`, `seg`, `pill`, `power`, `vu`, `stereo`.
- **Moteur audio de la démo** (`buildAudio` / `applyAudio`) : chaîne simplifiée INPUT → EQ (low shelf, mid, high shelf, low cut) → EQ paramétrique 6 bandes → 1176 → LA-2A (DynamicsCompressor) → de-esser (cloche) → saturation (WaveShaper x4) → Auto Gain (mesure RMS réelle) → OUTPUT → volume. Resonance, Multiband et Plosives **ne sont pas simulés** (la page le dit).
- **Lecteur** : le MP3 est **téléchargé puis décodé** (`fetch` + `decodeAudioData`) et joué par un `AudioBufferSource`. Une balise `<audio>` ne sert qu'en secours quand la page est ouverte depuis le disque. Il y a aussi l'import d'un fichier par le visiteur (reste en local), une barre de lecture, un volume mémorisé dans `localStorage` et la coupure du son quand l'onglet est caché.
- **Écrans** : `drawReso`, `drawAna`, `drawMb`, `drawScope`, `drawRibbons`, puis la boucle `frame()` (Auto Gain, OVER, VU-mètres, mètres).
- **`CREDITS`** : liste des titres. Pour en ajouter un, copier le bloc. `spotifyId` = la partie après `/track/` dans le lien Spotify. Exemple actuel : CINÉMA – Novi, single du 9 octobre 2026, 2:39.

## Pièges déjà rencontrés (à ne pas réintroduire)

- **Lien Claude (artifact)** : son cadre sécurisé bloque l'iframe Spotify, la pochette (`i.scdn.co`) et la lecture d'un MP3 par une balise `<audio>`. D'où la lecture par `fetch` + Web Audio. Sur un vrai hébergeur, tout fonctionne.
- **Mise à jour à chaud** : une nouvelle version peut relancer le script sans tuer l'ancien moteur audio. Le script ferme donc `window.__oniriqueAudio` au démarrage. Il ne faut jamais lancer de son sans un clic.
- **`all: unset`** sur un bouton placé dans un conteneur en `pointer-events: none` le rend non cliquable. Il faut remettre `pointer-events: auto` (déjà fait pour `.play`).
- **Lecteur Spotify** : l'iframe doit faire **152 px** de haut exactement. En dessous, Spotify passe en format réduit avec une bande blanche.
- **Maquette sur téléphone** : elle garde une largeur minimale de 760 px et défile horizontalement (un message l'indique).

## Reste à faire

1. Renseigner le prix final et le lien de paiement dans `SHOP`, puis relancer `build.ps1`.
2. Rédiger les pages Mentions légales, CGV et Contact (liens vides dans le pied de page).
3. Vérifier la licence du beat de démo, ou le remplacer par un son à Novi. CINÉMA dure aussi 2:39 : si c'est son instrumental, renommer le bouton « Shy · type beat » en conséquence.
4. Vérifier à l'œil, pendant la lecture, que les VU-mètres et les mètres bougent (non vu pendant les tests).
5. Mise en ligne conseillée : Netlify Drop (glisser le dossier du site) avec Lemon Squeezy ou Payhip pour le paiement, la TVA européenne et la livraison du `.vst3`.

## Le plugin (référence)

Code source : `C:\Users\Nov\Downloads\OniriqueVocalBox\Source` (JUCE 8). Chaîne : INPUT → EQ (LOW / MID / HIGH + paramétrique 6 bandes) → RESONANCE → COMPRESSION (1176 / LA-2A / DUO) → MULTIBAND (opto 4 bandes) → DE-ESSER / PLOSIVES → SATURATION LAB → AUTO GAIN → OUTPUT. L'ordre des 6 modules se règle dans l'en-tête. Modes MIX (latence ~44 ms compensée) et LIVE (latence nulle). Suréchantillonnage de toute la chaîne OFF/2X/4X/8X (2X par défaut, en MIX). Presets usine + utilisateur (`.ovbpreset`). Si le plugin change encore, relire `Parameters.h`, `PresetManager.h`, `MultibandPresets.h` et `PluginEditor::resized()` puis mettre à jour `P`, `FACTORY`, `MB_PRESETS` et `buildVB()`.
