import { config } from './config.js';
import { createApp } from './app.js';

createApp().listen(config.port, () => {
  console.log(`ONIRIQUE CENTRAL — API sur ${config.publicUrl} (paiements : ${config.paymentsMode})`);
  if (config.paymentsMode === 'demo') {
    console.warn('Mode démo : les achats sont accordés sans paiement. À ne pas exposer au public.');
  }
});
