# Règles communes du projet ONIRIQUE CENTRAL

Ce fichier est lu au début de chaque session, par chaque membre de l'équipe. Il reste court : le détail est dans
`docs/notes/`, à ouvrir **seulement** quand la tâche touche le sujet.

## Toujours
- Écrire en français, avec apostrophes et guillemets français (« à l'export »), y compris dans les commits.
- Aucune trace d'outil dans le dépôt : pas de ligne `Co-Authored-By`, pas de nom d'outil, pas de commentaire
  ou de fichier de notes « pour soi » dans le code, les textes publiés ou les commits.
- `git pull` avant de modifier. Plusieurs personnes travaillent en même temps dans le même dossier :
  regarder `git status` et n'ajouter que ses propres fichiers (jamais `git add site` ou `git add .` à l'aveugle).
- Mise en ligne du site et du serveur : `git commit`, puis `bash deploy/deploy.sh`, rien d'autre (jamais `scp`).
  Si des fichiers d'une autre session ne sont pas commités : `git worktree add --detach <dossier temporaire> HEAD`,
  `bash deploy/deploy.sh` dedans, puis `git worktree remove`.
- Le VPS est `root@212.227.165.177`. L'ancien (`217.160.106.244`) seulement si « ancien VPS » est demandé.
- Ne jamais saisir, demander ni recopier un mot de passe, une clé ou un jeton. Les secrets vivent sur le VPS
  (`/etc/onirique/`, `.env` du serveur), posés par les commandes `onirique-*` que la personne lance elle-même.
  Quand une connexion est nécessaire, écrire clairement le site, le compte et la commande à lancer.
- Ne jamais créer de compte de test sur la production. Tester en local (`cd server && npm test`).
- Dire honnêtement ce qui n'a pas été essayé.

## Ne pas faire sans demande
- Pas de version Mac de l'application (ni étiquette `mac-*`, ni `deploy/publish-mac.sh`).
- Ne pas changer la D.A d'un plugin qui n'est pas le sien (propriétaires dans `docs/notes/plugins.md`).
- Ne pas réécrire l'historique partagé (pas de push forcé).

## Notes par sujet (`docs/notes/`)
- `deploiement.md` : VPS, chemins, site, API, application Windows, navigateur.
- `paiements.md` : Stripe plugins et abonnements, packs de prods, Stripe Connect.
- `plugins.md` : dépôts des plugins, propriétaires, publication des versions, licences, notes de version, interfaces.
- `discord.md` : bot, patch notes, annonces des sorties.
- `google.md` : YouTube, Gmail, Pinterest (réglages côté Google avant le code).
- `divers.md` : ROCKY, trailer, scan ACRCloud, charte Nuit & Braise, navigateur.

## Erreurs déjà faites
Quand une erreur est trouvée et corrigée, ajouter **une ligne** dans la note du sujet, rubrique « Pièges »
(ce qui casse, comment l'éviter). Ici, seulement les pièges qui touchent tout le monde :
- Un déploiement par copie de fichiers, resté en retard, a écrasé en production le travail d'un collaborateur.
- `git add site` a déjà embarqué le travail en cours d'une autre session.
- Une note de version recopiée sur Windows et Mac s'est affichée deux fois ; ne noter que le nouveau.
- Dans un heredoc bash, `\\` devient `\` : écrire les scripts avec un fichier, pas un heredoc.
