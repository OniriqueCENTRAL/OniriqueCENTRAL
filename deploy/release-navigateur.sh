#!/usr/bin/env bash
# Publie ONIRIQUE Navigateur (dossier navigateur/) sur onirique.store/telechargement/ONIRIQUE-Navigateur.exe.
# À lancer depuis Git Bash, sur un PC Windows avec le SDK .NET 9 :
#
#   bash deploy/release-navigateur.sh
#
# Le fichier est construit depuis le dépôt à jour, envoyé sous un nom provisoire, puis renommé : un téléchargement
# en cours n'est jamais coupé par un fichier à moitié envoyé.
set -euo pipefail
stop() { echo "$1" >&2; exit 1; }

HOST=root@212.227.165.177
REMOTE=/var/www/site/telechargement
cd "$(dirname "$0")/../navigateur"

[ -z "$(git status --porcelain --untracked-files=no .)" ] || stop "Des modifications du navigateur ne sont pas enregistrées : faites un git commit, puis relancez."
git fetch -q origin
[ "$(git rev-parse HEAD:navigateur)" = "$(git rev-parse origin/main:navigateur)" ] || stop "Le navigateur n'est pas celui du dépôt : git pull ou git push, puis relancez."

rm -rf bin/publish
dotnet publish -c Release -o bin/publish -v q -nologo > /dev/null
EXE="bin/publish/ONIRIQUE Navigateur.exe"
[ -f "$EXE" ] || stop "Construction incomplète : $EXE manquant."

scp -q -o BatchMode=yes "$EXE" "$HOST:$REMOTE/.ONIRIQUE-Navigateur.exe.part"
ssh -o BatchMode=yes "$HOST" "cd $REMOTE && chmod a+r .ONIRIQUE-Navigateur.exe.part && mv -f .ONIRIQUE-Navigateur.exe.part ONIRIQUE-Navigateur.exe"

echo "ONIRIQUE Navigateur publié : https://onirique.store/telechargement/ONIRIQUE-Navigateur.exe"
# Le fichier n'est pas signé : SmartScreen repart de zéro à chaque envoi. La soumission se fait à la main.
echo "À faire : soumettre navigateur/$EXE à Microsoft (https://www.microsoft.com/wdsi/filesubmission, profil Software developer, fichier bloqué à tort par SmartScreen)."
