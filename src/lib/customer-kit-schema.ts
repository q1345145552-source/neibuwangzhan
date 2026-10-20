import type Database from "better-sqlite3";

/**
 * 订单资料和每步评价（2026-10-20 老板 2A 3A 4A）。只加不删：新表没有才建，documents 只加一列可以为空的新列，老数据一行不动。
 *
 * - workflow_template_files：流程设置里给每套流程配的「说明书」「资料收集表」（每种业务固定一份，2A）。
 *   这种业务的订单客户打开就能看到；删了只做标记（deleted_at），客户那边不再显示。
 * - documents.category：员工给客户的文件分类，现在只有「合同」（2A：合同每单不同，员工在订单里上传）；空 = 普通交付文件。
 * - step_ratings：客户在业务系统给每一步打的分（1～5 星 + 一句话，3A），按客户站单号 + 第几项第几份 + 第几步认，一步只评一次。
 *   assignee / points 是收到时按那一步经办人记下的积分（4A：跟「评价链接」一样，≥4 星 +3、≤2 星 -3）。
 * - rating_gifts：一张客户单每一步都评完，送一份泰国特产（3A）；员工送了点「已送出」。
 */
export function ensureCustomerKitSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_template_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES workflow_templates(id),
      kind TEXT NOT NULL CHECK(kind IN ('说明书', '资料收集表')),
      name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      uploaded_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS step_ratings (
      id TEXT PRIMARY KEY,
      source_order_no TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      copy_no INTEGER NOT NULL,
      step_order INTEGER NOT NULL,
      internal_order_id TEXT,
      step_id INTEGER,
      step_name TEXT NOT NULL DEFAULT '',
      public_name TEXT NOT NULL DEFAULT '',
      assignee TEXT NOT NULL DEFAULT '',
      stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
      comment TEXT NOT NULL DEFAULT '',
      points INTEGER NOT NULL DEFAULT 0,
      customer_name TEXT NOT NULL DEFAULT '',
      rated_at TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_order_no, line_no, copy_no, step_order)
    );
    CREATE INDEX IF NOT EXISTS idx_step_ratings_order ON step_ratings(internal_order_id);
    CREATE TABLE IF NOT EXISTS rating_gifts (
      source_order_no TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL DEFAULT '',
      qualified_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT,
      sent_by TEXT NOT NULL DEFAULT ''
    );
  `);
  const columns = new Set((db.prepare("PRAGMA table_info(documents)").all() as { name: string }[]).map((c) => c.name));
  if (!columns.has("category")) db.exec("ALTER TABLE documents ADD COLUMN category TEXT NOT NULL DEFAULT ''");
}
