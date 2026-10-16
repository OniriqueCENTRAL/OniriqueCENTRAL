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
  // Les vidéos qui attendent leur heure de publication sur YouTube.
  videosDir: path.join(dataDir, 'videos'),
  // Connexion des chaînes YouTube (page compte) : l'identifiant OAuth du projet Google, réglé par onirique-youtube.
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
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
  // La boîte de l'adresse d'ONIRIQUE, lue par IMAP pour le panel des fondateurs. Par défaut, le même compte que l'envoi
  // (SMTP_USER, SMTP_PASSWORD), sur le serveur IMAP du même hébergeur (smtp.ionos.fr → imap.ionos.fr).
  imapHost: env.IMAP_HOST || (/(^|\.)smtp\./.test(env.SMTP_HOST || '') ? env.SMTP_HOST.replace(/(^|\.)smtp\./, '$1imap.') : ''),
  imapPort: Number(env.IMAP_PORT || 993),
  imapUser: env.IMAP_USER || env.SMTP_USER || '',
  imapPassword: env.IMAP_PASSWORD || env.SMTP_PASSWORD || '',
  supportEmail: env.SUPPORT_EMAIL || env.MAIL_FROM || env.SMTP_USER || '',
  // D'où vient le score de popularité Spotify de la page « Popularité » du site (voir popularity.js).
  popularitySource: env.POPULARITY_SOURCE || 'https://groover.co/core/distantapi/spotify/popularity/',
  // Recherche de titres et extraits de 30 s (outil « Comparer à une référence ») : l'API publique de Deezer.
  deezerApi: (env.DEEZER_API || 'https://api.deezer.com').replace(/\/+$/, ''),
  // Activations simultanées par défaut, et marge laissée hors ligne aux abonnés.
  defaultMaxActivations: 2,
  subscriptionGraceDays: 3,
  trialDays: 7,
  trialsPerIp: Number(process.env.TRIALS_PER_IP || 2),
  leaseDays: Number(process.env.LEASE_DAYS || 90), // validité hors ligne d'un fichier de licence, renouvelé par ONIRIQUE CENTRAL
  extraActivationsPerMonth: Number(process.env.EXTRA_ACTIVATIONS || 3), // nouveaux ordinateurs par mois, au-delà de la limite // essais d'un même plugin depuis une même connexion, sur six mois
  // Durée de la licence écrite sur la machine d'un VIP, renouvelée à chaque lancement d'ONIRIQUE CENTRAL.
  vipLicenseDays: 30,
  // Abonnement à la carte : le premier plugin, puis chaque plugin ajouté, par mois.
  pickBaseCents: 999,
  pickExtraCents: 500,
  // Durée de validité du lien de validation de l'adresse e-mail.
  verifyHours: 48,
  sessionDays: 60,
};

for (const dir of [config.dataDir, config.filesDir, config.mediaDir, config.keysDir, config.videosDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
