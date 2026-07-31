import { getRawDb } from "../../../db";
import { PRODUCT_SEED } from "../../domain/products";
import { DEFAULT_BUSINESS_TIMEZONE, toBusinessDate } from "../../domain/business-time";

let initialized = false;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, selling_price_paise INTEGER NOT NULL CHECK(selling_price_paise >= 0),
    normal_commission_paise INTEGER NOT NULL CHECK(normal_commission_paise >= 0),
    full_commission_paise INTEGER NOT NULL CHECK(full_commission_paise >= 0),
    reward_threshold INTEGER NOT NULL DEFAULT 12 CHECK(reward_threshold > 0),
    sort_order INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS commission_progress (
    product_id TEXT PRIMARY KEY REFERENCES products(id), normal_sales_completed INTEGER NOT NULL DEFAULT 0,
    cycle_number INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS day_sessions (
    id TEXT PRIMARY KEY, business_date TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED')),
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, closed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_open_day_session_idx ON day_sessions(status) WHERE status = 'OPEN'`,
  `CREATE TABLE IF NOT EXISTS day_stock_items (
    id TEXT PRIMARY KEY, day_session_id TEXT NOT NULL REFERENCES day_sessions(id),
    product_id TEXT NOT NULL REFERENCES products(id), picked_quantity INTEGER NOT NULL CHECK(picked_quantity >= 0),
    sold_quantity INTEGER NOT NULL DEFAULT 0 CHECK(sold_quantity >= 0),
    remaining_quantity INTEGER NOT NULL CHECK(remaining_quantity >= 0),
    product_name_snapshot TEXT NOT NULL, unit_price_paise_snapshot INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(day_session_id, product_id), CHECK(sold_quantity <= picked_quantity),
    CHECK(remaining_quantity = picked_quantity - sold_quantity)
  )`,
  `CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, product_id TEXT NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price_paise INTEGER NOT NULL,
    normal_commission_paise INTEGER NOT NULL, full_commission_paise INTEGER NOT NULL, reward_threshold INTEGER NOT NULL,
    normal_units INTEGER NOT NULL, full_units INTEGER NOT NULL, gross_sales_paise INTEGER NOT NULL,
    total_normal_commission_paise INTEGER NOT NULL, total_full_commission_paise INTEGER NOT NULL,
    total_earnings_paise INTEGER NOT NULL, net_collection_paise INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS sales_created_at_idx ON sales(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS day_session_sales (
    sale_id TEXT PRIMARY KEY REFERENCES sales(id), day_session_id TEXT NOT NULL REFERENCES day_sessions(id),
    business_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS day_session_sales_session_idx ON day_session_sales(day_session_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS full_commission_rewards (
    id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), product_id TEXT NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL, cycle_number INTEGER NOT NULL, amount_paise INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS rewards_created_at_idx ON full_commission_rewards(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS day_closures (
    id TEXT PRIMARY KEY, business_date TEXT NOT NULL UNIQUE, total_units INTEGER NOT NULL,
    gross_sales_paise INTEGER NOT NULL, total_normal_commission_paise INTEGER NOT NULL,
    total_full_commission_paise INTEGER NOT NULL, total_earnings_paise INTEGER NOT NULL,
    net_collection_paise INTEGER NOT NULL, report_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY, salesman_name TEXT NOT NULL, business_name TEXT NOT NULL,
    whatsapp_number TEXT NOT NULL, currency TEXT NOT NULL, locale TEXT NOT NULL,
    timezone TEXT NOT NULL, realtime_enabled INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

export async function ensureDatabase() {
  if (initialized) return getRawDb();
  const db = getRawDb();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  await db.batch([
    ...PRODUCT_SEED.map((product, index) => db.prepare(
      `INSERT OR IGNORE INTO products
      (id, name, selling_price_paise, normal_commission_paise, full_commission_paise, reward_threshold, sort_order, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    ).bind(product.id, product.name, product.sellingPricePaise, product.normalCommissionPaise, product.fullCommissionPaise, product.rewardThreshold, index)),
    ...PRODUCT_SEED.map((product) => db.prepare(
      "INSERT OR IGNORE INTO commission_progress (product_id, normal_sales_completed, cycle_number) VALUES (?, 0, 1)"
    ).bind(product.id)),
    db.prepare(
      `INSERT OR IGNORE INTO settings
      (id, salesman_name, business_name, whatsapp_number, currency, locale, timezone, realtime_enabled)
      VALUES ('default', 'Salesman', 'Sales Commission', '', 'INR', 'en-IN', '${DEFAULT_BUSINESS_TIMEZONE}', 1)`
    ),
  ]);
  initialized = true;
  return db;
}

export function businessDate(timeZone = DEFAULT_BUSINESS_TIMEZONE, date = new Date()) {
  return toBusinessDate(date, timeZone);
}

export function parseDatabaseTimestamp(value: string) {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

export async function getDatabaseTime(timeZone = DEFAULT_BUSINESS_TIMEZONE) {
  const db = await ensureDatabase();
  const row = await db.prepare("SELECT CURRENT_TIMESTAMP AS server_time").first<{ server_time: string }>();
  if (!row?.server_time) throw new Error("Trusted server time is unavailable.");
  const serverTime = parseDatabaseTimestamp(row.server_time);
  return {
    serverTime,
    serverTimeIso: serverTime.toISOString(),
    businessDate: toBusinessDate(serverTime, timeZone),
    timezone: timeZone,
  };
}

export function friendlyDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("UNIQUE") && message.includes("idempotency")) return "This sale was already saved.";
  if (message.includes("UNIQUE") && message.includes("day_sessions.status")) return "A previous business day is still open.";
  if (message.includes("UNIQUE") && message.includes("business_date")) return "This business date already exists.";
  if (message.includes("CHECK constraint failed")) return "The requested quantity is greater than the remaining stock.";
  return "We could not complete that request. Please try again.";
}
