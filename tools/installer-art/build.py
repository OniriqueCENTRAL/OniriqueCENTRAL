# Fabrique les images de l'installeur Windows à partir de art.html (Chrome sans fenêtre, puis réduction exacte) :
#   python tools/installer-art/build.py
# → app/build/installerSidebar.bmp (164 × 314) et app/build/installerHeader.bmp (150 × 57), lues par electron-builder.
import os, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image

here = Path(__file__).resolve().parent
out = here.parent.parent / 'app' / 'build'
chrome = os.environ.get('CHROME', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
SCALE = 4
for part, size in (('sidebar', (164, 314)), ('header', (150, 57))):
    with tempfile.TemporaryDirectory() as tmp:
        shot = Path(tmp) / 'shot.png'
        subprocess.run([chrome, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                        f'--force-device-scale-factor={SCALE}', f'--window-size={size[0]},{size[1]}',
                        '--virtual-time-budget=3000', '--user-data-dir=' + str(Path(tmp) / 'profile'), f'--screenshot={shot}',
                        (here / 'art.html').as_uri() + f'?part={part}'], check=True, capture_output=True)
        image = Image.open(shot).convert('RGB').crop((0, 0, size[0] * SCALE, size[1] * SCALE)).resize(size, Image.LANCZOS)
    name = 'installerSidebar.bmp' if part == 'sidebar' else 'installerHeader.bmp'
    image.save(out / name)
    image.resize((size[0] * 3, size[1] * 3), Image.NEAREST).save(Path(tempfile.gettempdir()) / f'onirique-{part}-preview.png')
    print(name, image.size)
