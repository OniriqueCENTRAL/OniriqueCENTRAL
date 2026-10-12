#!/usr/bin/env bash
# Publie une nouvelle version de l'application ONIRIQUE CENTRAL. À lancer depuis Git Bash :
#
#   bash deploy/release-app.sh          (numéro suivant : 1.0.3 -> 1.0.4)
#   bash deploy/release-app.sh minor    (1.0.4 -> 1.1.0)
#
# Les applications déjà installées la téléchargent toutes seules et l'installent à leur prochaine fermeture.
set -euo pipefail

HOST=root@217.160.106.244
REMOTE=/var/www/site/telechargement
cd "$(dirname "$0")/../app"

npm version "${1:-patch}" --no-git-tag-version > /dev/null
VERSION=$(node -p "require('./package.json').version")
echo "Construction de la version $VERSION…"
npm run dist > /dev/null

EXE="ONIRIQUE-CENTRAL-Setup-$VERSION.exe"
[ -f "dist/$EXE" ] && [ -f dist/latest.yml ] || { echo "Construction incomplète : dist/$EXE ou dist/latest.yml manquant."; exit 1; }
grep -q "version: $VERSION" dist/latest.yml || { echo "latest.yml n'annonce pas la version $VERSION."; exit 1; }

# L'installateur d'abord, l'annonce (latest.yml) en dernier : aucune application ne voit une version dont le fichier manque.
scp -q -o BatchMode=yes "dist/$EXE" "dist/$EXE.blockmap" "$HOST:$REMOTE/"
ssh -o BatchMode=yes "$HOST" "cd $REMOTE && cp -f '$EXE' ONIRIQUE-CENTRAL-Setup.exe && chmod a+r ./*"
scp -q -o BatchMode=yes dist/latest.yml "$HOST:$REMOTE/latest.yml"
# Les trois dernières versions sont gardées (une application en cours de téléchargement ne doit pas perdre son fichier).
ssh -o BatchMode=yes "$HOST" "cd $REMOTE && ls -t ONIRIQUE-CENTRAL-Setup-*.exe | tail -n +4 | while read -r f; do rm -f \"\$f\" \"\$f.blockmap\"; done; chmod a+r latest.yml"

echo "Version $VERSION publiée."
# L'application n'est pas signée : SmartScreen repart de zéro à chaque version. La soumission se fait à la main.
echo "À faire : soumettre app/dist/$EXE à Microsoft (https://www.microsoft.com/wdsi/filesubmission, profil Software developer, fichier bloqué à tort par SmartScreen)."
