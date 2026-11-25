import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = dirname(fileURLToPath(import.meta.url));
const dataDir = join(serverDir, '..', 'data');
const dbPath = process.env.DB_PATH || join(dataDir, 'gastos.db');
if (process.env.NODE_ENV === 'production') {
  const resolved = resolve(dbPath);
  const projectRoot = resolve(serverDir, '..');
  if (!process.env.DB_PATH || !isAbsolute(process.env.DB_PATH) || resolved.startsWith(projectRoot + sep) || /(?:^|[\\/])(hbuilds|public_html)(?:[\\/]|$)/i.test(resolved) || !existsSync(resolved)) {
    throw new Error('En producción DB_PATH debe apuntar a una base existente, fuera del código, hbuilds y public_html.');
  }
} else {
  mkdirSync(dirname(dbPath), { recursive: true });
}
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Otros',
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'ARS' CHECK (currency IN ('ARS', 'USD')),
    transaction_date TEXT NOT NULL,
    purchase_date TEXT,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'visa')),
    import_id INTEGER,
    card_last4 TEXT,
    installment_current INTEGER,
    installment_total INTEGER,
    external_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    file_hash TEXT NOT NULL UNIQUE,
    statement_date TEXT,
    due_date TEXT NOT NULL,
    total_ars_cents INTEGER NOT NULL DEFAULT 0,
    total_usd_cents INTEGER NOT NULL DEFAULT 0,
    transaction_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projected_installments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Otros',
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
    due_month TEXT NOT NULL,
    installment_number INTEGER NOT NULL,
    installment_total INTEGER NOT NULL,
    card_last4 TEXT,
    external_key TEXT NOT NULL UNIQUE,
    FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
  CREATE INDEX IF NOT EXISTS idx_transactions_import ON transactions(import_id);
  CREATE INDEX IF NOT EXISTS idx_installments_month ON projected_installments(due_month);

  CREATE TABLE IF NOT EXISTS exchange_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rate_date TEXT NOT NULL UNIQUE,
    rate_cents INTEGER NOT NULL CHECK (rate_cents > 0),
    source TEXT NOT NULL CHECK (source IN ('manual', 'dolarhoy')),
    source_url TEXT,
    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_exchange_rates_date ON exchange_rates(rate_date DESC);

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    color TEXT NOT NULL DEFAULT '#82909a',
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS account_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    opening_balance_cents INTEGER NOT NULL DEFAULT 0,
    overdraft_limit_cents INTEGER NOT NULL DEFAULT 250000000 CHECK (overdraft_limit_cents >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS savings_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    target_cents INTEGER NOT NULL CHECK (target_cents > 0),
    saved_cents INTEGER NOT NULL DEFAULT 0 CHECK (saved_cents >= 0),
    monthly_cents INTEGER NOT NULL DEFAULT 0 CHECK (monthly_cents >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);

if (!db.prepare("PRAGMA table_info(transactions)").all().some((column) => column.name === 'is_recurring')) {
  db.exec('ALTER TABLE transactions ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 0 CHECK (is_recurring IN (0, 1))');
}

const defaultCategories = [
  ['Supermercado', '#59a88f'],
  ['Transporte', '#ec8b66'],
  ['Servicios', '#4b8daa'],
  ['Suscripciones', '#755fb4'],
  ['Comidas', '#d6a136'],
  ['Compras', '#2769d2'],
  ['Seguros', '#d46376'],
  ['Impuestos', '#8d765c'],
  ['Otros', '#82909a'],
];

const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name, color, is_system) VALUES (?, ?, 1)');
defaultCategories.forEach(([name, color]) => insertCategory.run(name, color));
db.exec(`
  INSERT OR IGNORE INTO categories (name, color, is_system)
  SELECT DISTINCT category, '#82909a', 0 FROM transactions WHERE category IS NOT NULL AND TRIM(category) <> '';
  INSERT OR IGNORE INTO account_settings (id, opening_balance_cents, overdraft_limit_cents)
  VALUES (1, 0, 250000000);

  WITH incomplete_manual_plans AS (
    SELECT
      substr(external_key, 1, length(external_key) - length(CAST(installment_current AS TEXT))) AS group_key
    FROM transactions
    WHERE source = 'manual'
      AND installment_total > 1
      AND external_key LIKE 'manual:%'
    GROUP BY group_key
    HAVING COUNT(*) <> MAX(installment_total)
      OR COUNT(DISTINCT installment_current) <> MAX(installment_total)
      OR MIN(installment_current) <> 1
      OR MAX(installment_current) <> MAX(installment_total)
  )
  DELETE FROM transactions
  WHERE source = 'manual'
    AND installment_total > 1
    AND external_key LIKE 'manual:%'
    AND substr(external_key, 1, length(external_key) - length(CAST(installment_current AS TEXT)))
      IN (SELECT group_key FROM incomplete_manual_plans);
`);

export function inTransaction(callback) {
  db.exec('BEGIN');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function toPublicTransaction(row) {
  return {
    ...row,
    amount: row.amount_cents / 100,
  };
}
