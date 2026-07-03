#!/usr/bin/env node
// 数据库完整性健康检查
// 用法: node scripts/health-check.js
// 建议 cron: 0 6 * * * cd /path/to/project && node scripts/health-check.js

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data.db");

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

try {
  const db = new Database(DB_PATH, { readonly: true });

  // 1. 完整性检查
  const integrity = db.pragma("integrity_check");
  const ok = integrity.every((row) => row.integrity_check === "ok");
  log(ok ? "✅ integrity_check: pass" : `❌ integrity_check: ${JSON.stringify(integrity)}`);

  // 2. WAL 状态（checkpoint 在读锁下可能报 I/O 错，忽略）
  try {
    const walSize = db.pragma("wal_checkpoint(TRUNCATE)");
    log(`WAL checkpoint: ${JSON.stringify(walSize)}`);
  } catch (wcErr) {
    log(`WAL checkpoint skipped (DB in use): ${wcErr.message}`);
  }

  // 3. 表行数摘要
  const tables = ["orders", "order_steps", "finances", "documents", "certificates", "employees", "audit_logs", "business_types"];
  for (const t of tables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${t}`).get();
      log(`  ${t}: ${row.cnt} 行`);
    } catch {}
  }

  // 4. 业务线分布
  const biz = db.prepare("SELECT bt.name, COUNT(*) as cnt FROM orders o JOIN business_types bt ON o.business_type_id = bt.id GROUP BY bt.name ORDER BY cnt DESC").all();
  log("业务线订单分布:");
  biz.forEach((r) => log(`  ${r.name}: ${r.cnt}`));

  db.close();
  log("健康检查完成");

  if (!ok) process.exit(1);
} catch (err) {
  log(`❌ 健康检查失败: ${err.message}`);
  process.exit(1);
}
