import { config } from './config.js';
import { createApp } from './app.js';
import { publishDue } from './youtube.js';
import { pollComments } from './social.js';
import { remindReleases, purgeTrash } from './sounds.js';
import { sweepMedia } from './sweep.js';
import { remindCut, publishDueReels } from './cut.js';
import { demarrerRelais } from './vpn.js';

createApp().listen(config.port, () => {
  console.log(`ONIRIQUE CENTRAL — API sur ${config.publicUrl} (paiements : ${config.paymentsMode})`);
  if (config.paymentsMode === 'demo') {
    console.warn('Mode démo : les achats sont accordés sans paiement. À ne pas exposer au public.');
  }
});

// Le relais du VPN d'ONIRIQUE Navigateur.
demarrerRelais();

// Les Shorts YouTube programmés partent à leur heure, à la minute près.
setInterval(() => publishDue().catch(console.error), 60_000);
// Les Reels Instagram programmés depuis ONIRIQUE CUT, de même.
setInterval(() => publishDueReels().catch(console.error), 60_000);

// Réponses automatiques : les commentaires des publications visées sont relus toutes les deux minutes.
setInterval(() => pollComments().catch(console.error), 120_000);

// Les rappels de sortie des projets ONIRIQUE CLOUD (sept jours avant et la veille), vérifiés toutes les heures.
setInterval(() => remindReleases().catch(console.error), 3600_000);
// La corbeille d'ONIRIQUE CLOUD : les titres supprimés il y a plus de 30 jours sont effacés, vérifié toutes les heures.
setInterval(() => { try { purgeTrash(); } catch (error) { console.error('Corbeille :', error.message); } }, 3600_000);

// Le rappel quotidien « poste ton TikTok » des fondateurs (ONIRIQUE CUT), à leur heure, vérifié chaque minute.
setInterval(() => { try { remindCut(); } catch (error) { console.error('Rappel CUT :', error.message); } }, 60_000);

// Le ménage de media/ (images et démos que plus rien ne cite), une minute après le démarrage puis chaque jour.
const sweep = () => { try { const r = sweepMedia(); if (r.files) console.log(`Ménage de media/ : ${r.files} fichiers, ${Math.round(r.bytes / 1048576)} Mo libérés`); } catch (error) { console.error('Ménage de media/ :', error.message); } };
setTimeout(sweep, 60_000);
setInterval(sweep, 86400_000);
