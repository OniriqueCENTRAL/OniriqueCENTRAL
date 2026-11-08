#!/usr/bin/env bash
# Publie une nouvelle version d'ONIRIQUE Navigateur (dossier navigateur/). À lancer depuis Git Bash, sur un PC Windows
# avec le SDK .NET 9 :
#
#   bash deploy/release-navigateur.sh          (numéro suivant : 1.1.0 -> 1.1.1)
#   bash deploy/release-navigateur.sh minor    (1.1.3 -> 1.2.0)
#
# Les navigateurs installés la téléchargent tout seuls (telechargement/navigateur.json) et l'ouvrent au lancement suivant.
# Comme pour l'application : le numéro est poussé avant la construction, deux personnes n'ont jamais le même.
set -euo pipefail
stop() { echo "$1" >&2; exit 1; }

HOST=root@212.227.165.177
REMOTE=/var/www/site/telechargement
cd "$(dirname "$0")/../navigateur"

[ -z "$(git status --porcelain --untracked-files=no .)" ] || stop "Des modifications du navigateur ne sont pas enregistrées : faites un git commit, puis relancez."
git fetch -q origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || stop "Votre copie n'est pas celle du dépôt : git pull ou git push, puis relancez."

ACTUELLE=$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' Navigateur.csproj)
IFS=. read -r MAJ MIN PAT <<< "$ACTUELLE"
case "${1:-patch}" in
  minor) VERSION="$MAJ.$((MIN + 1)).0" ;;
  major) VERSION="$((MAJ + 1)).0.0" ;;
  *) VERSION="$MAJ.$MIN.$((PAT + 1))" ;;
esac
sed -i "s:<Version>$ACTUELLE</Version>:<Version>$VERSION</Version>:" Navigateur.csproj
git commit -q -m "Navigateur $VERSION" Navigateur.csproj
if ! git push -q origin HEAD:main; then
  git reset -q --hard HEAD~1
  stop "Un collaborateur vient de pousser : git pull, puis relancez."
fi

echo "Construction de la version $VERSION…"
rm -rf bin/publish
dotnet publish -c Release -o bin/publish -v q -nologo > /dev/null
EXE="bin/publish/ONIRIQUE Navigateur.exe"
[ -f "$EXE" ] || stop "Construction incomplète : $EXE manquant."
SHA=$(sha256sum "$EXE" | cut -d' ' -f1)
NOM="ONIRIQUE-Navigateur-Setup-$VERSION.exe"

# Le fichier d'abord (sous un nom provisoire, puis renommé), l'annonce en dernier : aucun navigateur ne voit une
# version dont le fichier manque, et un téléchargement en cours n'est jamais coupé.
scp -q -o BatchMode=yes "$EXE" "$HOST:$REMOTE/.$NOM.part"
ssh -o BatchMode=yes "$HOST" "cd $REMOTE && mv -f '.$NOM.part' '$NOM' && cp -f '$NOM' ONIRIQUE-Navigateur-Setup.exe && cp -f '$NOM' ONIRIQUE-Navigateur.exe && chmod a+r ./*"
printf '{"version":"%s","url":"https://onirique.store/telechargement/%s","sha256":"%s"}\n' "$VERSION" "$NOM" "$SHA" > bin/navigateur.json
scp -q -o BatchMode=yes bin/navigateur.json "$HOST:$REMOTE/.navigateur.json.part"
ssh -o BatchMode=yes "$HOST" "cd $REMOTE && mv -f .navigateur.json.part navigateur.json && chmod a+r navigateur.json && ls -t ONIRIQUE-Navigateur-Setup-*.exe | tail -n +4 | xargs -r rm -f"

echo "ONIRIQUE Navigateur $VERSION publié : https://onirique.store/telechargement/ONIRIQUE-Navigateur-Setup.exe"
# Le fichier n'est pas signé : SmartScreen repart de zéro à chaque version. La soumission se fait à la main.
echo "À faire : soumettre navigateur/$EXE à Microsoft (https://www.microsoft.com/wdsi/filesubmission, profil Software developer, fichier bloqué à tort par SmartScreen)."
