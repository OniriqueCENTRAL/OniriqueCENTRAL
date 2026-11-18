# Déploiement et production

- Dépôt de référence : `root@212.227.165.177:/srv/git/onirique-central.git`, branche `main`. Le remote `github`
  est un miroir qui ne sert qu'aux compilations Mac.
- `deploy/deploy.sh` pousse, puis `onirique-deploy` (source `deploy/onirique-deploy`) installe `main` sous verrou :
  les envois simultanés attendent leur tour, les tests du serveur passent avant, la version précédente revient si
  le serveur ne répond plus. Journal : `/var/lib/onirique-deploy/journal`. Il installe aussi `deploy/onirique-*`
  dans `/usr/local/bin`.
- Site statique : `/var/www/site` (copie précédente dans `/var/www/site.prev`). L'accueil se modifie dans
  `site/onirique.html`, puis `build.ps1` régénère `index.html` (à commiter). Pages légales : `node site/pages.mjs`.
- API : `/opt/onirique-central/server`, service `onirique-central`, données `/var/lib/onirique-central`.
- nginx : la configuration active est le fichier `/etc/nginx/sites-enabled/onirique` (pas un lien ; celui de
  `sites-available` est ancien), modifié par certbot : ne pas le réécrire. En-têtes communs :
  `/etc/nginx/snippets/onirique-securite.conf`.
  `central.onirique.store` = adresse de l'application et `PUBLIC_URL` du serveur.
- Après une mise en ligne, vérifier avec `curl`.
- L'API n'écoute que sur 127.0.0.1:4850 : tout passe par nginx.
- Durcissement (TURN, SSH, fail2ban, swap, CSP, page 404) : `onirique-securite`, en root, plusieurs fois sans risque.
- Double authentification obligatoire en production pour fondateurs, admins et partenaires (panel admin, versements).
- Sauvegarde : chaque nuit `onirique-backup` (14 jours dans `/var/backups/onirique-central`), puis copie chiffrée
  hors du VPS par restic une fois réglée par `onirique-sauvegarde-distante` (B2 ou S3, phrase de chiffrement gardée
  hors du VPS par les fondateurs). État du dernier envoi : `/var/backups/onirique-distante/etat` ; contrôle de
  restauration : `onirique-sauvegarde-distante essai` (à refaire de temps en temps).

## Application Windows (Electron, `app/`)
- `bash deploy/release-app.sh` (copie propre et à jour exigée ; pousse lui-même le commit « Application X »).
  Les applications installées se mettent à jour seules.
- Le PC qui publie a besoin de l'accès root SSH (sa clé dans `deploy/cles-fondateurs.pub`, posée à la mise en ligne
  suivante) et de Python avec `castlabs-evs` connecté (signature VMP, `app/build/vmp-sign.js`).
- Pièges : sans le droit de créer des liens symboliques, electron-builder échoue en extrayant `winCodeSign` ; extraire
  l'archive à la main dans `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` (les deux erreurs
  `darwin/*.dylib` sont sans effet sous Windows). Le raccourci `python` du Microsoft Store passe avant le vrai : mettre
  le dossier de Python en tête du PATH dans `~/.bashrc`. Dans une copie de travail temporaire, `npm ci` peut laisser
  `app/node_modules/electron/dist` vide (« rename electron.exe » à la construction, numéro de version perdu) : y copier
  celui de la copie principale avant `release-app.sh`.
- Après chaque version : rappeler de soumettre l'installateur sur `https://www.microsoft.com/wdsi/filesubmission`
  (« Software developer », fichier bloqué à tort par SmartScreen). L'application n'est pas signée par Microsoft.
- Mises à jour signées : `release-app.sh` et `release-navigateur.sh` appellent `onirique-signer` sur le VPS (clé
  `/etc/onirique/signature-maj.pem`, root seul). La clé publique est dans `app/main/signature.js` et
  `navigateur/Installation.cs` ; une version publiée sans signature est refusée par les programmes installés.
- Mac : en pause (voir CLAUDE.md). Quand il reprend : `git push github main`, étiquette `mac-<version>`, vérifier le
  numéro dans l'Info.plist du zip livré (pas les dates), puis `deploy/publish-mac.sh`.

## ONIRIQUE Navigateur (`navigateur/`, .NET 9 + WebView2)
- Publication : commit, `deploy.sh`, puis `bash deploy/release-navigateur.sh [minor]`. Mac (Swift, `navigateur/mac`) :
  étiquette `navmac-<version>-<lettre>` sur GitHub, puis `deploy/publish-navigateur-mac.sh`.
- VPN : `server/src/vpn.js`, port 3129 ; `deploy/install-vpn.sh` à lancer par une personne sur le VPS. Le navigateur
  présente un jeton au relais (réponse 407) ; l'ancien mode par adresse IP s'arrête le 31 déc. 2026 (`MODE_IP_JUSQUA`).

## ONIRIQUE FONDATEURS (`fondateurs/`)
- Boutons pour les gestes courants : récupérer, enregistrer les fichiers cochés, mettre en ligne (copie propre si
  d'autres fichiers sont en cours), publier l'application ou le navigateur, annuler un commit (`git revert` puis mise en
  ligne), état, journal (aussi en direct) et erreurs du serveur, sauvegarde, panel admin ; chiffres et support lus en
  lecture seule dans la base par SSH ; maintenance et annonce par l'API avec la session du panel admin ; patch note par
  `deploy/patchnote.mjs` ; notification Windows si le site ou l'API ne répond plus. Lancement : `fondateurs/ONIRIQUE FONDATEURS.cmd` (utilise l'Electron de `app/`, donc `cd app && npm install`
  une fois), ou `fondateurs/lanceur/dist/ONIRIQUE-FONDATEURS.exe` (`cd fondateurs/lanceur && npm run dist`) : le .exe
  retrouve le dossier du dépôt (demandé au premier lancement) et y lance l'app, qui suit donc `git pull`. Rien de secret dedans : il passe par la clé SSH du PC et les scripts de `deploy/`.

## Pièges
- CLIPS (`app/main/clips.js`) : un MP4 de MediaRecorder pris en cours d'enregistrement annonce une durée fausse et ne se coupe pas ; garder le WebM. Dans l'application, une boucle `requestAnimationFrame` (ou `requestVideoFrameCallback`) s'arrête quand la fenêtre est cachée : utiliser un minuteur ou `timeupdate`.
- Essais du serveur : quelques secondes de travail (ffmpeg) entre deux `fetch` font expirer la connexion gardée ouverte, et la requête suivante échoue (ECONNRESET) ; faire ce travail avant les requêtes.
- Un `backdrop-filter` sur l'en-tête en fait un calque à part : sans `z-index`, les titres animés de la page passent devant ses menus (réglé dans `da.css`). Changer `da.css` impose de monter son `?v=` dans toutes les pages (cache d'un an).
- Navigateur sans barre de titre : dans `WM_NCCALCSIZE`, tester `IsZoomed` et pas `WindowState` (pas encore à jour
  pendant l'agrandissement) ; une fenêtre agrandie déplacée garde sa mauvaise place, d'où le recalage dans `WM_WINDOWPOSCHANGING`.
- Une bulle d'aide (`ToolTip`) créée à chaque survol reste affichée : en garder une seule par contrôle.
- Essais du navigateur : toujours avec `ONIRIQUE_NAVIGATEUR_DOSSIER` vers un dossier temporaire ; ne jamais copier
  ni restaurer le `parametres.json` d'un utilisateur (une restauration a déjà écrasé ses réglages).
- Les clics simulés n'atteignent pas WebView2 : passer par `--remote-debugging-port` et `Runtime.evaluate`.
- Ne pas tester Google en boucle depuis un PC de l'équipe : captcha sur l'adresse IP.
- Wine + Xvfb sur le VPS pour `tools/probe` : interface noire, abandonné. Les démos se font sur un PC Windows.
- Compiler les plugins sur le VPS n'est pas possible ; assembler les zips Mac sur le VPS (un zip refait sous
  Windows perd le droit d'exécution).
- Le site d'un partenaire servi sous onirique.store pouvait lire la session des visiteurs : il va sur son sous-domaine
  (`onirique-abrasion-domaine`, après l'enregistrement DNS).
- `site/pages.mjs` est en retard sur les pages légales (modifiées à la main : Downloader, Instagram, CLOUD, « Signaler »…) : le relancer effacerait ce contenu ; modifier les `.html` directement, ou le resynchroniser d'abord.
- Les textes du site ont l'apostrophe typographique (’), le dictionnaire anglais l'apostrophe droite : `i18n.js` et `tools/i18n/extract.mjs` comparent sans en tenir compte ; garder ça si on touche au moteur.
- `fail2ban` bloque 1 h une IP après 5 échecs SSH : en cas de blocage, attendre ou `fail2ban-client set sshd unbanip <ip>`.
- Retirer une page du dépôt ne l'enlève pas du VPS : `deploy.sh` ne supprime rien dans `/var/www/site`. Après un retrait, effacer
  le fichier à la main dans `/var/www/site` (et `/var/www/site.prev`), puis vérifier qu'il répond 404.
