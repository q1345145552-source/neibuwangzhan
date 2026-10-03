import type Database from "better-sqlite3";
import { ORDERABLE_SKUS } from "./commerce-catalog";
import { ensureAftercareSchema } from "./commerce-aftercare-schema";

/** Local merger pilot: off unless explicitly selected; never auto-import catalog or accounts. */
export function commercePilotEnabled(): boolean {
  return process.env.COMMERCE_PILOT_ENABLED === "1";
}

export function ensureCommerceSchema(db: Database.Database): void {
  // Acquire the write reservation before schema reads; deferred upgrades can deadlock across workers.
  db.transaction(() => { db.exec(`
    CREATE TABLE IF NOT EXISTS commerce_products (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE CHECK(sku IN (${ORDERABLE_SKUS.map(sku=>"'"+sku+"'").join(",")})),
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK(typeof(price_cents)='integer' AND price_cents>=0 AND price_cents<=100000000),
      currency TEXT NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS commerce_sales (
      id TEXT PRIMARY KEY,
      buyer_account_id INTEGER NOT NULL REFERENCES employees(id),
      buyer_name TEXT NOT NULL,
      request_id TEXT NOT NULL,
      request_json TEXT NOT NULL,
      total_cents INTEGER NOT NULL CHECK(typeof(total_cents)='integer' AND total_cents>0),
      currency TEXT NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(buyer_account_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS commerce_lines (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL REFERENCES commerce_sales(id),
      line_no INTEGER NOT NULL,
      product_id TEXT NOT NULL REFERENCES commerce_products(id),
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      product_revision INTEGER NOT NULL,
      unit_cents INTEGER NOT NULL CHECK(unit_cents>0),
      quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10),
      total_cents INTEGER NOT NULL CHECK(total_cents=unit_cents*quantity),
      template_key TEXT NOT NULL CHECK(template_key IN ('company-registration-v1','thai-trademark-v1','unclassified-v1','social-security-v1','mall-store-v1','international-trademark-v1','dld-product-v1','nbtc-v1','company-service-v1','company-change-v1','address-cert-v1','mall-enterprise-v1','trademark-buy-r-v1','thai-trademark-plus-v1','fda-product-v1','tisi-negotiable-v1')),
      UNIQUE(sale_id,line_no)
    );
    CREATE TABLE IF NOT EXISTS commerce_fulfillments (
      line_id TEXT NOT NULL REFERENCES commerce_lines(id),
      copy_no INTEGER NOT NULL CHECK(copy_no>0),
      order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
      allocated_cents INTEGER NOT NULL CHECK(allocated_cents>0),
      PRIMARY KEY(line_id,copy_no)
    );
    CREATE TABLE IF NOT EXISTS commerce_public_steps (
      step_id INTEGER PRIMARY KEY REFERENCES order_steps(id),
      public_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS commerce_invoices (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL UNIQUE REFERENCES commerce_sales(id),
      total_cents INTEGER NOT NULL CHECK(total_cents>0),
      currency TEXT NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
      status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','paid')),
      payment_reference TEXT NOT NULL DEFAULT '',
      paid_by INTEGER REFERENCES employees(id),
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS commerce_receipt_finances (
      invoice_id TEXT NOT NULL REFERENCES commerce_invoices(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      finance_id INTEGER NOT NULL UNIQUE REFERENCES finances(id),
      PRIMARY KEY(invoice_id,order_id)
    );
    CREATE TABLE IF NOT EXISTS commerce_line_terms (
      line_id TEXT PRIMARY KEY REFERENCES commerce_lines(id),
      terms_json TEXT NOT NULL CHECK(json_valid(terms_json))
    );
    CREATE TABLE IF NOT EXISTS commerce_carts (
      buyer_account_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0),
      lines_json TEXT NOT NULL CHECK(json_valid(lines_json)),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_commerce_sales_buyer ON commerce_sales(buyer_account_id,created_at);
  `);
    expandReviewedCatalog(db);
    ensureAftercareSchema(db);
  }).immediate();
}

/** Expand only known pilot constraints. Existing values, rowids, indexes, and triggers are preserved. */
function expandReviewedCatalog(db: Database.Database): void {
  const productSql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='commerce_products'").get() as {sql:string}).sql;
  const lineSql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='commerce_lines'").get() as {sql:string}).sql;
  // 已知约束形式：首档 4 SKU → 已核对白名单（历史各档）→ 可下单全集 83 SKU。
  // 检测逻辑：提取表上现有的 CHECK 列表，全部条目都在全集内即视为「已认识的旧形式」，可安全扩为全集；
  // 出现任何不认识的 SKU/key 就抛错，保持「不猜测覆盖」。
  const fullProducts = "CHECK(sku IN (" + ORDERABLE_SKUS.map(sku=>"'"+sku+"'").join(",") + "))";
  const fullLines = "CHECK(template_key IN ('company-registration-v1','thai-trademark-v1','unclassified-v1','social-security-v1','mall-store-v1','international-trademark-v1','dld-product-v1','nbtc-v1','company-service-v1','company-change-v1','address-cert-v1','mall-enterprise-v1','trademark-buy-r-v1','thai-trademark-plus-v1','fda-product-v1','tisi-negotiable-v1'))";
  const knownTemplateKeys = new Set(["company-registration-v1","thai-trademark-v1","unclassified-v1","social-security-v1","mall-store-v1","international-trademark-v1","dld-product-v1","nbtc-v1","company-service-v1","company-change-v1","address-cert-v1","mall-enterprise-v1","trademark-buy-r-v1","thai-trademark-plus-v1","fda-product-v1","tisi-negotiable-v1"]);
  const productMatch = productSql.match(/CHECK\(sku IN \(([^)]*)\)\)/);
  const listedSkus = (productMatch?.[1] ?? "").split(",").map(s=>s.trim().replace(/^'|'$/g,"")).filter(Boolean);
  if (!productMatch || listedSkus.length === 0 || !listedSkus.every(sku => (ORDERABLE_SKUS as readonly string[]).includes(sku)))
    throw new Error("商城约束形式已变化，先复核升级，不猜测覆盖");
  const lineMatch = lineSql.match(/CHECK\(template_key IN \(([^)]*)\)\)/);
  const singleLine = "CHECK(template_key='company-registration-v1')";
  const listedKeys = lineSql.includes(singleLine) ? ["company-registration-v1"]
    : (lineMatch?.[1] ?? "").split(",").map(s=>s.trim().replace(/^'|'$/g,"")).filter(Boolean);
  if (listedKeys.length === 0 || !listedKeys.every(k => knownTemplateKeys.has(k)))
    throw new Error("商城约束形式已变化，先复核升级，不猜测覆盖");
  // 价格约束：旧形式 >0 → 新形式 >=0（0=面议商品，2026-09-22 TISI 裁决）；旧库任何形式都识别升级
  const oldPriceCheck = "CHECK(typeof(price_cents)='integer' AND price_cents>0 AND price_cents<=100000000)";
  const newPriceCheck = "CHECK(typeof(price_cents)='integer' AND price_cents>=0 AND price_cents<=100000000)";
  const priceNeedsUpgrade = productSql.includes(oldPriceCheck);
  const changes: {table:string; sql:string; columns:string[]}[] = [];
  if (listedSkus.length !== ORDERABLE_SKUS.length || priceNeedsUpgrade) {
    let sql = productSql.replace(/CHECK\(sku IN \([^)]*\)\)/, fullProducts);
    if (priceNeedsUpgrade) sql = sql.replace(oldPriceCheck, newPriceCheck);
    changes.push({ table:"commerce_products", sql,
      columns:["id","sku","name","price_cents","currency","revision","active","updated_at"] });
  }
  if (listedKeys.length !== knownTemplateKeys.size) changes.push({ table:"commerce_lines",
    sql:lineSql.replace(/CHECK\(template_key[^)]*\)?\)?/, fullLines),
    columns:["id","sale_id","line_no","product_id","sku","name","product_revision","unit_cents","quantity","total_cents","template_key"] });
  if (!changes.length) return;
  if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("商城升级前存在外键异常，请先核对；不重写原记录");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[];
  for (const change of changes) {
    const actual = db.prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid").all(change.table) as {name:string}[];
    if (JSON.stringify(actual.map(c=>c.name)) !== JSON.stringify(change.columns)) throw new Error("商城表结构有额外改动，先复核升级映射："+change.table);
    for (const table of tables) {
      const refs = db.prepare("SELECT * FROM pragma_foreign_key_list(?)").all(table.name) as {table:string;on_delete:string}[];
      if (refs.some(ref=>ref.table===change.table && ref.on_delete!=="NO ACTION")) throw new Error("商城表存在级联依赖，先复核升级："+table.name);
    }
  }
  const priorDeferred = db.pragma("defer_foreign_keys",{simple:true});
  db.pragma("defer_foreign_keys = ON");
  for (const change of changes) {
    const temporary = change.table+"_reviewed_upgrade";
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(temporary)) throw new Error("商城升级临时对象已存在，请核对，不覆盖："+temporary);
    const dependencies = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL").all(change.table) as {sql:string}[];
    const create = change.sql.replace(new RegExp("^CREATE TABLE (?:IF NOT EXISTS )?[\"`]?"+change.table+"[\"`]?"),"CREATE TABLE "+temporary);
    if (create === change.sql) throw new Error("商城建表语句形式需复核："+change.table);
    db.exec(create);
    const columns = ["rowid",...change.columns].map(c=>'"'+c+'"').join(",");
    db.exec(`INSERT INTO ${temporary} (${columns}) SELECT ${columns} FROM ${change.table};
      DROP TABLE ${change.table}; ALTER TABLE ${temporary} RENAME TO ${change.table};`);
    for (const dep of dependencies) db.exec(dep.sql);
  }
  // SQLite retains deferred violations against dropped table roots even after a valid rebuild.
  // Check ALL references explicitly before resetting that stale counter, with foreign_keys still ON.
  if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("商城升级外键核对失败，整笔回滚");
  db.pragma("defer_foreign_keys = OFF");
  if (priorDeferred) db.pragma("defer_foreign_keys = ON");
}

/** Exact identity join; never a company/name fallback or a user-supplied buyer ID. */
export function isCommerceBuyer(db: Database.Database, accountId: number, orderId: string): boolean {
  if (!commercePilotEnabled()) return false;
  return !!db.prepare(`SELECT 1 FROM commerce_sales s
    JOIN commerce_lines l ON l.sale_id=s.id
    JOIN commerce_fulfillments f ON f.line_id=l.id
    JOIN orders o ON o.id=f.order_id
    WHERE f.order_id=? AND s.buyer_account_id=? AND o.source_system='commerce'
      AND o.source_customer_id=CAST(s.buyer_account_id AS TEXT)`).get(orderId, accountId);
}

/** Remains effective with the pilot off: existing sales must not acquire a second money writer. */
export function isCommerceOrder(db: Database.Database, orderId: string): boolean {
  return !!db.prepare("SELECT 1 FROM orders WHERE id=? AND source_system='commerce'").get(orderId);
}
