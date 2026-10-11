#!/bin/sh
# Prépare le serveur à recevoir les fichiers construits par GitHub Actions. À lancer une fois, en root, sur le serveur,
# avec le fichier onirique-livraison posé à côté de celui-ci :
#   sh install-livraison.sh
# Crée le compte « livraison » (sans mot de passe), le dossier /srv/livraison et une clé qui ne peut faire qu'une
# chose : déposer un fichier dans ce dossier. La clé privée s'affiche une seule fois, pour être collée dans le
# secret LIVRAISON_KEY des dépôts GitHub ; elle n'est gardée nulle part sur le serveur.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
id livraison >/dev/null 2>&1 || useradd --system --create-home --shell /bin/sh livraison
install -m 755 "$here/onirique-livraison" /usr/local/bin/onirique-livraison
install -d -o livraison -g livraison -m 755 /srv/livraison

home=$(getent passwd livraison | cut -d: -f6)
install -d -o livraison -g livraison -m 700 "$home/.ssh"
key=$(mktemp -u)
ssh-keygen -q -t ed25519 -N "" -C github-actions-livraison -f "$key"
# restrict : ni terminal, ni redirection de port ; command : seul le script de livraison s'exécute.
printf 'restrict,command="/usr/local/bin/onirique-livraison" %s\n' "$(cat "$key.pub")" > "$home/.ssh/authorized_keys"
chown livraison:livraison "$home/.ssh/authorized_keys"
chmod 600 "$home/.ssh/authorized_keys"

echo
echo "===== À copier en entier dans le secret LIVRAISON_KEY (de -----BEGIN à -----END compris) ====="
cat "$key"
echo "===== Fin. Cette clé ne sera plus affichée : relancer ce script en crée une nouvelle et annule l'ancienne. ====="
rm -f "$key" "$key.pub"
