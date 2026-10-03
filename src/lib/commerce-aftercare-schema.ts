import type Database from "better-sqlite3";

/** Add-only event records. Original sale/line/receipt values are never rewritten. */
export function ensureAftercareSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS commerce_aftercare_state (
      sale_id TEXT PRIMARY KEY REFERENCES commerce_sales(id),
      revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0)
    );
    CREATE TABLE IF NOT EXISTS commerce_cancellations (
      id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES commerce_sales(id),
      buyer_account_id INTEGER NOT NULL REFERENCES employees(id),
      request_id TEXT NOT NULL, request_json TEXT NOT NULL, reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
      decision_id TEXT, decision_json TEXT, public_note TEXT NOT NULL DEFAULT '',
      decided_by INTEGER REFERENCES employees(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_at TEXT,
      UNIQUE(sale_id,buyer_account_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS commerce_cancellation_items (
      cancellation_id TEXT NOT NULL REFERENCES commerce_cancellations(id),
      order_id TEXT NOT NULL REFERENCES orders(id), PRIMARY KEY(cancellation_id,order_id)
    );
    CREATE TABLE IF NOT EXISTS commerce_adjustments (
      id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES commerce_sales(id),
      request_id TEXT NOT NULL, request_json TEXT NOT NULL, reason TEXT NOT NULL,
      cancellation_id TEXT UNIQUE REFERENCES commerce_cancellations(id),
      created_by INTEGER NOT NULL REFERENCES employees(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(sale_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS commerce_adjustment_items (
      adjustment_id TEXT NOT NULL REFERENCES commerce_adjustments(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      credit_cents INTEGER NOT NULL CHECK(typeof(credit_cents)='integer' AND credit_cents>0),
      PRIMARY KEY(adjustment_id,order_id)
    );
    CREATE TABLE IF NOT EXISTS commerce_refunds (
      id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES commerce_sales(id),
      request_id TEXT NOT NULL, request_json TEXT NOT NULL, reference TEXT NOT NULL, reason TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES employees(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(sale_id,request_id), UNIQUE(sale_id,reference)
    );
    CREATE TABLE IF NOT EXISTS commerce_refund_items (
      refund_id TEXT NOT NULL REFERENCES commerce_refunds(id), order_id TEXT NOT NULL REFERENCES orders(id),
      amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
      finance_id INTEGER NOT NULL UNIQUE REFERENCES finances(id), PRIMARY KEY(refund_id,order_id)
    );
    CREATE INDEX IF NOT EXISTS idx_commerce_cancellations_sale ON commerce_cancellations(sale_id,status);
    CREATE INDEX IF NOT EXISTS idx_commerce_cancellation_order ON commerce_cancellation_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_commerce_adjustment_order ON commerce_adjustment_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_commerce_refund_order ON commerce_refund_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_commerce_sales_created ON commerce_sales(created_at DESC,id DESC);
  `);
}
