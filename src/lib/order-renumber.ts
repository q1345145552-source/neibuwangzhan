import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { uploadsDir } from "./uploads";

/**
 * 把一张办理单的编号整个换成新编号（线下单推到业务系统时用，2026-10-22 老板「单号必须要对上」「单号不要-」）。
 * 做法同上线时改老单的 scripts/migrate-order-id-to-source-no.py：所有表、所有文字字段里出现的旧编号一起换
 * （步骤、文档、费用、通知链接、聊天卡片、积分原因、操作记录……），换完自查旧编号一处不剩、外键不比换之前差。
 * 必须在调用方的事务里调用；外键检查推迟到事务提交，任何一步不对整个事务撤回。
 */
export const SAFE_ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

function quote(name: string) { return `"${name.replace(/"/g, '""')}"`; }

function tablesWithColumns(db: Database.Database): { table: string; columns: string[] }[] {
  const tables = (db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string; sql: string | null }[])
    .filter(t => !(t.sql || "").toUpperCase().startsWith("CREATE VIRTUAL"));
  return tables.map(t => ({ table: t.name, columns: (db.prepare(`PRAGMA table_info(${quote(t.name)})`).all() as { name: string }[]).map(c => c.name) }))
    .filter(t => t.columns.length > 0);
}

/** 这一列是文字、而且含旧编号（数字列不碰，免得被 replace 变成文字） */
const holds = (column: string) => `(typeof(${quote(column)}) = 'text' AND instr(${quote(column)}, ?) > 0)`;

/** 上传的文件名、目录名里带旧编号的，改了数据库就找不到文件：这种不改。两个上传目录都查（数据目录写不了时上传会落到临时目录） */
export function uploadNamesContaining(oldId: string, dirs: string[] = [uploadsDir, path.join(os.tmpdir(), "xiangtai-uploads")]): string | null {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length) {
      const current = stack.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.name.includes(oldId)) return full;
        if (entry.isDirectory()) stack.push(full);
      }
    }
  }
  return null;
}

export function renumberOrder(db: Database.Database, oldId: string, newId: string): Record<string, number> {
  if (!db.inTransaction) throw new Error("改编号必须在事务里做");
  if (!SAFE_ORDER_ID.test(oldId) || !SAFE_ORDER_ID.test(newId) || oldId === newId) throw new Error("编号不对，没法改");
  // 新编号里带着旧编号的话，换完自查永远会找到旧编号；两种格式不会出现这种情况，碰到直接停
  if (newId.includes(oldId)) throw new Error("新编号包含旧编号，没法改");
  if (!db.prepare("SELECT 1 FROM orders WHERE id = ?").get(oldId)) throw new Error(`办理单 ${oldId} 不存在`);
  if (db.prepare("SELECT 1 FROM orders WHERE id = ?").get(newId)) throw new Error(`编号 ${newId} 已经被别的办理单用了`);
  // 外键只核对指向订单的那几张表（编号只出现在订单和挂在订单下的记录里），不做整库检查，免得推单时整个网站等太久
  const tables = tablesWithColumns(db);
  const childTables = tables.map(t => t.table).filter(t => (db.prepare(`PRAGMA foreign_key_list(${quote(t)})`).all() as { table: string }[]).some(fk => fk.table === "orders"));
  const fkCheck = () => new Set(childTables.flatMap(t => (db.prepare(`PRAGMA foreign_key_check(${quote(t)})`).all() as unknown[]).map(r => JSON.stringify(r))));
  const fkBefore = fkCheck();
  db.pragma("defer_foreign_keys = ON");
  // 每张表只扫一遍（员工点推送时整个网站要等它做完，库大了按列逐个扫会卡好几秒）
  const changed: Record<string, number> = {};
  for (const { table, columns } of tables) {
    const set = columns.map(c => `${quote(c)} = CASE WHEN ${holds(c)} THEN replace(${quote(c)}, ?, ?) ELSE ${quote(c)} END`).join(", ");
    const where = columns.map(holds).join(" OR ");
    const result = db.prepare(`UPDATE ${quote(table)} SET ${set} WHERE ${where}`)
      .run(...columns.flatMap(() => [oldId, oldId, newId]), ...columns.map(() => oldId));
    if (result.changes) changed[table] = result.changes;
  }
  for (const { table, columns } of tables) {
    const left = db.prepare(`SELECT count(*) AS n FROM ${quote(table)} WHERE ${columns.map(holds).join(" OR ")}`).get(...columns.map(() => oldId)) as { n: number };
    if (left.n) throw new Error(`换完 ${table} 还有 ${left.n} 行带旧编号`);
  }
  if (!db.prepare("SELECT 1 FROM orders WHERE id = ?").get(newId)) throw new Error(`办理单 ${newId} 没换上`);
  const fkNew = [...fkCheck()].filter(r => !fkBefore.has(r));
  if (fkNew.length) throw new Error(`外键检查多出 ${fkNew.length} 条问题`);
  return changed;
}
