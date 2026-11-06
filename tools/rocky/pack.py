# Assemble les images rendues par rocky3d.py en fichiers du site (site/assets/rocky) :
#   rocky-<humeur>.webp  la bulle du site, animée (12 i/s), recadrée de la même façon pour toutes les humeurs
#   rocky-<geste>.webp   planches de 12 images côte à côte pour le mini ROCKY bâtisseur de CLOUD (rocky-builder.js)
#   rocky-portrait.webp  le portrait (bloc ROCKY de l'accueil)
# Usage : python pack.py <dossier_des_rendus> <site/assets/rocky>
import sys, json
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
MOODS = ["idle", "happy", "thinking", "sleeping", "wave", "talk", "sad"]
SHEETS = ["walk", "work", "cheer"]
BUBBLE, SPRITE = 128, 336  # taille de la bulle ; d'une image de planche (affichée à 168 px, écrans x2)

def frames(name, n):
    return [Image.open(f"{src}/{name}_{i:02d}.png").convert("RGBA") for i in range(n)]

# Recadrage commun des humeurs : le carré qui contient Rocky dans toutes ses poses (Z et notes comprises).
anims = {m: frames(m, 24) for m in MOODS}
box = None
for fs in anims.values():
    for im in fs:
        b = im.getchannel("A").point(lambda a: 255 if a > 60 else 0).getbbox()
        if b: box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
w = anims["idle"][0].width
cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
side = min(w, max(box[2] - box[0], box[3] - box[1]) * 1.04)
cx = min(max(cx, side / 2), w - side / 2); cy = min(max(cy, side / 2), w - side / 2)
crop = tuple(round(v) for v in (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2))
for m, fs in anims.items():
    out = [im.crop(crop).resize((BUBBLE, BUBBLE), Image.LANCZOS) for im in fs]
    out[0].save(f"{dst}/rocky-{m}.webp", save_all=True, append_images=out[1:], duration=83, loop=0,
                quality=86, method=6, alpha_quality=90)

for s in SHEETS:
    fs = [im.resize((SPRITE, SPRITE), Image.LANCZOS) for im in frames(s, 12)]
    sheet = Image.new("RGBA", (SPRITE * len(fs), SPRITE), (0, 0, 0, 0))
    for i, im in enumerate(fs): sheet.alpha_composite(im, (i * SPRITE, 0))
    sheet.save(f"{dst}/rocky-{s}.webp", quality=84, method=6, alpha_quality=90)

p = Image.open(f"{src}/portrait.png").convert("RGBA")
b = p.getchannel("A").point(lambda a: 255 if a > 30 else 0).getbbox()
p = p.crop(b); p.thumbnail((720, 720), Image.LANCZOS)
p.save(f"{dst}/rocky-portrait.webp", quality=88, method=6, alpha_quality=92)
print("portrait", p.size)

# Où sont les mains dans les planches (px, sur 168) : la carte de CLOUD se cale sur la patte 1.
hands = json.load(open(f"{src}/hands.json"))
for s in SHEETS:
    print(s, [[round(x * 168), round((1 - y) * 168)] for x, y in (f[1] for f in hands[s])][:12])
print("work, patte du haut", [[round(x * 168), round((1 - y) * 168)] for x, y in (f[0] for f in hands["work"])])
