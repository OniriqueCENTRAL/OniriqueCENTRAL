# Plugins

## Propriétaires (chacun décide de la D.A des siens)
- ONIRIQUE (compte git « ONIRIQUE ») : TUNER, CHANNEL STRIP, VERB, ENHANCER.
- Tom (tomgurdian) : RESOBOX, ECHOBOX, MODBOX, METERBOX, DOUBLEBOX, PITCHBOX.
- Nov : VOCALBOX, VOCAL SPACER, THE CHOIR, EQ, RISER, PLAYER, BROADCAST, STREAM.
- RELIC : BLOOM. ABRASION : MIMIC, RAW, TAMA VOX.
- Un changement de `plugin-ui/` passe par `node tools/plugin-ui.mjs` (`--mes` / `--tous`) ; versions
  personnelles dans `plugin-ui/<propriétaire>/`. VERB et TUNER ont leur propre potard.

## Sources
- Dépôts privés `https://github.com/OniriqueCENTRAL/Onirique<NOM>.git` (RAW et TAMA-VOX sans préfixe).
  THE CHOIR est archivé (lecture seule).
- VOCALBOX, VOCAL SPACER, CHANNEL STRIP, EQ : un push sur `main` compile et publie tout seul ; le message du
  dernier commit devient la note de version.
- PITCHBOX, RESOBOX, DOUBLEBOX, METERBOX, MODBOX, MIMIC : binaires sur les branches `ci-build-Windows` /
  `ci-build-macOS`, puis `deploy/publish-plugin.mjs` sur le serveur (dossiers `win/`, `mac/`, `notes.txt`).
- Les autres : compilés sur un PC Windows, publiés avec `deploy/add-version.mjs` (aussi pour le Mac : `… mac`).

## Licences
- Kit commun : `plugin-license/` (source de vérité, notice dans son README), copié sous `License/` dans chaque
  plugin payant. Sans achat, l'écoute reste intacte et seul l'export devient du bruit blanc.
- Contrôle : `node tools/license-test.mjs <OniriqueLicenseTest.exe>` ; mode démo forcé : `ONIRIQUE_DEMO=1`.
  Ne pas toucher aux vraies licences de `ProgramData/Onirique/Licenses`.
- Le serveur refuse un plugin payant sans clé publique dans le binaire (`server/src/plugincheck.js`).
- Démos de la boutique : `tools/probe` sur le vrai `.vst3` (Windows), puis `deploy/attach-demo.mjs`.

## Notes de version
- N'écrire que ce qui est nouveau par rapport à la version précédente du même plugin (la relire avant).
- Une note propre à un système ne va pas sur la version de l'autre. `publish-plugin.mjs` met la même note
  sur Windows et Mac.

## Interfaces
- Partir d'un objet réel (métal, sérigraphie, potards usinés, verre) ; la lueur seulement pour ce qui émet de la
  lumière. Pas de halos partout, de capitales espacées en monospace, de cartes arrondies en dégradé.
- Vérifier par captures à l'échelle 1 et 2 ; mesurer le son avant / après plutôt que régler à l'aveugle.
- Charte de Nov « Nuit & Braise » : `server/src/da-vocalbox.html` (pas le plugin VOCAL MINI).

## Pièges
- Un plugin neuf sans licence affiche « Activation requise » et `tools/probe` ne trouve qu'une partie des
  boutons : faire la démo sur la version d'essai.
- `publish-plugin.mjs` incrémente la version : pour publier le Mac d'une version existante, `add-version.mjs … mac`.
