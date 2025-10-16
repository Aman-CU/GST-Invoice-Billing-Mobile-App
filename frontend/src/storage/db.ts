import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDb() {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('gst_billing.db');
  await migrate(db);
  return db;
}

async function migrate(d: SQLite.SQLiteDatabase) {
  await d.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS shops (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      gst_number TEXT NOT NULL,
      state TEXT NOT NULL,
      phone TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT,
      shop_details_json TEXT NOT NULL,
      customer_details_json TEXT NOT NULL,
      reverse_charge INTEGER DEFAULT 0,
      qr_code_base64 TEXT,
      total_taxable_value REAL DEFAULT 0,
      total_cgst REAL DEFAULT 0,
      total_sgst REAL DEFAULT 0,
      total_tax REAL DEFAULT 0,
      round_off REAL DEFAULT 0,
      final_amount REAL DEFAULT 0,
      amount_in_words TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_rate REAL NOT NULL,
      discount_percentage REAL DEFAULT 0,
      gst_rate REAL DEFAULT 18,
      FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

