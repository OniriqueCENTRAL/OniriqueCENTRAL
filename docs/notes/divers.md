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

## Application CENTRAL et navigateur
- L'application reste sur Electron ; son coût vient de l'application elle-même, pas du moteur.
- Navigateur : ~20 % de RAM en moins que Chrome, même CPU sur la page active. Ne pas promettre plus.
