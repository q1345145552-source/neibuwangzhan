import type Database from "better-sqlite3";

/**
 * 客户网站来的单先确认、再办理（2026-10-19 老板拍板：防客户恶意下单；1A 在内部确认、2B 所有员工能点）。
 * 客户下单照旧马上传到内部；没点「确认订单」之前不能开始办理、不能改派、不能发补件或对客公开文件。
 * 确认按客户站订单号记在 sync_order_confirmations，一笔客户订单拆出的几张办理单一起确认。
 * 老单不回填：只有「客户站来的、还是待处理、步骤一步都没动过、没确认过」的单算待确认；
 * 已经办过（步骤动过）、办完、取消的都不算，不会被这条规矩卡住。
 * 本模块不引用 progress-sync（它反过来要用这里判断回传状态），确认时的进度入队由调用方在同一事务里做。
 */

export const AWAITING_CONFIRMATION_ERROR = "这张单客户下单后还没确认，请先点「确认订单」，再继续办理";

/** SQL 条件：别名为 alias 的订单还在等确认。列表一次算完，不逐单查。 */
export function awaitingConfirmationSql(alias = "o"): string {
  return `(${alias}.status = '待处理'
    AND EXISTS (SELECT 1 FROM sync_inbox si WHERE si.internal_order_id = ${alias}.id)
    AND NOT EXISTS (SELECT 1 FROM sync_inbox si JOIN sync_order_confirmations c ON c.source_order_no = si.source_order_no WHERE si.internal_order_id = ${alias}.id)
    AND NOT EXISTS (SELECT 1 FROM order_steps s WHERE s.order_id = ${alias}.id
      AND (s.status <> '待处理' OR s.started_at IS NOT NULL OR s.completed_at IS NOT NULL)))`;
}

export function isAwaitingConfirmation(db: Database.Database, orderId: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM orders o WHERE o.id = ? AND ${awaitingConfirmationSql("o")}`).get(orderId));
}

export interface OrderConfirmation { source_order_no: string; confirmed_by: string; confirmed_at: string }

export function confirmationOf(db: Database.Database, orderId: string): OrderConfirmation | null {
  return (db.prepare(`SELECT c.source_order_no, c.confirmed_by, c.confirmed_at FROM sync_inbox si
    JOIN sync_order_confirmations c ON c.source_order_no = si.source_order_no WHERE si.internal_order_id = ? LIMIT 1`).get(orderId) as OrderConfirmation | undefined) ?? null;
}

export function sourceOrderNoOf(db: Database.Database, orderId: string): string | null {
  return (db.prepare("SELECT source_order_no FROM sync_inbox WHERE internal_order_id = ? ORDER BY line_no, copy_no LIMIT 1").get(orderId) as { source_order_no: string } | undefined)?.source_order_no ?? null;
}

/** 同一笔客户订单拆出的办理单（含自己） */
export function siblingOrderIds(db: Database.Database, sourceOrderNo: string): string[] {
  return (db.prepare(`SELECT DISTINCT internal_order_id AS id FROM sync_inbox
    WHERE source_order_no = ? AND internal_order_id IS NOT NULL AND internal_order_id <> ''`).all(sourceOrderNo) as { id: string }[]).map(r => r.id);
}

/** 记下确认（重复确认不改第一次的人和时间）。须在调用方事务内，紧接着给 siblingOrderIds 入进度事件。 */
export function recordConfirmation(db: Database.Database, sourceOrderNo: string, actor: string): boolean {
  return db.prepare("INSERT OR IGNORE INTO sync_order_confirmations (source_order_no, confirmed_by) VALUES (?, ?)").run(sourceOrderNo, actor).changes > 0;
}
