#!/usr/bin/env bash
# Installe ou met à jour ONIRIQUE CENTRAL et le site sur un VPS Ubuntu (24.04 ou plus). À lancer en root :
#
#   bash install.sh <domaine-du-site> <domaine-du-central> <email-admin>
#   ex. bash install.sh onirique.fr central.onirique.fr contact@onirique.fr
#
# Attend le code du serveur dans /opt/onirique-central/server (copié par scp, voir README).
# Peut être relancé sans risque : le .env, la base et les clés existants ne sont jamais écrasés.
set -euo pipefail

SITE=${1:?domaine du site manquant}
CENTRAL=${2:?domaine du central manquant}
EMAIL=${3:?e-mail admin manquant}
APP=/opt/onirique-central/server
DATA=/var/lib/onirique-central
WWW=/var/www/site
[ -f "$APP/package.json" ] || { echo "Code du serveur introuvable dans $APP"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq nginx certbot python3-certbot-nginx ufw sqlite3 curl
# Le serveur demande Node 22.13 ou plus : celui d'Ubuntu s'il suffit (26.04), sinon NodeSource (24.04 n'a que le 18).
node_ok() { node -e 'process.exit(process.versions.node.split(".")[0] >= 22 ? 0 : 1)' 2>/dev/null; }
node_ok || apt-get install -yq nodejs npm
if ! node_ok; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -yq nodejs
fi

id central &>/dev/null || useradd --system --home "$DATA" --shell /usr/sbin/nologin central
mkdir -p "$DATA" "$WWW" /var/backups/onirique-central
[ -f "$WWW/index.html" ] || echo "<!doctype html><meta charset=utf-8><title>ONIRIQUE</title><p>Site en cours d'installation." > "$WWW/index.html"

if [ ! -f "$APP/.env" ]; then
  cat > "$APP/.env" <<EOF
PORT=4850
PUBLIC_URL=https://$CENTRAL
DATA_DIR=$DATA
ADMIN_EMAIL=$EMAIL
ADMIN_PASSWORD=$(openssl rand -base64 18 | tr '+/' '-_')
# "off" : boutique fermée, clés de licence seulement. Passer à "stripe" une fois les clés Stripe renseignées.
PAYMENTS_MODE=off
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
EOF
  echo ">>> Mot de passe admin généré dans $APP/.env (ADMIN_PASSWORD)"
fi
chmod 600 "$APP/.env"
chown -R central:central "$DATA" /var/backups/onirique-central "$APP"

cd "$APP"
runuser -u central -- npm ci --omit=dev --no-fund --no-audit
runuser -u central -- node src/seed.js

cat > /etc/systemd/system/onirique-central.service <<EOF
[Unit]
Description=ONIRIQUE CENTRAL (API)
After=network.target

[Service]
User=central
WorkingDirectory=$APP
ExecStart=/usr/bin/node src/index.js
Environment=NODE_ENV=production
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable onirique-central
systemctl restart onirique-central

# Écrit une seule fois : certbot y ajoute ensuite le HTTPS, qu'une relance ne doit pas effacer.
[ -f /etc/nginx/sites-available/onirique ] || cat > /etc/nginx/sites-available/onirique <<EOF
server {
    listen 80;
    server_name $SITE www.$SITE;
    root $WWW;
    charset utf-8;
    charset_types text/plain text/css application/xml text/xml;
    index index.html;
    location / { try_files \$uri \$uri.html \$uri/ =404; }
    # La page compte du site parle au CENTRAL par la même origine.
    location /api/ {
        # Envoi d'images et de versions depuis la page admin du site.
        client_max_body_size 2g;
        proxy_request_buffering off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_pass http://127.0.0.1:4850;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 80;
    server_name $CENTRAL;
    # Envoi des versions de plugins depuis le panel admin : jusqu'à 2 Go, transmis au fil de l'eau.
    client_max_body_size 2g;
    proxy_request_buffering off;
    location / {
        proxy_pass http://127.0.0.1:4850;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/onirique /etc/nginx/sites-enabled/onirique
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# Pare-feu : SSH et web seulement. Le port 4850 de l'API n'est joignable que par nginx.
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

# Sauvegarde chaque nuit : copie cohérente de la base, clés de signature, fichiers des plugins. 14 jours gardés.
cat > /etc/cron.daily/onirique-central-backup <<EOF
#!/bin/sh
set -e
D=/var/backups/onirique-central/\$(date +%F)
mkdir -p "\$D"
sqlite3 $DATA/central.db ".backup '\$D/central.db'"
cp -a $DATA/keys $DATA/files $DATA/media "\$D/"
find /var/backups/onirique-central -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
EOF
chmod +x /etc/cron.daily/onirique-central-backup

sleep 2
curl -fsS http://127.0.0.1:4850/api/health && echo
echo ">>> Serveur en marche. Une fois le DNS de $SITE et $CENTRAL pointé sur ce VPS, activer HTTPS :"
echo "    certbot --nginx -d $SITE -d www.$SITE -d $CENTRAL -m $EMAIL --agree-tos --redirect -n"
