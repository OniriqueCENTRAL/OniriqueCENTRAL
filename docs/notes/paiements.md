# Paiements

## Plugins et abonnements
- Stripe, un compte par créateur (table `stripe_accounts`, clés chiffrées par `keys/secrets.key`, onglet
  « Paiements » du panel admin, routes `/api/admin/payments`). Un partenaire branche sa marque ; seul un fondateur
  branche ONIRIQUE ou ouvre / ferme la vente (`payments_open`, vrai par défaut).
- Un webhook par créateur : `/api/stripe/webhook/<créateur>`.
- Les abonnements (All Access, à la carte) sont encaissés par ONIRIQUE et ne couvrent que les plugins ONIRIQUE ;
  ceux des partenaires s'achètent à l'unité. Aucun argent ne circule entre marques.
- Restent à faire côté légal : identité de l'éditeur dans les mentions légales, médiateur, achat réel d'essai.

## Packs de prods (ONIRIQUE CLOUD, `sound_projects.kind = 'pack'`)
- Vente dans `server/src/beatstore.js` : licences par compte (MP3, WAV, stems, Exclusive…), prix par prod
  (`sound_tracks.license_prices`), contrat PDF personnalisable (`site/assets/licence-pdf.js`), livraison par
  `site/achat.html` et mail.
- Depuis le 9 nov. 2026, ONIRIQUE encaisse toutes les ventes avec son propre Stripe ; solde et « Demander
  versement » dans Ventes, virements notés par les fondateurs (`sound_payouts`). Pas de commission déduite.
- Les fondateurs peuvent simuler un paiement (provider `simulation` : ni argent, ni mail, l'exclusive reste).
- Envois de mails des packs : `server/src/packsend.js` (SMTP du membre ou API Gmail), 300 par envoi / 500 par jour.
- Stripe Connect (comptes des beatmakers) : réglé et essayé en test ; en réel, l'ID client `ca_` était encore
  indisponible fin octobre. Réglages par `onirique-stripe-connect` sur le VPS.

## Pièges
- Stripe Connect : une clé restreinte `rk_` est refusée par OAuth ; une clé d'un autre environnement que le `ca_`
  donne « Authorization code provided does not belong to you » ; un collage dans le terminal peut ajouter des
  caractères invisibles.
- Jamais essayé avec un vrai compte Stripe de test pour les packs : seul `server/test/beatstore.mjs` (Stripe simulé).
