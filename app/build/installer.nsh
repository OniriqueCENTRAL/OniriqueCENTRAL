; L'installeur Windows aux couleurs d'ONIRIQUE (inclus par electron-builder, voir "nsis" dans package.json).
; Les images viennent de tools/installer-art (python tools/installer-art/build.py).
;
; Ce fichier est lu avant Modern UI : les couleurs posées ici remplacent ses couleurs par défaut.

; Fond nuit et texte clair pour l'en-tête, la page d'accueil et la page de fin.
!define MUI_BGCOLOR 0D0809
!define MUI_TEXTCOLOR F6EEEE
!define MUI_WELCOMEFINISHPAGE_BITMAP_NOSTRETCH
!define MUI_UNWELCOMEFINISHPAGE_BITMAP_NOSTRETCH

!macro customHeader
  BrandingText "ONIRIQUE  ·  onirique.store"
  LangString oniWelcomeTitle ${LANG_FRENCH} "Bienvenue dans ONIRIQUE CENTRAL"
  LangString oniWelcomeTitle ${LANG_ENGLISH} "Welcome to ONIRIQUE CENTRAL"
  LangString oniWelcomeText ${LANG_FRENCH} "ONIRIQUE CENTRAL installe, active et met à jour vos plugins ONIRIQUE.$\r$\n$\r$\nFermez votre logiciel de musique avant de continuer.$\r$\n$\r$\nCliquez sur Suivant pour commencer."
  LangString oniWelcomeText ${LANG_ENGLISH} "ONIRIQUE CENTRAL installs, activates and updates your ONIRIQUE plugins.$\r$\n$\r$\nClose your music software before continuing.$\r$\n$\r$\nClick Next to begin."
!macroend

; La page d'accueil (absente par défaut) : l'image ONIRIQUE à gauche, le texte d'accueil à droite.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(oniWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(oniWelcomeText)"
  !insertmacro MUI_PAGE_WELCOME
!macroend
