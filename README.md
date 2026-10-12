# ONIRIQUE CENTRAL

Le central des plugins ONIRIQUE : une application Windows pour installer, mettre à jour et
activer les plugins, avec comptes, licences, abonnement et panel admin.

```
server/   API (Node, SQLite) : comptes, licences, abonnements, fichiers des plugins
app/      application Windows (Electron), à la charte des plugins
```

## Lancer en local

```bash
cd server
npm install
npm run seed
npm start
```

```bash
cd app
npm install
ONIRIQUE_SERVER=http://localhost:4850 npm start
```

Sans `ONIRIQUE_SERVER`, l'application vise le serveur public `https://central.onirique.store`.

Le compte admin est celui de `server/.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`).
`npm run seed` crée ce compte, les deux plugins et les formules ; il accepte
`--tuner`, `--based` (fichiers `.vst3`) et `--tuner-image`, `--based-image` pour amorcer une base neuve.

`npm test` dans `server/` déroule tout le parcours de l'API sur une base jetable.

## Ce que fait l'application

- **Plugins** : la collection, l'état de chaque plugin sur ce PC, installation et mise à jour en un clic
  (téléchargement vérifié par empreinte SHA-256, copie dans le dossier VST3 avec demande de droits
  administrateur si Windows l'exige).
- **Licences** : ajout d'une clé `ONIR-XXXX-XXXX-XXXX-XXXX`, liste des licences, machines activées.
- **Abonnement** : All Access donne tous les plugins tant qu'il court ; à la carte, seulement ceux qui ont
  été choisis (9,99 € par mois pour le premier, 5 € par plugin ajouté : `pickBaseCents` et
  `pickExtraCents` dans `server/src/config.js`).
- **Panel admin** (comptes au rôle admin) : créer un plugin, publier une version (`.vst3`, `.zip`,
  `.exe`, `.msi`) avec ses notes, générer des clés par lot, modifier / révoquer / rétablir une licence,
  libérer ses machines, gérer les comptes et les prix, remettre à zéro les essais gratuits d'un compte,
  valider une adresse e-mail à la main.
- **Panel support** (admins) : les demandes envoyées depuis le site et l'application, avec de quoi y
  répondre et les retirer une fois réglées.

Un compte créé reçoit un lien de validation de son adresse e-mail. Tant qu'il n'est pas ouvert, les
essais, les achats et l'activation des plugins restent fermés ; sans serveur de messagerie configuré,
les comptes sont validés d'office.

## Rôles et créateurs

Un compte porte un rôle : `user` ; `vip` (tous les plugins offerts, sans licence à acheter) ; `abrasion` (partenaire : le
panel admin, limité à ses propres plugins, à leurs versions et à leurs licences) ; `admin` ; `founder` (au-dessus des
admins : lui seul donne ou retire les rôles admin et fondateur, et change le mot de passe d'un admin). Les adresses de
`FOUNDER_EMAILS` (`server/.env`, séparées par des virgules) reçoivent le rôle `founder` dès que leur adresse est validée.
Le rôle s'affiche sur la page Compte du site et dans l'application.

Chaque plugin a un créateur, `onirique` ou `abrasion` : la boutique et la bibliothèque filtrent par créateur et trient
par prix. `npm test` déroule ces règles dans `server/test/roles.mjs`.

## Travailler à plusieurs

Le code vit dans un dépôt git sur le serveur. Pour le récupérer, avec un accès SSH au serveur :

```bash
git clone root@217.160.106.244:/srv/git/onirique-central.git
```

Puis, comme d'habitude : `git pull` avant de commencer, `git commit`, `git push` une fois fini.
Une copie de travail à jour se trouve aussi sur le serveur, dans `/srv/onirique-central`.

Le dépôt ne contient ni les secrets (`server/.env`), ni les données (`server/data/` : base, clés de
signature, fichiers des plugins), ni les dépendances (`node_modules/`), ni ce qui se reconstruit
(`app/dist/`, `tools/probe/build/`). Pousser dans le dépôt ne met rien en ligne : le site et le serveur
en production se déploient à part (voir plus bas), l'application avec `deploy/release-app.sh`.

## Licences : comment un plugin vérifie

À l'activation, le serveur signe (Ed25519) une licence liée au compte, au plugin et à la machine.
L'application l'écrit dans `C:\ProgramData\Onirique\Licenses\<plugin>.lic` :

```json
{ "format": "onirique-license-v1", "payload": "<base64 du JSON>", "signature": "<base64>" }
```

Le JSON du `payload` : `product`, `email`, `machine`, `type`, `licenseId`, `issuedAt`, `expiresAt`
(millisecondes, `null` = sans limite). La signature porte sur les octets décodés du `payload`.

Côté plugin, le dossier `plugin-license/` de ce dépôt (copié tel quel dans chaque plugin sous le nom
`License/`, branchement décrit dans son `README.md`) lit ce fichier au lancement puis
toutes les cinq secondes, vérifie la signature avec la clé publique embarquée
(`GET /api/public-key`, champ `raw` = 32 octets en base64), puis contrôle `product`, `expiresAt` et
`machine`. Plugin acheté : rien ne change. Essai (`type` = `trial`) : écoute intacte, export remplacé par
un bruit blanc, pastille « ESSAI · ACTIVATION » qui ouvre ONIRIQUE CENTRAL. Sans licence valable : export
en bruit blanc et deux secondes de bruit toutes les trente secondes à l'écoute. Le panel admin indique,
plugin par plugin et version par version, ceux qui embarquent ce module. L'identifiant de machine est les 40 premiers
caractères hexadécimaux de `SHA-256("onirique:" + MachineGuid en minuscules)`, `MachineGuid` étant la
valeur de `HKLM\SOFTWARE\Microsoft\Cryptography`. **Un plugin qui n'embarque pas ce dossier s'ouvre
sans licence** : le serveur refuse donc de publier un plugin payant dont le `.vst3` ou le `.zip` ne
contient pas la clé publique (`server/src/plugincheck.js`, panel admin et scripts de `deploy/`).

Une licence perpétuelle n'expire pas hors ligne. Celle d'un abonnement expire trois jours après la
fin de la période payée ; l'application la renouvelle à chaque lancement.

## Version Mac

L'application tourne aussi sur macOS (Intel et Apple Silicon). Elle ne se construit que sur un Mac : c'est
GitHub Actions qui s'en charge (`.github/workflows/mac.yml`). Copier le dépôt sur GitHub, puis onglet
« Actions », « Application Mac », « Run workflow » : le fichier `ONIRIQUE-CENTRAL.dmg` se télécharge en bas
de la page de l'exécution. Il se met ensuite en ligne dans `/var/www/site/telechargement/`.

Ce qui diffère de Windows :

- Plugins dans `~/Library/Audio/Plug-Ins/VST3`, licences dans `/Users/Shared/Onirique/Licenses/<plugin>.lic`.
- Identifiant de machine : même calcul, avec l'`IOPlatformUUID` du Mac à la place du `MachineGuid`.
- Chaque version d'un plugin est envoyée pour un système (Windows ou Mac) depuis le panel admin. Pour Mac :
  le dossier `NOM.vst3` zippé en `NOM.vst3.zip`, ou un installateur `.pkg`. Un plugin sans version Mac
  s'affiche « Bientôt sur Mac ».
- Sans compte Apple Developer, l'application n'est ni signée ni notariée : macOS demande de l'autoriser à la
  première ouverture (clic droit, Ouvrir), et la mise à jour automatique est coupée sur Mac.
- La démo interactive d'un plugin ne se fabrique que depuis l'application Windows.

## Mise en production

1. Héberger `server/` (Node 22.13 ou plus) derrière HTTPS, avec `DATA_DIR` sur un disque sauvegardé :
   il contient la base, les fichiers des plugins et **la clé privée de signature** (`keys/`).
   La perdre invalide toutes les licences déjà émises.
2. Régler `PUBLIC_URL`, puis les paiements dans `.env` : `PAYMENTS_MODE=stripe` avec
   `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` (webhook à pointer sur `/api/stripe/webhook`,
   événements `checkout.session.completed` et `customer.subscription.*`). `demo` accorde les achats
   sans paiement : uniquement pour tester. `off` ferme la boutique (clés de licence seulement).
   `deploy/install.sh` fait toute l'installation sur un VPS Ubuntu 24.04 (Node, nginx, service, pare-feu,
   sauvegarde nocturne) ; le site statique de `site/` va dans `/var/www/site`.
3. Vérifier l'adresse publique dans `DEFAULT_SERVER` (`app/main/store.js`), puis construire l'installateur :

```bash
cd app
npm run dist
```

Pour publier une nouvelle version de l'application : `bash deploy/release-app.sh`. Le script augmente le numéro de version, construit l'installateur et le met en ligne avec `latest.yml` ; les applications installées la téléchargent seules et l'installent à leur fermeture.

L'installateur sort dans `app/dist/`. Il n'est pas signé : Windows SmartScreen avertira les
utilisateurs tant qu'un certificat de signature de code n'est pas ajouté.
