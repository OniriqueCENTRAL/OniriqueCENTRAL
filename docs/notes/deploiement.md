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

## Application Windows (Electron, `app/`)
- `bash deploy/release-app.sh` (copie propre et à jour exigée ; pousse lui-même le commit « Application X »).
  Les applications installées se mettent à jour seules.
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
  d'autres fichiers sont en cours), publier l'application ou le navigateur, état, journal et erreurs du serveur, panel
  admin. Lancement : `fondateurs/ONIRIQUE FONDATEURS.cmd` (utilise l'Electron de `app/`, donc `cd app && npm install`
  une fois). Rien de secret dedans : il passe par la clé SSH du PC et les scripts de `deploy/`.

## Pièges
- Essais du navigateur : toujours avec `ONIRIQUE_NAVIGATEUR_DOSSIER` vers un dossier temporaire ; ne jamais copier
  ni restaurer le `parametres.json` d'un utilisateur (une restauration a déjà écrasé ses réglages).
- Les clics simulés n'atteignent pas WebView2 : passer par `--remote-debugging-port` et `Runtime.evaluate`.
- Ne pas tester Google en boucle depuis un PC de l'équipe : captcha sur l'adresse IP.
- Wine + Xvfb sur le VPS pour `tools/probe` : interface noire, abandonné. Les démos se font sur un PC Windows.
- Compiler les plugins sur le VPS n'est pas possible ; assembler les zips Mac sur le VPS (un zip refait sous
  Windows perd le droit d'exécution).
- Le site d'un partenaire servi sous onirique.store pouvait lire la session des visiteurs : il va sur son sous-domaine
  (`onirique-abrasion-domaine`, après l'enregistrement DNS).
- `fail2ban` bloque 1 h une IP après 5 échecs SSH : en cas de blocage, attendre ou `fail2ban-client set sshd unbanip <ip>`.
