#!/usr/bin/env bash
# Met en ligne la version Mac de l'application que GitHub Actions vient de déposer sur le serveur
# (.github/workflows/mac.yml, lancé en poussant une étiquette « mac-<version> »). À lancer depuis Git Bash :
#
#   bash deploy/publish-mac.sh
#
# Le .dmg remplace celui du site. Le .zip et latest-mac.json servent à la mise à jour automatique : les
# applications Mac installées lisent ce fichier, puis téléchargent le .zip s'il annonce une version plus récente.
set -euo pipefail

ssh -o BatchMode=yes root@217.160.106.244 python3 - <<'PYTHON'
import hashlib, json, os, plistlib, shutil, zipfile

source, site = '/srv/livraison', '/var/www/site/telechargement'
dmg, archive = f'{source}/ONIRIQUE-CENTRAL.dmg', f'{source}/ONIRIQUE-CENTRAL-mac.zip'
# Les deux fichiers viennent de la même compilation : livrés à moins d'un quart d'heure d'écart.
if abs(os.path.getmtime(dmg) - os.path.getmtime(archive)) > 900:
    raise SystemExit("Le .dmg et le .zip livrés ne viennent pas de la même compilation : relancez-la.")

# Le numéro de version est lu dans l'application elle-même.
with zipfile.ZipFile(archive) as z:
    version = plistlib.loads(z.read('ONIRIQUE CENTRAL.app/Contents/Info.plist'))['CFBundleShortVersionString']
digest = hashlib.sha256()
with open(archive, 'rb') as f:
    for block in iter(lambda: f.read(1 << 20), b''):
        digest.update(block)

def install(path, name):
    shutil.copyfile(path, f'{site}/.{name}.part')
    os.chmod(f'{site}/.{name}.part', 0o644)
    os.replace(f'{site}/.{name}.part', f'{site}/{name}')

# Les fichiers d'abord, l'annonce en dernier : aucune application ne voit une version dont le fichier manque.
name = f'ONIRIQUE-CENTRAL-mac-{version}.zip'
install(dmg, 'ONIRIQUE-CENTRAL.dmg')
install(archive, name)
with open(f'{site}/.latest-mac.json.part', 'w') as f:
    json.dump({'version': version, 'url': f'https://onirique.store/telechargement/{name}', 'sha256': digest.hexdigest(), 'size': os.path.getsize(archive)}, f)
os.chmod(f'{site}/.latest-mac.json.part', 0o644)
os.replace(f'{site}/.latest-mac.json.part', f'{site}/latest-mac.json')
# Les deux dernières archives sont gardées (une application en cours de téléchargement ne doit pas perdre son fichier).
old = sorted((n for n in os.listdir(site) if n.startswith('ONIRIQUE-CENTRAL-mac-') and n.endswith('.zip')), key=lambda n: os.path.getmtime(f'{site}/{n}'))
for n in old[:-2]:
    os.remove(f'{site}/{n}')
print(f'Version Mac {version} publiée.')
PYTHON
