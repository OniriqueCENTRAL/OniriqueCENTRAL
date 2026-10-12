import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const paymentsMode = (env.PAYMENTS_MODE || 'off').toLowerCase();
if (!['demo', 'stripe', 'lemon', 'off'].includes(paymentsMode)) {
  throw new Error(`PAYMENTS_MODE invalide : ${paymentsMode}`);
}

if (paymentsMode === 'lemon' && !(env.LEMON_API_KEY && env.LEMON_STORE_ID && env.LEMON_WEBHOOK_SECRET && env.LEMON_VARIANT_ONCE && env.LEMON_VARIANT_MONTH)) {
  throw new Error('PAYMENTS_MODE=lemon demande LEMON_API_KEY, LEMON_STORE_ID, LEMON_WEBHOOK_SECRET, LEMON_VARIANT_ONCE et LEMON_VARIANT_MONTH.');
}

const dataDir = path.resolve(root, env.DATA_DIR || './data');

export const config = {
  root,
  port: Number(env.PORT || 4850),
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 4850}`).replace(/\/+$/, ''),
  dataDir,
  filesDir: path.join(dataDir, 'files'),
  mediaDir: path.join(dataDir, 'media'),
  keysDir: path.join(dataDir, 'keys'),
  adminEmail: env.ADMIN_EMAIL || '',
  // Les fondateurs : ces adresses, une fois validées, portent toujours le rôle le plus élevé.
  founderEmails: (env.FOUNDER_EMAILS ?? 'contacteuhz@gmail.com,nueveprocontact@gmail.com').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  adminPassword: env.ADMIN_PASSWORD || '',
  paymentsMode,
  stripeSecretKey: env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  // Managed Payments : Stripe est le vendeur officiel (il facture, gère la TVA et les litiges). STRIPE_MANAGED=0
  // revient à l'encaissement classique, où le vendeur est l'éditeur.
  stripeManaged: env.STRIPE_MANAGED !== '0',
  // Lemon Squeezy : la boutique, et une « variante » par façon de payer. Le nom et le prix de chaque vente sont
  // fixés par ce serveur au moment de la commande : il n'y a pas un produit à créer là-bas par plugin.
  lemonApiKey: env.LEMON_API_KEY || '',
  lemonStoreId: env.LEMON_STORE_ID || '',
  lemonWebhookSecret: env.LEMON_WEBHOOK_SECRET || '',
  lemonVariants: { once: env.LEMON_VARIANT_ONCE || '', month: env.LEMON_VARIANT_MONTH || '', year: env.LEMON_VARIANT_YEAR || '' },
  // Adresse du site où se trouve la page compte (lien de réinitialisation du mot de passe).
  siteUrl: (env.SITE_URL || env.PUBLIC_URL || `http://localhost:${env.PORT || 4850}`).replace(/\/+$/, ''),
  smtpHost: env.SMTP_HOST || '',
  smtpPort: Number(env.SMTP_PORT || 587),
  smtpUser: env.SMTP_USER || '',
  smtpPassword: env.SMTP_PASSWORD || '',
  mailFrom: env.MAIL_FROM || env.SMTP_USER || '',
  // Boîte qui reçoit les demandes de support (par défaut, celle qui envoie).
  supportEmail: env.SUPPORT_EMAIL || env.MAIL_FROM || env.SMTP_USER || '',
  // Activations simultanées par défaut, et marge laissée hors ligne aux abonnés.
  defaultMaxActivations: 2,
  subscriptionGraceDays: 3,
  trialDays: 7,
  // Durée de la licence écrite sur la machine d'un VIP, renouvelée à chaque lancement d'ONIRIQUE CENTRAL.
  vipLicenseDays: 30,
  // Abonnement à la carte : le premier plugin, puis chaque plugin ajouté, par mois.
  pickBaseCents: 999,
  pickExtraCents: 500,
  // Durée de validité du lien de validation de l'adresse e-mail.
  verifyHours: 48,
  sessionDays: 60,
};

for (const dir of [config.dataDir, config.filesDir, config.mediaDir, config.keysDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
