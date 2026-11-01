import type Database from "better-sqlite3";
/** First-round additive schema: never rebuild or change registration orders/customers. */
export function ensureCompanyArchiveSchema(db:Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS company_archives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_zh TEXT NOT NULL DEFAULT '', name_foreign TEXT NOT NULL DEFAULT '',
    registered_address TEXT NOT NULL DEFAULT '', legal_representative TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '', business_scope TEXT NOT NULL DEFAULT '',
    registered_capital TEXT NOT NULL DEFAULT '', registration_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '注册中' CHECK(status IN ('注册中','已注册','注销')),
    order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    version INTEGER NOT NULL DEFAULT 1,
    CHECK(length(trim(name_zh))>0 OR length(trim(name_foreign))>0)
  );
  CREATE INDEX IF NOT EXISTS idx_company_archives_status ON company_archives(status,id DESC);
  CREATE INDEX IF NOT EXISTS idx_company_archives_order ON company_archives(order_id);
  CREATE INDEX IF NOT EXISTS idx_company_archives_customer ON company_archives(customer_id);`);
}
