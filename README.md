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
- **Abonnement** : All Access donne tous les plugins tant qu'il court.
- **Panel admin** (comptes au rôle admin) : créer un plugin, publier une version (`.vst3`, `.zip`,
  `.exe`, `.msi`) avec ses notes, générer des clés par lot, modifier / révoquer / rétablir une licence,
  libérer ses machines, gérer les comptes et les prix.

## Licences : comment un plugin vérifie

À l'activation, le serveur signe (Ed25519) une licence liée au compte, au plugin et à la machine.
L'application l'écrit dans `C:\ProgramData\Onirique\Licenses\<plugin>.lic` :

```json
{ "format": "onirique-license-v1", "payload": "<base64 du JSON>", "signature": "<base64>" }
```

Le JSON du `payload` : `product`, `email`, `machine`, `type`, `licenseId`, `issuedAt`, `expiresAt`
(millisecondes, `null` = sans limite). La signature porte sur les octets décodés du `payload`.

Côté plugin, il reste à : lire ce fichier, vérifier la signature avec la clé publique
(`GET /api/public-key`, champ `raw` = 32 octets en base64, à embarquer dans le binaire), puis
contrôler `product`, `expiresAt` et `machine`. L'identifiant de machine est les 40 premiers
caractères hexadécimaux de `SHA-256("onirique:" + MachineGuid en minuscules)`, `MachineGuid` étant la
valeur de `HKLM\SOFTWARE\Microsoft\Cryptography`. **Les plugins actuels ne font pas encore cette
vérification** : tant qu'elle n'est pas ajoutée, ils s'ouvrent sans licence.

Une licence perpétuelle n'expire pas hors ligne. Celle d'un abonnement expire trois jours après la
fin de la période payée ; l'application la renouvelle à chaque lancement.

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
