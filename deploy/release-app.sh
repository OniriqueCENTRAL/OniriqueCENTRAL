#!/usr/bin/env bash
# Publie une nouvelle version de l'application ONIRIQUE CENTRAL. À lancer depuis Git Bash :
#
#   bash deploy/release-app.sh          (numéro suivant : 1.0.3 -> 1.0.4)
#   bash deploy/release-app.sh minor    (1.0.4 -> 1.1.0)
#
# Les applications déjà installées la téléchargent toutes seules et l'installent à leur prochaine fermeture.
#
# À plusieurs : la version part du dépôt à jour, et son numéro est poussé avant la construction. Si un collaborateur
# publie au même moment, un seul des deux obtient le numéro ; l'autre fait git pull et relance, il aura le suivant.
set -euo pipefail
stop() { echo "$1" >&2; exit 1; }

HOST=root@217.160.106.244
REMOTE=/var/www/site/telechargement
cd "$(dirname "$0")/../app"

[ -z "$(git status --porcelain --untracked-files=no)" ] || stop "Des modifications ne sont pas enregistrées : faites un git commit, puis relancez."
git fetch -q origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || stop "Votre copie n'est pas celle du dépôt : git pull ou git push, puis relancez."

npm version "${1:-patch}" --no-git-tag-version > /dev/null
VERSION=$(node -p "require('./package.json').version")
# Le numéro est réservé tout de suite dans le dépôt : deux personnes ne construisent jamais la même version.
git commit -q -m "Application $VERSION" package.json package-lock.json
if ! git push -q origin HEAD:main; then
  git reset -q --hard HEAD~1
  stop "Un collaborateur vient de pousser : git pull, puis relancez."
fi
echo "Construction de la version $VERSION…"
npm run dist > /dev/null

EXE="ONIRIQUE-CENTRAL-Setup-$VERSION.exe"
[ -f "dist/$EXE" ] && [ -f dist/latest.yml ] || { echo "Construction incomplète : dist/$EXE ou dist/latest.yml manquant."; exit 1; }
grep -q "version: $VERSION" dist/latest.yml || { echo "latest.yml n'annonce pas la version $VERSION."; exit 1; }

# L'installateur d'abord, l'annonce (latest.yml) en dernier : aucune application ne voit une version dont le fichier manque.
# Une version plus récente publiée entre-temps par quelqu'un d'autre reste en ligne : celle-ci n'est pas envoyée.
ONLINE=$(ssh -o BatchMode=yes "$HOST" "sed -n 's/^version: //p' $REMOTE/latest.yml 2>/dev/null" || true)
if [ -n "$ONLINE" ] && [ "$(echo "$ONLINE"; echo "$VERSION")" != "$( (echo "$ONLINE"; echo "$VERSION") | sort -V)" ]; then
  stop "La version $ONLINE, plus récente, est déjà en ligne : la $VERSION n'a pas été envoyée."
fi
scp -q -o BatchMode=yes "dist/$EXE" "dist/$EXE.blockmap" "$HOST:$REMOTE/"
ssh -o BatchMode=yes "$HOST" "cd $REMOTE && cp -f '$EXE' ONIRIQUE-CENTRAL-Setup.exe && chmod a+r ./*"
scp -q -o BatchMode=yes dist/latest.yml "$HOST:$REMOTE/latest.yml"
# Les trois dernières versions sont gardées (une application en cours de téléchargement ne doit pas perdre son fichier).
ssh -o BatchMode=yes "$HOST" "cd $REMOTE && ls -t ONIRIQUE-CENTRAL-Setup-*.exe | tail -n +4 | while read -r f; do rm -f \"\$f\" \"\$f.blockmap\"; done; chmod a+r latest.yml"

echo "Version $VERSION publiée."
# L'application n'est pas signée : SmartScreen repart de zéro à chaque version. La soumission se fait à la main.
echo "À faire : soumettre app/dist/$EXE à Microsoft (https://www.microsoft.com/wdsi/filesubmission, profil Software developer, fichier bloqué à tort par SmartScreen)."
