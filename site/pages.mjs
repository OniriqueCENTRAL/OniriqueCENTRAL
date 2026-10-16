// Génère les pages légales du site : node pages.mjs
// Tout ce qui identifie l'éditeur est dans ID : une valeur encore vide s'affiche surlignée « à compléter ».
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const UPDATED = '12 octobre 2026';

const ID = {
  email: 'support@onirique.store', // contact, demandes RGPD, rétractations
};

const todo = (label) => `<mark class="todo">[à compléter : ${label}]</mark>`;
const mail = () => (ID.email ? `<a href="mailto:${ID.email}">${ID.email}</a>` : todo('e-mail de contact'));

const NAV = [
  ['mentions-legales.html', 'Mentions légales'],
  ['cgv.html', 'CGV et CGU'],
  ['remboursement.html', 'Rétractation et remboursement'],
  ['confidentialite.html', 'Confidentialité'],
  ['cookies.html', 'Cookies'],
];

const page = ({ file, title, description, intro, body }) => `<!doctype html>
<html lang="fr">
<meta charset="utf-8">
<script src="assets/i18n.js?v=0ad0882a"></script>
<script src="assets/annonce.js?v=1"></script>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} — ONIRIQUE</title>
<meta name="description" content="${description}">
<link rel="canonical" href="https://onirique.store/${file}">
<link rel="icon" type="image/png" href="assets/favicon.png">
<link rel="stylesheet" href="assets/fonts.css">
<link rel="stylesheet" href="assets/pages.css">

<a class="skip" href="#contenu">Aller au contenu</a>
<header>
  <div class="wrap">
    <a class="brand" href="/"><img src="assets/logo-small.png" alt="Logo Onirique" width="160" height="145">ONIRIQUE</a>
    <a class="btn" href="/">Retour au site</a>
  </div>
</header>

<main class="wrap" id="contenu">
  <p class="eyebrow">Informations légales</p>
  <h1>${title}</h1>
  <p class="updated">Dernière mise à jour : ${UPDATED}</p>
  ${intro ? `<p class="intro">${intro}</p>` : ''}
${body}
</main>

<footer>
  <nav class="wrap" aria-label="Pages légales">
    ${NAV.map(([href, label]) => `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${label}</a>`).join('\n    ')}
    <a href="support.html">Support</a>
    <a href="compte.html">Compte</a>
  </nav>
</footer>
<script src="assets/site-nav.js?v=7"></script>
</html>
`;

const pages = [
  //============================================================================
  {
    file: 'mentions-legales.html',
    title: 'Mentions légales',
    description: "Éditeur, hébergeur et contact du site onirique.store.",
    body: `
  <h2>Éditeur du site</h2>
  <p>Le site <strong>onirique.store</strong> et l'application <strong>Onirique Central</strong> sont édités par <strong>ONIRIQUE</strong>, un collectif de créateurs indépendants de plugins audio. L'identité de l'éditeur a été communiquée à l'hébergeur, dont les coordonnées figurent ci-dessous.</p>

  <h2>Vendeur</h2>
  <p>ONIRIQUE conçoit les logiciels, délivre les licences et assure le support des produits. La vente elle-même est réalisée par <strong>Link</strong>, le service de la société <strong>Stripe</strong>, qui agit comme vendeur officiel : c'est Link qui encaisse le paiement, émet le reçu et la facture, et applique les taxes. Son nom apparaît sur la page de paiement, sur votre reçu et sur votre relevé bancaire. Voir les <a href="cgv.html">conditions générales</a>.</p>

  <h2 id="contact">Contact</h2>
  <ul>
    <li>E-mail : ${mail()}</li>
    <li>Formulaire : <a href="support.html">page Support</a>, ou l'onglet <strong>Support</strong> de l'application Onirique Central.</li>
  </ul>

  <h2>Hébergeur</h2>
  <p>IONOS SARL, 7 place de la Gare, BP 70109, 57200 Sarreguemines Cedex, France. Téléphone : 0970 808 911. Site : ionos.fr.</p>

  <h2>Propriété intellectuelle</h2>
  <p>Le nom Onirique, le logo, les textes, les visuels, l'interface des plugins et le code des logiciels sont protégés par le droit d'auteur. Toute reproduction ou réutilisation sans accord écrit préalable est interdite, en dehors des usages permis par la loi.</p>
  <p>1176, LA-2A et Pultec sont des marques de leurs propriétaires respectifs. Elles sont citées uniquement pour décrire un caractère sonore. Onirique n'est affilié à aucune de ces marques.</p>
  <p>Les polices Unbounded, Grenze Gotisch, Hanken Grotesk et JetBrains Mono sont utilisées sous licence SIL Open Font License 1.1.</p>

  <h2>Données personnelles et cookies</h2>
  <p>Voir la <a href="confidentialite.html">politique de confidentialité</a> et la <a href="cookies.html">politique relative aux cookies</a>.</p>`,
  },

  //============================================================================
  {
    file: 'cgv.html',
    title: 'Conditions générales de vente et d’utilisation',
    description: "Conditions de vente des plugins Onirique et d'utilisation du site, du compte et de l'application Onirique Central.",
    intro: "Les plugins s'achètent en ligne, à l'unité ou par abonnement. La vente est réalisée par Link, le service de Stripe, qui agit comme vendeur officiel : il encaisse, facture et applique les taxes. ONIRIQUE édite les logiciels, délivre les licences et assure le support des produits.",
    body: `
  <h2>1. Éditeur et vendeur</h2>
  <p>Le site, le compte, l'application et les logiciels sont proposés par ONIRIQUE. Contact : ${mail()}. Voir les <a href="mentions-legales.html">mentions légales</a>.</p>
  <p>Lorsque vous achetez, votre contrat de vente est conclu avec le vendeur indiqué sur la page de paiement et sur votre reçu : Link, le service de la société Stripe, vendeur officiel des plugins. Ses propres conditions, affichées sur la page de paiement, s'appliquent à l'encaissement, à la facturation et aux taxes. Les présentes conditions régissent le compte, la licence d'utilisation des logiciels et le support.</p>

  <h2>2. Produits</h2>
  <p>Onirique propose des logiciels audio (plugins au format VST3 et, sur Mac, Audio Unit, avec ou sans version autonome) pour Windows 10 et 11 en 64 bits et pour macOS 10.15 ou plus récent, fournis uniquement sous forme numérique, sans support matériel. Tous les plugins n'existent pas pour les deux systèmes : la fiche de chaque produit indique ses fonctions, les systèmes pour lesquels il est disponible et son créateur. L'application Onirique Central, gratuite, sert à installer les plugins, à les mettre à jour et à activer les licences.</p>
  <p>Avant d'acheter, il vous appartient de vérifier que votre matériel et votre logiciel de musique (DAW) sont compatibles avec le produit.</p>

  <h2>3. Compte</h2>
  <p>L'achat, le téléchargement et l'activation d'une licence demandent un compte Onirique, créé avec une adresse e-mail et un mot de passe. Le même compte sert sur le site et dans l'application. Vous êtes responsable de la confidentialité de votre mot de passe et des actions faites depuis votre compte.</p>
  <p>La création d'un compte est réservée aux personnes majeures, ou aux mineurs disposant de l'autorisation de leur représentant légal. Vous pouvez demander la suppression de votre compte à tout moment (voir la <a href="confidentialite.html">politique de confidentialité</a>).</p>

  <h2>4. Prix</h2>
  <p>Les prix sont indiqués en euros, toutes taxes comprises. Hors de la zone euro, la page de paiement peut afficher le prix converti dans votre monnaie. Le prix applicable est celui affiché sur la page de paiement au moment de valider la commande. Aucun frais de livraison ne s'ajoute, les produits étant numériques.</p>

  <h2>5. Commande et paiement</h2>
  <p>La commande se déroule ainsi : choix du produit ou de la formule, connexion au compte, puis page de paiement sécurisée de Stripe, qui affiche le récapitulatif, le prix total, les taxes et les conditions du vendeur. La vente est conclue lorsque le paiement est confirmé.</p>
  <p>Onirique ne reçoit et ne conserve jamais le numéro de votre carte bancaire. Le reçu et la facture vous sont envoyés par e-mail par Link ; Onirique vous envoie en plus une confirmation avec les indications d'installation. Le paiement apparaît sur votre relevé bancaire sous un libellé commençant par « LINK.COM ».</p>

  <h2>6. Livraison</h2>
  <p>Dès la confirmation du paiement, la licence est ajoutée à votre compte. Le produit se télécharge et s'installe depuis l'application Onirique Central. Si la licence n'apparaît pas sur votre compte dans l'heure qui suit le paiement, contactez-nous : nous la délivrons ou nous vous remboursons.</p>

  <h2>7. Licence d'utilisation</h2>
  <p>L'achat ne transfère pas la propriété du logiciel : il vous donne un droit d'utilisation personnel, non exclusif et non transférable.</p>
  <ul>
    <li>Une licence s'active sur le nombre d'ordinateurs indiqué sur votre compte (deux par défaut). Vous pouvez désactiver un ordinateur pour en activer un autre.</li>
    <li>Vous pouvez utiliser les plugins pour créer, enregistrer et mixer de la musique, y compris à des fins commerciales. Vos créations vous appartiennent.</li>
    <li>Il est interdit de revendre, louer, partager ou diffuser le logiciel ou vos clés de licence, et de contourner le système de licence. Les droits que la loi vous accorde de manière impérative restent réservés.</li>
    <li>Une licence « perpétuelle » n'a pas de date de fin. Une licence à durée limitée prend fin à la date indiquée sur votre compte.</li>
  </ul>
  <p>En cas de manquement grave à ces règles, la licence peut être révoquée, après une mise en demeure restée sans effet lorsque le manquement peut être corrigé.</p>

  <h2>8. Abonnements</h2>
  <p>Deux formules existent. L'abonnement <strong>All Access</strong> donne accès à l'ensemble des plugins édités par Onirique tant qu'il est actif. L'abonnement <strong>à la carte</strong> donne accès aux seuls plugins Onirique que vous avez choisis. Les plugins d'un créateur partenaire, signalé sur leur fiche, ne font partie d'aucun abonnement : ils s'achètent à l'unité.</p>
  <p>Un abonnement est mensuel ou annuel selon la formule choisie, payable d'avance, et se renouvelle automatiquement pour la même durée, au tarif en vigueur qui vous a été annoncé.</p>
  <p>Vous pouvez le résilier à tout moment, en ligne, depuis l'onglet <strong>Abonnement</strong> de l'application Onirique Central, depuis votre espace Link (link.com), ou en nous écrivant. La résiliation prend effet à la fin de la période déjà payée, pendant laquelle vous gardez l'accès. À la fin de l'abonnement, les plugins obtenus uniquement par l'abonnement cessent de fonctionner ; ceux achetés à l'unité vous restent acquis.</p>
  <p>Toute modification du prix d'un abonnement vous est annoncée par e-mail avant son application ; vous pouvez alors résilier sans frais avant la date d'effet.</p>

  <h2>9. Droit de rétractation</h2>
  <p>Vous disposez en principe de quatorze jours pour vous rétracter d'un achat fait à distance. Ce droit ne s'applique plus à un contenu numérique dont la fourniture a commencé avec votre accord exprès et après que vous avez reconnu perdre ce droit. Les règles détaillées, la marche à suivre et le formulaire figurent sur la page <a href="remboursement.html">Rétractation et remboursement</a>.</p>

  <h2>10. Garanties légales</h2>
  <p>Vous bénéficiez de la garantie légale de conformité applicable aux contenus et services numériques (articles L. 224-25-12 et suivants du Code de la consommation) et de la garantie des vices cachés (articles 1641 à 1649 du Code civil).</p>
  <ul>
    <li>Pour un achat à l'unité, la garantie de conformité couvre les défauts qui apparaissent dans les deux ans suivant la fourniture. Pour un abonnement, elle couvre toute la durée de celui-ci.</li>
    <li>En cas de défaut de conformité, vous avez droit à la mise en conformité du produit, sans frais et sans retard injustifié. Si elle est impossible ou n'intervient pas, vous pouvez obtenir une réduction du prix ou la résolution du contrat avec remboursement.</li>
    <li>Pendant cette durée, nous fournissons les mises à jour nécessaires au maintien de la conformité du produit, notamment les correctifs de sécurité.</li>
  </ul>
  <p>Pour faire jouer ces garanties, écrivez à ${mail()} en décrivant le problème, votre configuration et la version du produit.</p>

  <h2>11. Disponibilité et responsabilité</h2>
  <p>Nous faisons le nécessaire pour que le site, les téléchargements et l'activation des licences restent accessibles, sans pouvoir garantir une disponibilité permanente : des interruptions de maintenance ou des pannes peuvent survenir. Une licence déjà activée continue de fonctionner sans connexion, dans les limites décrites dans l'application.</p>
  <p>Il vous appartient de sauvegarder vos projets et vos réglages. Notre responsabilité ne peut pas être engagée pour un dommage causé par un usage du produit contraire à sa documentation, ou par un événement de force majeure. Rien dans ces conditions ne limite les droits que la loi accorde aux consommateurs.</p>

  <h2>12. Propriété intellectuelle</h2>
  <p>Les logiciels, leur interface, leur documentation, le site et la marque Onirique restent la propriété exclusive de l'éditeur. Aucun droit autre que la licence décrite à l'article 7 ne vous est accordé.</p>

  <h2>13. Données personnelles</h2>
  <p>Le traitement de vos données est décrit dans la <a href="confidentialite.html">politique de confidentialité</a> et la <a href="cookies.html">politique relative aux cookies</a>.</p>

  <h2>14. Service client et réclamations</h2>
  <p>Pour toute question ou réclamation sur un produit, une licence ou votre compte : ${mail()}, ou l'onglet Support de l'application Onirique Central. Nous répondons dans les meilleurs délais.</p>
  <p>Pour une question sur un paiement, un reçu ou une facture, vous pouvez aussi vous adresser à l'assistance de Link, le vendeur : support.link.com.</p>

  <h2>15. Médiation de la consommation</h2>
  <p>Si une réclamation écrite n'a pas abouti, vous pouvez recourir gratuitement à un médiateur de la consommation, dans l'année qui suit votre réclamation. Le vendeur étant Link (Stripe), ce recours s'exerce selon ses conditions de vente, accessibles depuis la page de paiement et votre reçu. Pour un différend qui porte sur le produit lui-même, écrivez-nous d'abord : nous cherchons toujours une solution amiable.</p>

  <h2>16. Droit applicable et litiges</h2>
  <p>Ces conditions sont soumises au droit français. Si vous êtes un consommateur résidant dans un autre pays de l'Union européenne, vous conservez la protection des règles impératives de votre pays de résidence. À défaut d'accord amiable, le litige est porté devant le tribunal compétent selon les règles légales.</p>

  <h2>17. Évolution des conditions</h2>
  <p>Ces conditions peuvent évoluer. La version applicable à un achat est celle en vigueur à la date de la commande. Pour un abonnement en cours, toute modification importante vous est annoncée par e-mail avant son entrée en vigueur.</p>`,
  },

  //============================================================================
  {
    file: 'remboursement.html',
    title: 'Rétractation et remboursement',
    description: "Droit de rétractation de 14 jours, cas où il ne s'applique plus, formulaire et délais de remboursement pour les achats Onirique.",
    body: `
  <h2>Le principe : quatorze jours pour changer d'avis</h2>
  <p>Pour un achat fait en ligne, vous disposez d'un délai de quatorze jours à compter de la conclusion du contrat pour vous rétracter, sans avoir à donner de motif (article L. 221-18 du Code de la consommation).</p>

  <h2>Quand ce droit ne s'applique plus</h2>
  <p>Les plugins Onirique sont des contenus numériques fournis sans support matériel et disponibles dès le paiement. La loi prévoit que le droit de rétractation prend fin lorsque les trois conditions suivantes sont réunies (article L. 221-28, 13° du Code de la consommation) :</p>
  <ol>
    <li>vous avez demandé expressément, au moment de la commande, que la fourniture commence tout de suite ;</li>
    <li>vous avez reconnu que vous perdiez ainsi votre droit de rétractation ;</li>
    <li>cet accord vous a été confirmé par e-mail.</li>
  </ol>
  <p>Si la page de paiement ne vous a pas demandé ces deux déclarations, vous conservez votre droit de rétractation pendant quatorze jours, même après avoir téléchargé le produit.</p>

  <h2>Abonnements</h2>
  <p>Le délai de quatorze jours s'applique aussi à la souscription d'un abonnement. Si vous avez demandé à en profiter immédiatement puis que vous vous rétractez, vous restez redevable du montant correspondant à la période déjà utilisée, calculé au prorata (article L. 221-25 du Code de la consommation). Passé ce délai, l'abonnement se résilie à tout moment, avec effet à la fin de la période payée, sans remboursement de la période en cours.</p>

  <h2>Comment vous rétracter</h2>
  <p>Envoyez, avant la fin du délai, une déclaration claire à ${mail()} : nous la transmettons au vendeur et nous accusons réception par e-mail. Vous pouvez aussi vous adresser directement à l'assistance de Link, le vendeur (support.link.com). Le formulaire ci-dessous peut vous servir, sans que ce soit obligatoire.</p>
  <div class="form-model">
    <p><strong>Formulaire de rétractation</strong></p>
    <p>À l'attention de ONIRIQUE, ${mail()} :</p>
    <p>Je vous notifie par la présente ma rétractation du contrat portant sur la fourniture du produit ou de l'abonnement ci-dessous :</p>
    <p>Produit ou formule : …<br>Commandé le : …<br>Adresse e-mail du compte : …<br>Nom du client : …<br>Date : …</p>
  </div>

  <h2>Remboursement</h2>
  <p>Lorsque la rétractation est valable, la totalité des sommes versées vous est remboursée, au plus tard quatorze jours après la réception de votre demande. Le remboursement est effectué par Link (Stripe), le vendeur, sur le moyen de paiement utilisé pour l'achat, sans frais pour vous. La licence correspondante est alors retirée de votre compte.</p>

  <h2>En dehors de la rétractation</h2>
  <ul>
    <li><strong>Le produit ne fonctionne pas comme décrit</strong> : la garantie légale de conformité s'applique. Nous corrigeons le problème ou, à défaut, nous vous remboursons (voir l'article 10 des <a href="cgv.html">conditions générales</a>).</li>
    <li><strong>Paiement en double ou erreur de montant</strong> : écrivez-nous, la somme prélevée à tort est remboursée.</li>
    <li><strong>Licence non reçue</strong> : si elle n'est pas délivrée, vous êtes remboursé.</li>
    <li><strong>Clé de licence offerte ou de démonstration</strong> : elle n'a pas été payée et ne donne lieu à aucun remboursement.</li>
  </ul>`,
  },

  //============================================================================
  {
    file: 'confidentialite.html',
    title: 'Politique de confidentialité',
    description: "Quelles données personnelles Onirique collecte, pourquoi, pendant combien de temps, et comment exercer vos droits.",
    intro: "Onirique collecte le strict nécessaire pour gérer votre compte et vos licences. Aucune publicité, aucun outil de mesure d'audience, aucun profilage, aucune revente de données.",
    body: `
  <h2>Responsable du traitement</h2>
  <p>ONIRIQUE, éditeur du site (voir les <a href="mentions-legales.html">mentions légales</a>). Pour toute question sur vos données ou pour exercer vos droits : ${mail()}.</p>

  <h2>Les données traitées</h2>
  <div class="table"><table>
    <thead><tr><th>Données</th><th>Pourquoi</th><th>Base légale</th><th>Durée de conservation</th></tr></thead>
    <tbody>
      <tr><td><strong>Compte</strong> : adresse e-mail, nom ou pseudo (facultatif), mot de passe enregistré sous forme d'empreinte chiffrée irréversible</td><td>Créer votre compte et vous identifier sur le site et dans l'application</td><td>Exécution du contrat</td><td>Jusqu'à la suppression du compte</td></tr>
      <tr><td><strong>Session</strong> : jeton de connexion</td><td>Vous garder connecté</td><td>Exécution du contrat</td><td>60 jours au plus, ou jusqu'à la déconnexion</td></tr>
      <tr><td><strong>Licences</strong> : clés, type, dates, plugin concerné</td><td>Vous donner accès aux plugins que vous possédez</td><td>Exécution du contrat</td><td>Jusqu'à la suppression du compte</td></tr>
      <tr><td><strong>Activations</strong> : identifiant technique de l'ordinateur (une empreinte calculée, qui ne permet pas de retrouver l'identifiant d'origine), nom de l'ordinateur, date de dernière activation</td><td>Appliquer la limite d'ordinateurs par licence et vous permettre de les gérer</td><td>Exécution du contrat</td><td>Jusqu'à la désactivation de l'ordinateur ou la suppression du compte</td></tr>
      <tr><td><strong>Commandes</strong> : produit, montant, date, référence du paiement</td><td>Délivrer la licence, tenir la comptabilité</td><td>Exécution du contrat, puis obligation légale</td><td>10 ans (obligation comptable)</td></tr>
      <tr><td><strong>Support</strong> : sujet et texte de votre message, e-mail, nom, plugin et version concernés</td><td>Répondre à votre demande</td><td>Intérêt légitime (répondre aux demandes)</td><td>3 ans au plus, puis suppression automatique</td></tr>
      <tr><td><strong>Mot de passe oublié</strong> : adresse e-mail, lien à usage unique</td><td>Vous permettre de choisir un nouveau mot de passe</td><td>Exécution du contrat</td><td>Le lien expire après une heure</td></tr>
      <tr><td><strong>Journaux techniques</strong> : adresse IP, date et heure, page demandée, type de navigateur</td><td>Sécurité du service, détection des abus et des pannes</td><td>Intérêt légitime (sécurité)</td><td>14 jours</td></tr>
    </tbody>
  </table></div>
  <p>L'adresse e-mail et le mot de passe sont indispensables pour créer un compte ; le nom est facultatif. Les sauvegardes du serveur, qui contiennent ces données, sont conservées 14 jours.</p>
  <p>Onirique ne reçoit et ne conserve jamais le numéro de votre carte bancaire : le paiement est traité directement par le prestataire de paiement.</p>

  <h2>Qui reçoit vos données</h2>
  <p>Vos données sont accessibles à l'éditeur et aux prestataires suivants, uniquement pour les besoins décrits ci-dessus :</p>
  <ul>
    <li><strong>IONOS</strong> : hébergement du site et du serveur, dans un centre de données situé en Allemagne (Union européenne).</li>
    <li><strong>IONOS</strong> également pour la messagerie : les demandes de support et les e-mails que nous vous adressons (lien de réinitialisation du mot de passe) passent par la boîte e-mail d'Onirique, hébergée par IONOS.</li>
    <li><strong>Stripe</strong> et son service <strong>Link</strong>, vendeur officiel et prestataire de paiement, pour vos achats : Onirique lui transmet votre adresse e-mail et la désignation de ce que vous achetez ; vous lui communiquez vous-même, sur sa page de paiement, vos informations de paiement et de facturation. Stripe les traite sous sa propre responsabilité, selon sa politique de confidentialité.</li>
  </ul>
  <p>Vos données ne sont ni vendues, ni louées, ni utilisées à des fins publicitaires.</p>

  <h2>Transferts hors de l'Union européenne</h2>
  <p>Le site, le serveur et la messagerie sont hébergés par IONOS dans l'Union européenne. Seul le paiement fait exception : Stripe peut traiter les données d'une commande hors de l'Union européenne, avec les garanties décrites dans sa politique de confidentialité. N'indiquez dans un message de support aucune information sensible qui ne soit pas utile à votre demande.</p>

  <h2>Vos droits</h2>
  <p>Vous pouvez à tout moment demander l'accès à vos données, leur rectification, leur effacement, la limitation de leur traitement, leur portabilité, ou vous opposer à un traitement fondé sur l'intérêt légitime. Vous pouvez aussi définir des directives sur le sort de vos données après votre décès.</p>
  <p>Pour exercer ces droits, écrivez à ${mail()} depuis l'adresse e-mail de votre compte. Nous répondons dans un délai d'un mois. La suppression du compte efface vos données, à l'exception de celles que la loi impose de conserver (commandes).</p>
  <p>Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la CNIL : 3 place de Fontenoy, TSA 80715, 75334 Paris Cedex 07, cnil.fr.</p>

  <h2>Sécurité</h2>
  <p>Les échanges avec le site et le serveur sont chiffrés (HTTPS). Les mots de passe et les jetons de connexion ne sont jamais enregistrés en clair. L'accès au serveur est restreint à l'éditeur.</p>

  <h2>Mineurs</h2>
  <p>Le service ne s'adresse pas aux enfants de moins de 15 ans. En dessous de cet âge, la création d'un compte demande l'accord du titulaire de l'autorité parentale.</p>

  <h2>Décision automatisée</h2>
  <p>Aucune décision produisant des effets juridiques n'est prise de manière entièrement automatisée, et aucun profilage n'est effectué.</p>

  <h2>Évolution de cette politique</h2>
  <p>Cette page est mise à jour lorsque les traitements changent. La date de dernière mise à jour figure en haut de page.</p>`,
  },

  //============================================================================
  {
    file: 'cookies.html',
    title: 'Politique relative aux cookies',
    description: "Le site onirique.store n'utilise aucun cookie publicitaire ni de mesure d'audience : seulement deux enregistrements strictement nécessaires.",
    intro: "Le site n'utilise ni cookie publicitaire, ni outil de mesure d'audience, ni traceur de réseau social. C'est pourquoi aucun bandeau de consentement ne s'affiche : les seuls enregistrements utilisés sont strictement nécessaires au service que vous demandez, et la loi les dispense de consentement (article 82 de la loi Informatique et Libertés).",
    body: `
  <h2>Ce que le site enregistre dans votre navigateur</h2>
  <div class="table"><table>
    <thead><tr><th>Nom</th><th>Type</th><th>À quoi il sert</th><th>Durée</th></tr></thead>
    <tbody>
      <tr><td><code>onirique.token</code></td><td>Stockage local, ou stockage de session</td><td>Vous garder connecté à votre compte après la connexion</td><td>Avec « Se souvenir de moi » : jusqu'à la déconnexion, 60 jours au plus. Sans : jusqu'à la fermeture du navigateur</td></tr>
      <tr><td><code>onirique-volume</code></td><td>Stockage local</td><td>Retenir le volume choisi pour la démo d'écoute</td><td>Jusqu'à ce que vous effaciez les données du site</td></tr>
    </tbody>
  </table></div>
  <p>Ces enregistrements restent dans votre navigateur. Ils ne servent ni à vous suivre d'un site à l'autre, ni à établir un profil.</p>

  <h2>Le lecteur Spotify</h2>
  <p>La section Crédits propose un lecteur Spotify. Il n'est <strong>pas chargé à l'ouverture de la page</strong> : il n'apparaît que si vous cliquez sur « Charger le lecteur Spotify ». À partir de ce clic, Spotify (Spotify AB, Suède) peut déposer ses propres cookies et collecter des données, sous sa seule responsabilité et selon sa politique de confidentialité. Si vous ne cliquez pas, aucune donnée n'est transmise à Spotify.</p>

  <h2>Aucune ressource chargée chez un tiers</h2>
  <p>Les polices de caractères, les images et les scripts sont servis par le site lui-même. Votre navigateur ne contacte aucun autre service en affichant une page.</p>

  <h2>L'application Onirique Central</h2>
  <p>L'application enregistre sur votre ordinateur votre jeton de connexion, chiffré par Windows, vos réglages et les fichiers de licence de vos plugins. Rien de cela n'est partagé avec un tiers.</p>

  <h2>Effacer ces données</h2>
  <p>Vous pouvez les supprimer à tout moment : en vous déconnectant de votre compte, ou en effaçant les données de site dans les réglages de votre navigateur. Cela n'a aucune autre conséquence que de devoir vous reconnecter et de retrouver le volume par défaut.</p>

  <p>Pour le reste des traitements, voir la <a href="confidentialite.html">politique de confidentialité</a>.</p>`,
  },
];

for (const p of pages) fs.writeFileSync(path.join(here, p.file), page(p));

const missing = Object.entries(ID).filter(([, value]) => !value).map(([key]) => key);
console.log(`${pages.length} pages générées.` + (missing.length ? ` À compléter dans ID : ${missing.join(', ')}.` : ''));
