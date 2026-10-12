/**
 * Le script qui remplace l'application Mac par sa nouvelle version, une fois l'application fermée.
 * Il vit ici, à part et sans dépendance, pour être essayé tel quel sur un vrai Mac par la compilation
 * (.github/workflows/mac.yml).
 *
 *   sh -c "$SCRIPT" sh <pid de l'application> <ONIRIQUE CENTRAL.app> <nouvelle .app> <dossier à nettoyer> <1 = rouvrir>
 *
 * La nouvelle version est d'abord recopiée à côté de l'ancienne ; l'ancienne n'est écartée qu'ensuite, et remise
 * en place si le remplacement échoue : à aucun moment il n'y a plus d'application.
 */
module.exports = `
APP=$2
NEW="$2.new"
OLD="$2.old"
STAGE=$4
REOPEN=$5
finish() { if [ "$REOPEN" = 1 ]; then open "$APP"; fi; exit "$1"; }
while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
rm -rf "$NEW" "$OLD"
ditto "$3" "$NEW" || { rm -rf "$NEW"; finish 1; }
mv "$APP" "$OLD" || { rm -rf "$NEW"; finish 1; }
if mv "$NEW" "$APP"; then rm -rf "$OLD" "$STAGE"; else mv "$OLD" "$APP"; finish 1; fi
finish 0
`;
