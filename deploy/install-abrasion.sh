#!/bin/bash
# Compte « abrasion » : il pousse sur le dépôt et lance une mise en ligne, mais seulement pour des changements
# dans site/abrasion/. Pas de shell (git-shell), pas de tunnel SSH, pas d'autre droit root que onirique-deploy.
#
# À lancer en root sur le serveur (plusieurs fois sans risque) :
#   bash install-abrasion.sh                       met en place le compte
#   bash install-abrasion.sh "ssh-ed25519 AAAA…"   ajoute aussi une clé SSH
#
# De son côté :
#   git clone abrasion@212.227.165.177:/srv/git/onirique-central.git
#   bash deploy/deploy.sh        (pousse, puis met en ligne comme pour tout le monde)
set -euo pipefail

repo=/srv/git/onirique-central.git
user=abrasion

id "$user" > /dev/null 2>&1 || useradd --create-home --shell /usr/bin/git-shell "$user"
home=$(getent passwd "$user" | cut -d: -f6)

# Le dépôt devient modifiable par le groupe du compte ; config, HEAD et hooks restent à root seul.
git --git-dir="$repo" config core.sharedRepository group
git config --system --get-all safe.directory | grep -qxF "$repo" || git config --system --add safe.directory "$repo"
chgrp -R "$user" "$repo"
chmod -R g+rwX "$repo"
find "$repo" -type d -exec chmod g+s {} +
chmod -R g-w "$repo/hooks" "$repo/config" "$repo/HEAD"

cat > "$repo/hooks/pre-receive" << 'HOOK'
#!/bin/bash
# Le compte abrasion ne change que site/abrasion/ (fichiers ordinaires), sur main, sans réécrire l'historique.
[ "$(id -un)" = abrasion ] || exit 0
zero=0000000000000000000000000000000000000000
while read -r old new ref; do
  if [ "$ref" != refs/heads/main ]; then echo "Envoi refusé : seule la branche main est acceptée."; exit 1; fi
  if [ "$old" = "$zero" ] || [ "$new" = "$zero" ]; then echo "Envoi refusé : création ou suppression de branche."; exit 1; fi
  if ! git merge-base --is-ancestor "$old" "$new"; then echo "Envoi refusé : votre copie est en retard (git pull, puis relancez)."; exit 1; fi
  # --no-renames : un déplacement depuis un autre dossier compte aussi comme une suppression là-bas.
  outside=$(git diff --name-only --no-renames "$old" "$new" | grep -v '^site/abrasion/' || true)
  if [ -n "$outside" ]; then
    echo "Envoi refusé : vous ne pouvez modifier que site/abrasion/. Fichiers en dehors :"
    echo "$outside" | sed 's/^/  /'
    exit 1
  fi
  # Ni lien symbolique ni sous-module : le serveur web suivrait un lien vers d'autres fichiers du serveur.
  odd=$(git ls-tree -r "$new" -- site/abrasion | awk '$1 != "100644" && $1 != "100755" { print "  " $4 }')
  if [ -n "$odd" ]; then echo "Envoi refusé : liens symboliques ou sous-modules interdits :"; echo "$odd"; exit 1; fi
done
HOOK
chmod 755 "$repo/hooks/pre-receive"

# La seule commande disponible en SSH : la mise en ligne, dans la file d'attente commune.
install -d -o root -g root -m 755 "$home/git-shell-commands"
printf '#!/bin/sh\nexec sudo -n /usr/local/bin/onirique-deploy abrasion\n' > "$home/git-shell-commands/deploy"
chmod 755 "$home/git-shell-commands/deploy"
echo "$user ALL=(root) NOPASSWD: /usr/local/bin/onirique-deploy abrasion" > /etc/sudoers.d/onirique-abrasion
chmod 440 /etc/sudoers.d/onirique-abrasion
visudo -cf /etc/sudoers.d/onirique-abrasion > /dev/null

# Clés à root : le compte ne peut pas retirer « restrict » de sa propre clé.
install -d -o root -g root -m 755 "$home/.ssh"
touch "$home/.ssh/authorized_keys"
chown root:root "$home/.ssh/authorized_keys"
chmod 644 "$home/.ssh/authorized_keys"
if [ -n "${1:-}" ]; then
  grep -qF "$1" "$home/.ssh/authorized_keys" || echo "restrict $1" >> "$home/.ssh/authorized_keys"
fi
echo "Compte $user prêt ($(grep -c . "$home/.ssh/authorized_keys") clé(s) SSH)."
