#!/usr/bin/env bash
# Dépose la charte graphique sur le serveur, où les fondateurs la téléchargent depuis le panel admin du site.
#   node tools/brand-kit/build.mjs <dossier>  puis  bash deploy/upload-brand-kit.sh <dossier>/ONIRIQUE-charte-graphique.zip
set -euo pipefail
zip="${1:?chemin du .zip}"
HOST=root@212.227.165.177
ssh -o BatchMode=yes "$HOST" 'install -d -o central -g central /var/lib/onirique-central/brand'
scp -q "$zip" "$HOST:/var/lib/onirique-central/brand/ONIRIQUE-charte-graphique.zip.part"
ssh -o BatchMode=yes "$HOST" 'cd /var/lib/onirique-central/brand && chown central:central ONIRIQUE-charte-graphique.zip.part && mv ONIRIQUE-charte-graphique.zip.part ONIRIQUE-charte-graphique.zip && ls -la'
