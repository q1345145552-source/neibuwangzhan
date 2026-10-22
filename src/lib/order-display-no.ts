import type Database from "better-sqlite3";

/**
 * 订单显示编号（2026-10-22 老板：「要显示同一个号」「单号必须要对上」「单号不要-」）。
 * 业务系统来的单显示业务系统的单号，一模一样、不加后缀；一张客户单拆成几张办的，几张都显示同一个号（靠业务、商品区分）。
 * 一张对一张的单，内部编号本身就是业务系统单号（新单建单时直接用，老单上线时改，见 scripts/migrate-order-id-to-source-no.py）；
 * 这里兜底拆单和还没改的老单。内部自己建的单照旧显示内部编号。
 */
type Row = { source_order_no: string; internal_order_id: string };
export type OrderNumberInfo = { source: string; display: string };

function number(rows: Row[], into: Map<string, OrderNumberInfo>) {
  const bySource = new Map<string, Set<string>>();
  for (const r of rows) {
    const ids = bySource.get(r.source_order_no) ?? new Set<string>();
    ids.add(r.internal_order_id);
    bySource.set(r.source_order_no, ids);
  }
  for (const [source, set] of bySource) {
    const ids = [...set];
    ids.forEach((id) => { if (!into.has(id)) into.set(id, { source, display: source }); });
  }
}

/** 全部业务系统来的单：内部编号 → 来源单号和显示编号（一次读完，订单列表、日报搜订单用） */
export function orderNumberInfo(db: Database.Database): Map<string, OrderNumberInfo> {
  const out = new Map<string, OrderNumberInfo>();
  number(db.prepare("SELECT source_order_no, internal_order_id FROM sync_inbox WHERE internal_order_id IS NOT NULL AND internal_order_id <> '' ORDER BY source_order_no, line_no, copy_no").all() as Row[], out);
  return out;
}

/** 只算这几张单的显示编号（同一笔客户单的兄弟单一起读，编号才对得上），搜索这种只取几十条的地方用 */
export function orderNumberInfoFor(db: Database.Database, ids: string[]): Map<string, OrderNumberInfo> {
  const out = new Map<string, OrderNumberInfo>();
  if (!ids.length) return out;
  number(db.prepare(`SELECT source_order_no, internal_order_id FROM sync_inbox
    WHERE internal_order_id IS NOT NULL AND internal_order_id <> ''
      AND source_order_no IN (SELECT source_order_no FROM sync_inbox WHERE internal_order_id IN (SELECT value FROM json_each(?)))
    ORDER BY source_order_no, line_no, copy_no`).all(JSON.stringify(ids)) as Row[], out);
  return out;
}

/** 一张单的显示编号；不是业务系统来的返回内部编号 */
export function orderDisplayNumber(db: Database.Database, id: string): string {
  const source = db.prepare("SELECT source_order_no FROM sync_inbox WHERE internal_order_id = ? ORDER BY line_no, copy_no LIMIT 1").get(id) as { source_order_no: string } | undefined;
  if (!source) return id;
  const out = new Map<string, OrderNumberInfo>();
  number(db.prepare("SELECT source_order_no, internal_order_id FROM sync_inbox WHERE source_order_no = ? AND internal_order_id IS NOT NULL AND internal_order_id <> '' ORDER BY line_no, copy_no").all(source.source_order_no) as Row[], out);
  return out.get(id)?.display ?? id;
}
