#!/usr/bin/env bash
# Construit ONIRIQUE Navigateur pour Mac (Apple Silicon et Intel dans la même application). Ne marche que sur macOS :
# c'est GitHub qui le lance (.github/workflows/navigateur-mac.yml). Le numéro de version est celui de Windows.
#
#   bash navigateur/mac/build.sh      →  navigateur/mac/dist/ONIRIQUE-Navigateur.dmg et ONIRIQUE-Navigateur-mac.zip
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' ../Navigateur.csproj)
APP="dist/ONIRIQUE Navigateur.app"
rm -rf dist build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" build

for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos13.0" -module-name OniriqueNavigateur \
    -framework AppKit -framework WebKit -framework Network -framework CryptoKit \
    Sources/*.swift -o "build/navigateur-$arch"
done
lipo -create build/navigateur-arm64 build/navigateur-x86_64 -output "$APP/Contents/MacOS/ONIRIQUE Navigateur"

sed "s/VERSION/$VERSION/g" Info.plist > "$APP/Contents/Info.plist"
# Les pages internes : les mêmes que sur Windows, avec les polices du site.
cp -R ../accueil "$APP/Contents/Resources/accueil"
mkdir -p "$APP/Contents/Resources/accueil/fonts"
cp ../../site/assets/fonts/Unbounded-latin.woff2 ../../site/assets/fonts/HankenGrotesk-latin.woff2 ../../site/assets/fonts/JetBrainsMono-latin.woff2 "$APP/Contents/Resources/accueil/fonts/"

# L'icône : le logo rond, à toutes les tailles que demande macOS.
mkdir -p build/icone.iconset
for t in 16 32 128 256 512; do
  sips -z $t $t ../logo/navigateur-1024.png --out "build/icone.iconset/icon_${t}x${t}.png" > /dev/null
  sips -z $((t * 2)) $((t * 2)) ../logo/navigateur-1024.png --out "build/icone.iconset/icon_${t}x${t}@2x.png" > /dev/null
done
iconutil -c icns build/icone.iconset -o "$APP/Contents/Resources/icone.icns"

# Signature locale (sans compte Apple) : macOS demande une fois « clic droit, Ouvrir ».
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

mkdir -p build/image
cp -R "$APP" build/image/
ln -s /Applications build/image/Applications
hdiutil create -volname "ONIRIQUE Navigateur" -srcfolder build/image -ov -format UDZO dist/ONIRIQUE-Navigateur.dmg > /dev/null
# La même application en .zip : c'est ce que téléchargent les navigateurs installés pour se mettre à jour.
ditto -c -k --keepParent "$APP" dist/ONIRIQUE-Navigateur-mac.zip
echo "ONIRIQUE Navigateur $VERSION pour Mac : dist/ONIRIQUE-Navigateur.dmg"
