// Ce que ROCKY sait de chaque plugin pour bien conseiller : où on le pose, à quoi il sert, et ce qu'il ne fait PAS.
// La liste des plugins vient de la base à chaque question (rocky.js) : un plugin ajouté par un collègue est connu
// tout de suite par son texte de la boutique. Une fiche ici ne fait que l'aider à mieux choisir ; un plugin retiré
// de la boutique n'est plus proposé, même s'il garde sa fiche.
export const CONSEILS = {
  vocalbox: {
    pour: 'Mixer une voix (lead, backs, adlibs, doubles) de A à Z dans un seul plugin, en lui disant ce qu\'on veut entendre : nettoyage (débruiteur, de-click, de-breath, de-reverb, de-esser, plosives), justesse (TUNER intégré), EQ, compression, saturation, reverb et delay. C\'est aussi LE plugin de la boutique pour nettoyer une prise de voix : bruit de fond, souffle, clics de bouche, respirations trop fortes, pièce qui résonne.',
    ou: 'Sur chaque piste de voix.',
    pas: 'Pas pour le mastering, ni pour un beat, des drums ou un mix entier : c\'est une chaîne vocale.',
  },
  'onirique-vocal-mini': {
    pour: 'Une chaîne vocale simple, avec peu de réglages : compression et outils essentiels pour une voix propre vite fait. Idéal pour débuter ou aller vite.',
    ou: 'Sur une piste de voix.',
    pas: 'Pas pour le mastering ni pour les instrus. Moins complet que VOCALBOX (pas de nettoyage avancé ni de justesse).',
  },
  'onirique-enhancer': {
    pour: 'Faire passer une voix devant, chaude et brillante, en quelques boutons : préampli à lampe, EQ de console, niveleur, flanger, plaque de reverb.',
    ou: 'Sur une piste de voix.',
    pas: 'Pas pour le mastering. Son limiteur sert seulement à garder la sortie de la voix sous contrôle : ce n\'est pas un limiteur de master.',
  },
  based: {
    pour: 'Channel strip vocal à monter soi-même : gate, tranche de console, deux de-essers, saturation, compresseurs 1176 et Fairchild, EQ, dans l\'ordre qu\'on veut. Pour qui aime régler chaque étape.',
    ou: 'Sur une piste de voix.',
    pas: 'Pas pour le mastering, pas de correction de justesse.',
  },
  tuner: {
    pour: 'Autotune : remettre la voix sur la note, de naturel à effet robot, avec un vocodeur. Mode LIVE sans latence pour s\'enregistrer avec.',
    ou: 'Sur une piste de voix, en premier.',
    pas: 'Ne corrige pas note par note à la main (c\'est PITCHBOX).',
  },
  'onirique-pitchbox': {
    pour: 'Corriger la justesse d\'une prise note par note, à la main ou par gamme, comme un éditeur de hauteur.',
    ou: 'Sur une piste de voix seule (une note à la fois).',
    pas: 'Pas un autotune en direct pour s\'enregistrer (c\'est TUNER). Pas pour les accords ni un mix.',
  },
  'onirique-doublebox': {
    pour: 'Épaissir une voix avec quatre doubles, comme si elle avait été rechantée, avec pitch et formant.',
    ou: 'Sur une voix (souvent refrains, backs).',
    pas: 'Ne corrige rien, ne mixe pas la voix.',
  },
  'onirique-riser': {
    pour: 'Créer en un geste la montée de reverb inversée avant une phrase de voix.',
    ou: 'Sur une piste de voix.',
    pas: 'Effet ponctuel, pas un traitement de mix.',
  },
  'onirique-verb': {
    pour: 'Reverb pensée pour la voix : six espaces, EQ avant et après, ducking, queue au tempo.',
    ou: 'Sur une voix ou en envoi (bus de reverb).',
    pas: 'Pas un traitement de master.',
  },
  'onirique-echobox': {
    pour: 'Delay créatif, du numérique propre à la bande usée, calé sur le tempo.',
    ou: 'Sur une voix, un instrument, ou en envoi.',
    pas: 'Pas un traitement de master.',
  },
  'onirique-vocal-spacer': {
    pour: 'Faire de la place à la voix dans un instrumental déjà terminé (un beat en stéréo) : il creuse le beat là où la voix est masquée, seulement quand elle chante.',
    ou: 'Sur la piste de l\'instru, avec la voix en sidechain.',
    pas: 'Ne traite pas la voix elle-même, pas un plugin de master.',
  },
  'onirique-eq': {
    pour: 'EQ paramétrique 8 bandes précis, avec bandes dynamiques, zéro latence ou phase linéaire. Le bon choix pour corriger chirurgicalement n\'importe quelle piste, un bus ou un master.',
    ou: 'Partout : voix, instruments, bus, master.',
    pas: 'Pas de couleur analogique (pour ça : WEIGHT, MASSIF, N73, ECLIPSE).',
  },
  'onirique-eclipse': {
    pour: 'EQ de mastering parallèle Mid/Side : de la chaleur, de l\'air et de la densité sans fermer le mix. Le plugin de la boutique le plus pensé pour le mastering.',
    ou: 'Sur le master, le mix bus, un bus voix ou une instru.',
    pas: 'Pas un limiteur ni un compresseur : il ne monte pas le volume final.',
  },
  'onirique-massif': {
    pour: 'Grand EQ passif stéréo à lampes, dans l\'esprit des EQ des studios de mastering : coloration douce, bas rond, haut ouvert.',
    ou: 'Sur le master ou un bus, aussi sur une piste.',
    pas: 'Pas un limiteur, pas de réglage chirurgical (pour ça : ONIRIQUE EQ).',
  },
  'onirique-weight': {
    pour: 'EQ à lampes façon EQP-1A : un bas qui pèse, chaud et rond, et un haut léger plein d\'air. Simple et musical.',
    ou: 'Sur une piste (basse, 808, voix), un bus ou le master.',
    pas: 'Pas un EQ chirurgical, pas un limiteur.',
  },
  'onirique-n73': {
    pour: 'Préampli et EQ de console classe A (esprit 1073) : du grain et de la couleur, surtout sur voix, basse, batterie.',
    ou: 'Sur une piste, en début de chaîne.',
    pas: 'Pas un plugin de master, pas un compresseur.',
  },
  'onirique-glue': {
    pour: 'Compresseur de bus stéréo façon console des années 80 : il colle un mix ou un groupe de pistes.',
    ou: 'Sur le mix bus / master, un bus de drums ou d\'instrus.',
    pas: 'Pas un limiteur : il ne remplace pas le dernier plugin qui fixe le volume final.',
  },
  'onirique-optobox': {
    pour: 'Compresseur optique à lampe (esprit CL 1B) : compression douce et musicale.',
    ou: 'Sur voix, basse, instruments, ou un bus.',
    pas: 'Pas un limiteur.',
  },
  'onirique-resobox': {
    pour: 'Suppresseur de résonances dynamique : il adoucit sifflantes, duretés et notes qui ressortent, seulement quand elles sont là.',
    ou: 'Sur une voix, un instrument, un bus ou un mix complet (utile en mastering pour un mix agressif).',
    pas: 'Pas un débruiteur (il n\'enlève pas un souffle de fond).',
  },
  'onirique-punch': {
    pour: 'Transient shaper multibande : faire claquer ou arrondir les attaques et allonger ou raccourcir les queues, bande par bande. Le bon plugin pour des drums qui manquent de punch.',
    ou: 'Sur kick, caisse claire, bus de drums, percussions.',
    pas: 'Pas un compresseur ni un limiteur.',
  },
  'onirique-modbox': {
    pour: 'Flanger, chorus, dimension, vibrato, du numérique propre au circuit analogique lofi.',
    ou: 'Sur instruments, synthés, voix, en effet.',
    pas: 'Pas un synthé : c\'est un effet.',
  },
  brumebox: {
    pour: 'Effet expérimental : les attaques deviennent des accords et le son laisse une brume. Prototype gratuit, interface provisoire.',
    ou: 'Sur des sons de beat, en effet créatif.',
    pas: 'Ni mixage ni mastering.',
  },
  bloom: {
    pour: 'Façonner le son d\'un mix entier avec six mots (WEIGHT, WARMTH, SPACE, PRESENCE, AIR, ENHANCE), sans courbe d\'EQ, avec un limiteur de sécurité intégré. Simple pour finir un morceau, idéal en mastering pour débutant. Plugin RELIC, vendu sur la boutique.',
    ou: 'Sur le master ou un bus.',
    pas: 'Pas de réglage précis fréquence par fréquence.',
  },
  'onirique-meterbox': {
    pour: 'Compteur gratuit de fin de master : loudness LUFS, true peak, spectre comparé à une cible, phase. Vérifier un master avant de l\'exporter.',
    ou: 'En dernier sur le master.',
    pas: 'Ne touche pas au son : il mesure, il ne corrige rien.',
  },
  'onirique-stream': {
    pour: 'Envoyer le son de son DAW dans un partage d\'écran Discord sans quitter l\'ASIO. Gratuit.',
    ou: 'En dernier sur le master, pendant une session partagée.',
    pas: 'Ne traite pas le son.',
  },
  'onirique-broadcast': {
    pour: 'Application Windows gratuite : la voix traitée en direct en micro virtuel pour Discord, OBS et les jeux, avec un mélangeur audio virtuel.',
    ou: 'Hors du DAW, sur le PC.',
    pas: 'Pas un plugin de mixage dans un DAW.',
  },
  'player-onirique': {
    pour: 'Afficher une vidéo dans le DAW, calée sur la lecture, pour composer sur un clip. Gratuit.',
    ou: 'N\'importe où dans le projet.',
    pas: 'Ne traite pas le son.',
  },
};
