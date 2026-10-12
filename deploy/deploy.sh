#!/usr/bin/env bash
# Met en ligne le serveur et le site. À lancer depuis Git Bash, une fois le travail enregistré (git commit) :
#
#   bash deploy/deploy.sh
#
# Ce qui part en ligne est le dépôt (branche main), jamais les fichiers de ce PC : le script pousse d'abord votre
# travail, et s'arrête si un collaborateur a poussé entre-temps (git pull, puis relancer). Sur le serveur, les envois
# passent un par un : si quelqu'un d'autre est en train d'envoyer, le vôtre attend son tour (deploy/onirique-deploy).
set -euo pipefail

HOST=root@217.160.106.244
cd "$(dirname "$0")/.."
stop() { echo "$1" >&2; exit 1; }

[ -z "$(git status --porcelain --untracked-files=no)" ] || stop "Des modifications ne sont pas enregistrées : faites un git commit, puis relancez."
git fetch -q origin
mine=$(git rev-parse HEAD)
theirs=$(git rev-parse origin/main)
if [ "$mine" != "$theirs" ]; then
  if git merge-base --is-ancestor "$theirs" "$mine"; then
    git push -q origin HEAD:main || stop "Un collaborateur vient de pousser : git pull, vérifiez, puis relancez."
  elif git merge-base --is-ancestor "$mine" "$theirs"; then
    stop "Votre copie est en retard sur le dépôt : git pull, vérifiez, puis relancez."
  else
    stop "Votre travail et celui d'un collaborateur ont divergé : git pull (réglez les conflits s'il y en a), puis relancez."
  fi
fi

ssh -o BatchMode=yes "$HOST" onirique-deploy "$(printf '%q' "$(git config user.name || echo inconnu)")"
