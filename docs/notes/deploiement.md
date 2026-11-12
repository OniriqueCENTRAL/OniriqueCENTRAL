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
- nginx : `/etc/nginx/sites-available/onirique` (modifié par certbot, ne pas le réécrire).
  `central.onirique.store` = adresse de l'application et `PUBLIC_URL` du serveur.
- Après une mise en ligne, vérifier avec `curl`.

## Application Windows (Electron, `app/`)
- `bash deploy/release-app.sh` (copie propre et à jour exigée ; pousse lui-même le commit « Application X »).
  Les applications installées se mettent à jour seules.
- Après chaque version : rappeler de soumettre l'installateur sur `https://www.microsoft.com/wdsi/filesubmission`
  (« Software developer », fichier bloqué à tort par SmartScreen). L'application n'est pas signée.
- Mac : en pause (voir CLAUDE.md). Quand il reprend : `git push github main`, étiquette `mac-<version>`, vérifier le
  numéro dans l'Info.plist du zip livré (pas les dates), puis `deploy/publish-mac.sh`.

## ONIRIQUE Navigateur (`navigateur/`, .NET 9 + WebView2)
- Publication : commit, `deploy.sh`, puis `bash deploy/release-navigateur.sh [minor]`. Mac (Swift, `navigateur/mac`) :
  étiquette `navmac-<version>-<lettre>` sur GitHub, puis `deploy/publish-navigateur-mac.sh`.
- VPN : `server/src/vpn.js`, port 3129 ; `deploy/install-vpn.sh` à lancer par une personne sur le VPS.

## Pièges
- Essais du navigateur : toujours avec `ONIRIQUE_NAVIGATEUR_DOSSIER` vers un dossier temporaire ; ne jamais copier
  ni restaurer le `parametres.json` d'un utilisateur (une restauration a déjà écrasé ses réglages).
- Les clics simulés n'atteignent pas WebView2 : passer par `--remote-debugging-port` et `Runtime.evaluate`.
- Ne pas tester Google en boucle depuis un PC de l'équipe : captcha sur l'adresse IP.
- Wine + Xvfb sur le VPS pour `tools/probe` : interface noire, abandonné. Les démos se font sur un PC Windows.
- Compiler les plugins sur le VPS n'est pas possible ; assembler les zips Mac sur le VPS (un zip refait sous
  Windows perd le droit d'exécution).
