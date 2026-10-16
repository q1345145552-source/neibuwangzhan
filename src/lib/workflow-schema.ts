import type Database from "better-sqlite3";

/**
 * 流程设置第 2 期（2026-10-16 老板「开始做」）：把写在程序里的办理流程搬进数据库。
 * 只加不删：新表都是「没有才建」，order_steps 只加两列可以为空的新列，老数据一行不动。
 *
 * - workflow_templates：一套流程。legacy_signature = 导入时程序里这套流程的指纹（步骤名、经办人、资料、备注），
 *   建单时按指纹认（几种子服务共用同一套流程的，自然共用一条）。程序里的流程以后被改了、指纹对不上，就照旧用程序里的。
 * - workflow_template_versions：每次发布一个版本，可以退回旧版本；current_version_id 指向正在用的版本。
 * - workflow_template_steps：某个版本的步骤。这一期步骤名和顺序不能改（客户看到的步骤名、商城下单都按名字核对），
 *   只开放默认经办人、预计天数、备注、所需文件。
 * - reminder_log：提醒去重（证书到期、步骤超时），同一件事只提醒一次。
 * - order_steps.expected_days / template_version_id：建单时把当时的预计天数和流程版本记下来。
 *   超时在查询时现场按工作日算，不写 order_steps.deadline（一写积分就会开始扣分，老板定了先不开）。
 */
export function ensureWorkflowSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      legacy_signature TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      current_version_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workflow_template_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES workflow_templates(id),
      version INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      published_by TEXT NOT NULL DEFAULT '',
      published_at TEXT DEFAULT (datetime('now')),
      UNIQUE(template_id, version)
    );
    CREATE TABLE IF NOT EXISTS workflow_template_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES workflow_template_versions(id),
      step_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      assignee TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      docs_json TEXT NOT NULL DEFAULT '[]',
      expected_days REAL,
      UNIQUE(version_id, step_order)
    );
    CREATE TABLE IF NOT EXISTS reminder_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(kind, ref)
    );
  `);
  const columns = new Set((db.prepare("PRAGMA table_info(order_steps)").all() as { name: string }[]).map((c) => c.name));
  if (!columns.has("expected_days")) db.exec("ALTER TABLE order_steps ADD COLUMN expected_days REAL");
  if (!columns.has("template_version_id")) db.exec("ALTER TABLE order_steps ADD COLUMN template_version_id INTEGER");
}
