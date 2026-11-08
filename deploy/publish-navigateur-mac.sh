#!/usr/bin/env bash
# Met en ligne la version Mac d'ONIRIQUE Navigateur que GitHub vient de déposer sur le serveur
# (.github/workflows/navigateur-mac.yml, lancé en poussant une étiquette « navmac-<version> »). À lancer depuis Git Bash :
#
#   bash deploy/publish-navigateur-mac.sh
#
# Le .dmg devient celui du site ; le .zip et navigateur-mac.json servent à la mise à jour automatique des Mac.
set -euo pipefail

ssh -o BatchMode=yes root@212.227.165.177 flock /var/lock/onirique-deploy.lock python3 - <<'PYTHON'
import hashlib, json, os, plistlib, shutil, zipfile

source, site = '/srv/livraison', '/var/www/site/telechargement'
dmg, archive = f'{source}/ONIRIQUE-Navigateur.dmg', f'{source}/ONIRIQUE-Navigateur-mac.zip'
if abs(os.path.getmtime(dmg) - os.path.getmtime(archive)) > 900:
    raise SystemExit("Le .dmg et le .zip livrés ne viennent pas de la même compilation : relancez-la.")

with zipfile.ZipFile(archive) as z:
    version = plistlib.loads(z.read('ONIRIQUE Navigateur.app/Contents/Info.plist'))['CFBundleShortVersionString']
digest = hashlib.sha256()
with open(archive, 'rb') as f:
    for block in iter(lambda: f.read(1 << 20), b''):
        digest.update(block)

def install(path, name):
    shutil.copyfile(path, f'{site}/.{name}.part')
    os.chmod(f'{site}/.{name}.part', 0o644)
    os.replace(f'{site}/.{name}.part', f'{site}/{name}')

# Les fichiers d'abord, l'annonce en dernier : aucun navigateur ne voit une version dont le fichier manque.
name = f'ONIRIQUE-Navigateur-mac-{version}.zip'
install(dmg, 'ONIRIQUE-Navigateur.dmg')
install(archive, name)
with open(f'{site}/.navigateur-mac.json.part', 'w') as f:
    json.dump({'version': version, 'url': f'https://onirique.store/telechargement/{name}', 'sha256': digest.hexdigest()}, f)
os.chmod(f'{site}/.navigateur-mac.json.part', 0o644)
os.replace(f'{site}/.navigateur-mac.json.part', f'{site}/navigateur-mac.json')
old = sorted((n for n in os.listdir(site) if n.startswith('ONIRIQUE-Navigateur-mac-') and n.endswith('.zip')), key=lambda n: os.path.getmtime(f'{site}/{n}'))
for n in old[:-2]:
    os.remove(f'{site}/{n}')
print(f'Navigateur Mac {version} publié.')
PYTHON
