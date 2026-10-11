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

export const now = () => Date.now();

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
