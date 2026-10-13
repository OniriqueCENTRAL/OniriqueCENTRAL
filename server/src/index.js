import { config } from './config.js';
import { createApp } from './app.js';
import { publishDue } from './youtube.js';

createApp().listen(config.port, () => {
  console.log(`ONIRIQUE CENTRAL — API sur ${config.publicUrl} (paiements : ${config.paymentsMode})`);
  if (config.paymentsMode === 'demo') {
    console.warn('Mode démo : les achats sont accordés sans paiement. À ne pas exposer au public.');
  }
});

// Les Shorts YouTube programmés partent à leur heure, à la minute près.
setInterval(() => publishDue().catch(console.error), 60_000);
