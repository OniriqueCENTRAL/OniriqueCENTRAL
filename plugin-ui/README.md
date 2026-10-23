# L'interface commune des plugins ONIRIQUE

`OniriqueKnob.h` (le potard) et `OniriqueWindowSize.h` (la taille d'ouverture) sont copiés dans chaque plugin.
Chacun décide de la D.A de ses propres plugins :

| Propriétaire | Plugins |
|---|---|
| ONIRIQUE | TUNER, CHANNEL STRIP, VERB |
| TOM | RESOBOX, ECHOBOX, MODBOX, METERBOX, DOUBLEBOX, PITCHBOX |
| Nov | les autres plugins ONIRIQUE (VOCALBOX, VOCAL SPACER, THE CHOIR, EQ, RISER, PLAYER, BROADCAST, STREAM) |
| RELIC | BLOOM |
| ABRASION | MIMIC, RAW, TAMA VOX |

La liste fait foi dans `plugins.json`.

## Changer la D.A

1. Modifier le fichier ici, dans `plugin-ui/`.
2. Lancer `node tools/plugin-ui.mjs`. Le script demande si le changement vaut :
   - **pour tes plugins seulement** : ta version est rangée dans `plugin-ui/<toi>/` et ne part que dans tes plugins ; la version commune ne bouge pas ;
   - **pour les plugins de tout le monde** : la version commune change, et elle part dans tous les plugins, y compris ceux des autres (prévenez-les).
3. Commiter `plugin-ui/` ici, puis chaque dépôt de plugin mis à jour. Attention : dans certains plugins, un push publie une version.

Une version rangée dans `plugin-ui/<propriétaire>/` l'emporte sur la commune pour les plugins de ce propriétaire.
Ne jamais modifier à la main la D.A (potard, couleurs, polices, panneaux) d'un plugin qui n'est pas le sien.
