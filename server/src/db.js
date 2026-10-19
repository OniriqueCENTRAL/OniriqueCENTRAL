import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(path.join(config.dataDir, 'central.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  stripe_customer TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  tagline     TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  accent      TEXT NOT NULL DEFAULT '#e23444',
  price_cents INTEGER NOT NULL DEFAULT 0,
  image       TEXT,
  published   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  version    TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  filename   TEXT NOT NULL,
  stored_as  TEXT NOT NULL,
  size       INTEGER NOT NULL,
  sha256     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (product_id, version)
);

CREATE TABLE IF NOT EXISTS plans (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  interval    TEXT NOT NULL CHECK (interval IN ('month', 'year')),
  price_cents INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id            INTEGER NOT NULL REFERENCES plans(id),
  status             TEXT NOT NULL,
  current_period_end INTEGER NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  stripe_subscription TEXT,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS licenses (
  id              INTEGER PRIMARY KEY,
  key             TEXT NOT NULL UNIQUE,
  product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reserved_email  TEXT COLLATE NOCASE,
  type            TEXT NOT NULL DEFAULT 'perpetual',
  status          TEXT NOT NULL DEFAULT 'active',
  expires_at      INTEGER,
  max_activations INTEGER NOT NULL,
  source          TEXT NOT NULL DEFAULT 'admin',
  note            TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activations (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  machine_id   TEXT NOT NULL,
  machine_name TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (user_id, product_id, machine_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  ref_id       INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  provider     TEXT NOT NULL,
  provider_ref TEXT UNIQUE,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS credits (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  artist     TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'Single',
  released   TEXT NOT NULL DEFAULT '',
  duration   TEXT NOT NULL DEFAULT '',
  spotify_id TEXT NOT NULL,
  cover      TEXT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  used_on    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS support_messages (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  subject    TEXT NOT NULL,
  message    TEXT NOT NULL,
  context    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS licenses_user ON licenses(user_id);
CREATE INDEX IF NOT EXISTS versions_product ON versions(product_id);
`);

// Colonne ajoutée après la première mise en production : la démo interactive d'un plugin (fichier JSON dans media/).
if (!db.prepare(`SELECT 1 FROM pragma_table_info('products') WHERE name = 'demo'`).get()) {
  db.exec('ALTER TABLE products ADD COLUMN demo TEXT');
}

const hasColumn = (table, column) => !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);

// Validation de l'adresse e-mail. Les comptes créés avant cette colonne sont tenus pour validés : ils n'ont
// jamais reçu de lien, et rien ne doit leur être retiré.
if (!hasColumn('users', 'email_verified')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE users SET email_verified = 1');
}

// Abonnement à la carte : une formule de genre "pick" donne droit aux seuls plugins choisis, dont la liste
// (un tableau JSON d'identifiants) est gardée sur l'abonnement. NULL = tous les plugins, comme avant.
if (!hasColumn('plans', 'kind')) db.exec(`ALTER TABLE plans ADD COLUMN kind TEXT NOT NULL DEFAULT 'all'`);
if (!hasColumn('subscriptions', 'product_ids')) db.exec('ALTER TABLE subscriptions ADD COLUMN product_ids TEXT');

// Versions par système : le même numéro peut exister pour Windows ("win") et pour Mac ("mac"). L'unicité
// (plugin, numéro) d'origine ne peut pas être changée sur place : la table est recopiée, une seule fois.
if (!hasColumn('versions', 'platform')) {
  db.exec(`
    BEGIN;
    CREATE TABLE versions_new (
      id         INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      version    TEXT NOT NULL,
      notes      TEXT NOT NULL DEFAULT '',
      filename   TEXT NOT NULL,
      stored_as  TEXT NOT NULL,
      size       INTEGER NOT NULL,
      sha256     TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      platform   TEXT NOT NULL DEFAULT 'win',
      UNIQUE (product_id, version, platform)
    );
    INSERT INTO versions_new (id, product_id, version, notes, filename, stored_as, size, sha256, created_at)
      SELECT id, product_id, version, notes, filename, stored_as, size, sha256, created_at FROM versions;
    DROP TABLE versions;
    ALTER TABLE versions_new RENAME TO versions;
    CREATE INDEX IF NOT EXISTS versions_product ON versions(product_id);
    COMMIT;
  `);
}

// ALL LICENCE : une clé de pack donne une licence par plugin. Les licences d'un même pack portent sa clé ici.
if (!hasColumn('licenses', 'bundle')) {
  db.exec('ALTER TABLE licenses ADD COLUMN bundle TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS licenses_bundle ON licenses(bundle)');
}

// Créateur du plugin : "onirique", ou un partenaire ("abrasion", "relic") dont les comptes gèrent alors leurs propres plugins.
if (!hasColumn('products', 'creator')) {
  db.exec(`ALTER TABLE products ADD COLUMN creator TEXT NOT NULL DEFAULT 'onirique'`);
  db.exec(`UPDATE products SET creator = 'abrasion' WHERE slug LIKE 'onirique-x-abrasion-%'`);
}

// L'équipe et les partenaires s'accordent eux-mêmes tous les plugins, ou y renoncent (pour voir l'application comme
// un client) : c'est ce réglage, par compte. Il ne vaut que tant que le compte porte un de ces rôles.
if (!hasColumn('users', 'self_licenses')) db.exec('ALTER TABLE users ADD COLUMN self_licenses INTEGER NOT NULL DEFAULT 0');

// Photo de profil : un fichier image dans media/, ou rien (le site et l'application dessinent alors l'avatar par défaut).
if (!hasColumn('users', 'avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');

/** Donne le rôle de fondateur aux adresses de la configuration, une fois leur adresse validée. */
export function grantFounders() {
  for (const email of config.founderEmails) {
    db.prepare(`UPDATE users SET role = 'founder' WHERE email = ? AND email_verified != 0`).run(email);
  }
}
grantFounders();

// Un compte Stripe par créateur de plugins, branché depuis le panel admin. Les deux secrets sont chiffrés (payments.js).
db.exec(`CREATE TABLE IF NOT EXISTS stripe_accounts (
  creator        TEXT PRIMARY KEY,
  secret_key     TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  webhook_id     TEXT,
  name           TEXT NOT NULL DEFAULT '',
  test           INTEGER NOT NULL DEFAULT 0,
  managed        INTEGER NOT NULL DEFAULT 1,
  updated_at     INTEGER NOT NULL
)`);

// Shorts YouTube programmés depuis la page compte (youtube.js) : la chaîne reliée à un compte, son accès chiffré,
// et les vidéos qui attendent. Statuts : draft (sans date), scheduled, uploading, published, failed.
db.exec(`
CREATE TABLE IF NOT EXISTS youtube_accounts (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  uploads       TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS youtube_videos (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stored_as   TEXT NOT NULL,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  publish_at  INTEGER,
  status      TEXT NOT NULL DEFAULT 'draft',
  youtube_id  TEXT,
  error       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
`);

// L'image d'un plugin choisie à la main n'est plus remplacée par l'aperçu automatique ; une démo retirée à la main
// n'est pas refabriquée toute seule.
if (!hasColumn('products', 'image_manual')) db.exec('ALTER TABLE products ADD COLUMN image_manual INTEGER NOT NULL DEFAULT 0');
if (!hasColumn('products', 'demo_off')) db.exec('ALTER TABLE products ADD COLUMN demo_off INTEGER NOT NULL DEFAULT 0');
// L'ordre de la boutique et de l'application, choisi par l'équipe dans le panel. Au départ : l'ordre d'ajout.
if (!hasColumn('products', 'position')) {
  db.exec('ALTER TABLE products ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE products SET position = (SELECT COUNT(*) FROM products q WHERE q.created_at < products.created_at OR (q.created_at = products.created_at AND q.id <= products.id))');
}

// Le partenaire s'appelait « bloom », du nom de son plugin : c'est RELIC. Son rôle, ses plugins et son compte de
// paiement changent de nom avec lui ; BLOOM reste le nom du plugin.
db.exec(`UPDATE users SET role = 'relic' WHERE role = 'bloom'`);
db.exec(`UPDATE products SET creator = 'relic' WHERE creator = 'bloom'`);
db.exec(`UPDATE stripe_accounts SET creator = 'relic' WHERE creator = 'bloom'`);

// Codes promo (promos.js) : créés depuis le panel admin, ou offerts à un parrain (kind "reward", owner_id : lui seul
// peut s'en servir). Chaque utilisation est gardée : un code ne sert qu'une fois par compte.
db.exec(`
CREATE TABLE IF NOT EXISTS promo_codes (
  id           INTEGER PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  percent      INTEGER,
  amount_cents INTEGER,
  product_ids  TEXT,
  creator      TEXT,
  max_uses     INTEGER,
  expires_at   INTEGER,
  active       INTEGER NOT NULL DEFAULT 1,
  owner_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'admin',
  note         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS promo_redemptions (
  id             INTEGER PRIMARY KEY,
  promo_id       INTEGER REFERENCES promo_codes(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id     INTEGER,
  order_ref      TEXT,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  UNIQUE (promo_id, user_id)
);
CREATE INDEX IF NOT EXISTS promo_owner ON promo_codes(owner_id);
`);

// Parrainage : le code d'invitation de chaque compte, son parrain, la remise de bienvenue déjà prise, et si son
// premier achat payé a déjà récompensé le parrain.
if (!hasColumn('users', 'referral_code')) {
  db.exec('ALTER TABLE users ADD COLUMN referral_code TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code ON users(referral_code)');
}
if (!hasColumn('users', 'referred_by')) db.exec('ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
if (!hasColumn('users', 'referral_welcome_used')) db.exec('ALTER TABLE users ADD COLUMN referral_welcome_used INTEGER NOT NULL DEFAULT 0');
if (!hasColumn('users', 'referral_rewarded')) db.exec('ALTER TABLE users ADD COLUMN referral_rewarded INTEGER NOT NULL DEFAULT 0');

// Catégorie d'un plugin dans la boutique et l'application (beatmaking, mix, master, mesure, application…).
// Vide : devinée à partir de son nom et de son texte (categoryOf dans app.js).
// Une seule catégorie par plugin, et plus de « Voix » (qui doublait « Mix ») : les plugins en ligne ce jour-là
// sont rangés à nouveau, une fois. Les autres reprennent leur première catégorie encore valable, ou la devinée.
function rangeCategories() {
  const known = {
    tuner: 'mix', based: 'mix', vocalbox: 'mix', 'onirique-broadcast': 'app', 'onirique-pitchbox': 'mix',
    'onirique-resobox': 'mix', 'onirique-x-abrasion-raw': 'beat', 'onirique-x-abrasion-tama-vox': 'mix',
    'onirique-doublebox': 'mix', 'onirique-vocal-spacer': 'mix', 'onirique-modbox': 'beat',
    'onirique-x-abrasion-mimic': 'beat', bloom: 'master', 'onirique-meterbox': 'meter',
  };
  for (const p of db.prepare('SELECT id, slug, category FROM products').all()) {
    const next = known[p.slug] ?? String(p.category).split(',').find((id) => ['beat', 'mix', 'master', 'meter', 'app'].includes(id)) ?? '';
    db.prepare('UPDATE products SET category = ? WHERE id = ?').run(next, p.id);
  }
}
if (!hasColumn('products', 'category')) {
  db.exec(`ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT ''`);
  // Les plugins déjà en ligne ce jour-là, rangés à la main ; un plugin peut être dans plusieurs catégories.
  const known = {
    tuner: 'voice,mix', based: 'voice,mix', vocalbox: 'voice,mix', 'onirique-broadcast': 'app,voice', 'onirique-pitchbox': 'voice',
    'onirique-resobox': 'mix,master', 'onirique-x-abrasion-raw': 'beat', 'onirique-x-abrasion-tama-vox': 'beat,voice',
    'onirique-doublebox': 'voice,mix', 'onirique-vocal-spacer': 'mix,voice', 'onirique-modbox': 'beat,mix',
    'onirique-x-abrasion-mimic': 'beat', bloom: 'mix,master', 'onirique-meterbox': 'meter,master',
  };
  for (const [slug, category] of Object.entries(known)) db.prepare('UPDATE products SET category = ? WHERE slug = ?').run(category, slug);
}
if (!db.prepare(`SELECT 1 FROM settings WHERE key = 'categories_single'`).get()) {
  rangeCategories();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('categories_single', 'true')`).run();
}

// Abonnements réglables depuis le panel : un texte de présentation et les plugins compris (vide : tous les plugins
// ONIRIQUE). Packs : plusieurs plugins achetés une fois, au prix du pack, chacun avec sa licence définitive.
if (!hasColumn('plans', 'description')) db.exec(`ALTER TABLE plans ADD COLUMN description TEXT NOT NULL DEFAULT ''`);
if (!hasColumn('plans', 'product_ids')) db.exec('ALTER TABLE plans ADD COLUMN product_ids TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS packs (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  product_ids TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trial_claims (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL,
  user_id    INTEGER,
  machine_id TEXT NOT NULL,
  ip_hash    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trial_machine ON trial_claims(product_id, machine_id);
CREATE INDEX IF NOT EXISTS trial_ip ON trial_claims(product_id, ip_hash);
CREATE TABLE IF NOT EXISTS orders_archive (
  id           INTEGER PRIMARY KEY,
  email        TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL,
  ref_id       INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  provider     TEXT NOT NULL,
  provider_ref TEXT,
  created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activation_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  machine_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activation_log_user ON activation_log(user_id, product_id, created_at);
`);

// Le lien Instagram d'un compte (les ingés d'ONIRIQUE l'affichent sous les crédits).
if (!hasColumn('users', 'instagram')) db.exec(`ALTER TABLE users ADD COLUMN instagram TEXT NOT NULL DEFAULT ''`);
// Le profil d'ingé d'un fondateur : le pseudo et la photo montrés sous les crédits, à la place du nom et de la photo du compte.
if (!hasColumn('users', 'engineer_name')) db.exec(`ALTER TABLE users ADD COLUMN engineer_name TEXT NOT NULL DEFAULT ''`);
if (!hasColumn('users', 'engineer_avatar')) db.exec('ALTER TABLE users ADD COLUMN engineer_avatar TEXT');
// Double authentification (A2F, facultative) : la clé de l'application, celle en cours d'activation, le dernier pas
// de temps servi (un code ne se rejoue pas) et les empreintes des codes de secours restants.
for (const column of ['totp_secret TEXT', 'totp_pending TEXT', 'totp_step INTEGER', 'totp_recovery TEXT']) {
  if (!hasColumn('users', column.split(' ')[0])) db.exec(`ALTER TABLE users ADD COLUMN ${column}`);
}

// Crédits : plusieurs plugins par titre, un album entier possible, l'ingé (un compte fondateur) et la popularité
// Spotify, qui range la liste du plus connu au moins connu.
if (!hasColumn('credits', 'product_ids')) {
  db.exec('ALTER TABLE credits ADD COLUMN product_ids TEXT');
  db.exec(`UPDATE credits SET product_ids = '[' || product_id || ']' WHERE product_id IS NOT NULL`);
}
if (!hasColumn('credits', 'spotify_type')) db.exec(`ALTER TABLE credits ADD COLUMN spotify_type TEXT NOT NULL DEFAULT 'track'`);
if (!hasColumn('credits', 'engineer_id')) db.exec('ALTER TABLE credits ADD COLUMN engineer_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
// Plusieurs ingés sur un même titre : la liste, dans l'ordre d'affichage (engineer_id garde le premier).
if (!hasColumn('credits', 'engineer_ids')) {
  db.exec('ALTER TABLE credits ADD COLUMN engineer_ids TEXT');
  db.exec(`UPDATE credits SET engineer_ids = '[' || engineer_id || ']' WHERE engineer_id IS NOT NULL`);
}
if (!hasColumn('credits', 'popularity')) db.exec('ALTER TABLE credits ADD COLUMN popularity INTEGER');
if (!hasColumn('credits', 'popularity_at')) db.exec('ALTER TABLE credits ADD COLUMN popularity_at INTEGER');
// Épinglé : un des trois crédits montrés sur la page d'accueil, avant les plus connus.
if (!hasColumn('credits', 'pinned')) db.exec('ALTER TABLE credits ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
// Le lien Apple Music du titre ou de l'album, en plus de Spotify (facultatif).
if (!hasColumn('credits', 'apple_music')) db.exec(`ALTER TABLE credits ADD COLUMN apple_music TEXT NOT NULL DEFAULT ''`);

// Réponses automatiques aux commentaires Instagram (social.js) : le compte relié et son accès chiffré, les automations
// (une publication, des mots, la réponse publique, le message privé), et chaque commentaire traité (une fois par
// commentaire, une fois par personne).
db.exec(`
CREATE TABLE IF NOT EXISTS social_accounts (
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform           TEXT NOT NULL,
  account_id         TEXT NOT NULL,
  username           TEXT NOT NULL DEFAULT '',
  access_token       TEXT NOT NULL,
  refresh_token      TEXT,
  expires_at         INTEGER NOT NULL,
  refresh_expires_at INTEGER,
  error              TEXT NOT NULL DEFAULT '',
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (user_id, platform)
);
CREATE TABLE IF NOT EXISTS social_automations (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL,
  post_id      TEXT NOT NULL,
  post_caption TEXT NOT NULL DEFAULT '',
  post_thumb   TEXT,
  post_url     TEXT,
  keywords     TEXT NOT NULL DEFAULT '',
  dm_text      TEXT NOT NULL DEFAULT '',
  reply_text   TEXT NOT NULL DEFAULT '',
  active       INTEGER NOT NULL DEFAULT 1,
  since        INTEGER NOT NULL,
  sent_count   INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS social_replies (
  automation_id  INTEGER NOT NULL REFERENCES social_automations(id) ON DELETE CASCADE,
  comment_id     TEXT NOT NULL,
  commenter_id   TEXT NOT NULL DEFAULT '',
  commenter_name TEXT NOT NULL DEFAULT '',
  comment_text   TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL,
  error          TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (automation_id, comment_id)
);
CREATE INDEX IF NOT EXISTS social_replies_by_person ON social_replies (automation_id, commenter_id);
`);
// L'identifiant du compte Instagram propre à l'application, à côté de l'identifiant professionnel (social.js).
if (!hasColumn('social_accounts', 'alt_id')) db.exec(`ALTER TABLE social_accounts ADD COLUMN alt_id TEXT NOT NULL DEFAULT ''`);
// La date de la publication visée : un message privé envoyé depuis compte comme « déjà contacté » (social.js).
if (!hasColumn('social_automations', 'post_at')) db.exec('ALTER TABLE social_automations ADD COLUMN post_at INTEGER');
// TikTok retiré : son like ne sert plus, ni ses comptes et automations.
if (hasColumn('social_automations', 'like_comment')) db.exec('ALTER TABLE social_automations DROP COLUMN like_comment');
db.exec(`DELETE FROM social_automations WHERE platform = 'tiktok'; DELETE FROM social_accounts WHERE platform = 'tiktok';`);

export const now = () => Date.now();

/** Un réglage modifiable depuis le panel admin (table settings), ou la valeur de la configuration s'il n'a jamais été changé. */
export const setting = (key, fallback) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
};
export const setSetting = (key, value) => {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
};

export const get = (sql, ...params) => db.prepare(sql).get(...params);
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
