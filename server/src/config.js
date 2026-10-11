import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const paymentsMode = (env.PAYMENTS_MODE || 'off').toLowerCase();
if (!['demo', 'stripe', 'off'].includes(paymentsMode)) {
  throw new Error(`PAYMENTS_MODE invalide : ${paymentsMode}`);
}
if (paymentsMode === 'stripe' && !(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET)) {
  throw new Error('PAYMENTS_MODE=stripe demande STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET.');
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
  adminPassword: env.ADMIN_PASSWORD || '',
  paymentsMode,
  stripeSecretKey: env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
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
