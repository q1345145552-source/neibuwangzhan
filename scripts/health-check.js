#!/usr/bin/env node
// 数据库完整性健康检查
// 用法: node scripts/health-check.js
// 建议 cron: 0 6 * * * cd /path/to/project && node scripts/health-check.js

const Database = require("better-sqlite3");
const fs = require("fs");

const { databasePath: DB_PATH } = require("../src/lib/runtime-config.cjs");
const { preflight } = require("../src/lib/database-policy.cjs");

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

try {
  preflight(DB_PATH, "internal", false);
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

  // 1. 完整性检查
  const integrity = db.pragma("integrity_check");
  const ok = integrity.every((row) => row.integrity_check === "ok");
  log(ok ? "✅ integrity_check: pass" : `❌ integrity_check: ${JSON.stringify(integrity)}`);

  // 2. Observe WAL size only; health checks never checkpoint/truncate a live source.
  const walPath = `${DB_PATH}-wal`;
  log(`WAL bytes: ${fs.existsSync(walPath) ? fs.statSync(walPath).size : 0}`);

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
