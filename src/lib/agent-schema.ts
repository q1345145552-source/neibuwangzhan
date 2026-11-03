import type Database from "better-sqlite3";

/**
 * 代理记账（2026-11-03）。只加新表，不改 orders（orders 接口有 SELECT *，加进去会漏给员工）。不加外键，代码里校验。
 * - agents：代理账号的内部记录，账号本身和密码在业务系统（users 表 role='agent'），这里不存密码。
 * - agent_rebates：一张内部单最多一笔返点；order_id 是内部单编号，推单改号时 renumberOrder 扫文字列会跟着换。
 *   rebate_cents 空 = 员工挂了代理、管理员还没填返点，这时代理看不到这张单。
 *   返点状态不存快照，读取时按 orders.status 算（见 agents.ts）。
 */
export function ensureAgentSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      account_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      login TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS agent_rebates (
      order_id TEXT PRIMARY KEY,
      agent_account_id TEXT NOT NULL,
      rebate_cents INTEGER CHECK(rebate_cents > 0),
      paid_at TEXT,
      paid_by TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_rebates_agent ON agent_rebates(agent_account_id);
  `);
}
