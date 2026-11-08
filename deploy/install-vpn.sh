#!/usr/bin/env bash
# Prépare le serveur pour le VPN d'ONIRIQUE Navigateur (une seule fois, puis à chaque nouveau serveur) :
#
#   bash deploy/install-vpn.sh
#
# Le certificat du site est copié là où le service peut le lire (et recopié à chaque renouvellement par certbot),
# le port 3129 est ouvert, puis le service est relancé pour démarrer le relais (server/src/vpn.js).
set -euo pipefail
HOST=root@212.227.165.177

ssh -o BatchMode=yes "$HOST" bash -s <<'EOF'
set -euo pipefail
hook=/etc/letsencrypt/renewal-hooks/deploy/onirique-vpn.sh
cat > "$hook" <<'HOOK'
#!/bin/sh
dest=/var/lib/onirique-central/vpn
mkdir -p "$dest"
cp /etc/letsencrypt/live/onirique.store/fullchain.pem /etc/letsencrypt/live/onirique.store/privkey.pem "$dest/"
chown -R central:central "$dest"
chmod 700 "$dest"
chmod 600 "$dest"/*.pem
HOOK
chmod 755 "$hook"
"$hook"
ufw allow 3129/tcp comment 'VPN ONIRIQUE Navigateur' > /dev/null
systemctl restart onirique-central
sleep 2
journalctl -u onirique-central -n 30 --no-pager | grep -E 'VPN' || true
EOF
