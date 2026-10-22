import type Database from "better-sqlite3";

/**
 * 订单显示编号（2026-10-22 老板：「要显示同一个号，要不然业务系统的订单我怎么去内部系统去查」）。
 * 业务系统来的单显示业务系统的单号；一张客户单拆成几张办的，按第几行商品、第几份的顺序加 -1、-2……
 * （行和份数建单后不会再变，号码稳定）。内部自己建的单照旧显示内部编号。只改显示，数据库里的编号不变。
 */
type Row = { source_order_no: string; internal_order_id: string };

function number(rows: Row[], into: Map<string, string>) {
  const bySource = new Map<string, string[]>();
  for (const r of rows) {
    const list = bySource.get(r.source_order_no) ?? [];
    if (!list.includes(r.internal_order_id)) list.push(r.internal_order_id);
    bySource.set(r.source_order_no, list);
  }
  for (const [source, ids] of bySource) ids.forEach((id, i) => { if (!into.has(id)) into.set(id, ids.length > 1 ? `${source}-${i + 1}` : source); });
}

/** 全部业务系统来的单：内部编号 → 显示编号 */
export function orderDisplayNumbers(db: Database.Database): Map<string, string> {
  const out = new Map<string, string>();
  number(db.prepare("SELECT source_order_no, internal_order_id FROM sync_inbox WHERE internal_order_id IS NOT NULL AND internal_order_id <> '' ORDER BY source_order_no, line_no, copy_no").all() as Row[], out);
  return out;
}

/** 一张单的显示编号；不是业务系统来的返回内部编号 */
export function orderDisplayNumber(db: Database.Database, id: string): string {
  const source = db.prepare("SELECT source_order_no FROM sync_inbox WHERE internal_order_id = ? ORDER BY line_no, copy_no LIMIT 1").get(id) as { source_order_no: string } | undefined;
  if (!source) return id;
  const out = new Map<string, string>();
  number(db.prepare("SELECT source_order_no, internal_order_id FROM sync_inbox WHERE source_order_no = ? AND internal_order_id IS NOT NULL AND internal_order_id <> '' ORDER BY line_no, copy_no").all(source.source_order_no) as Row[], out);
  return out.get(id) ?? id;
}
