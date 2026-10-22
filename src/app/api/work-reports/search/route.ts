import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { orderNumberInfoFor } from "@/lib/order-display-no";
import { verifyAuth, isStaff } from "@/lib/auth";

// GET /api/work-reports/search?type=order|todo|issue&q=xxx — 填写日报时搜索可带出的条目（员工也能搜全部）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const type = (searchParams.get("type") || "").trim();
  const q = (searchParams.get("q") || "").trim();
  if (!["order", "todo", "issue"].includes(type)) return NextResponse.json({ error: "类型不对" }, { status: 400 });
  if (!q) return NextResponse.json([]);

  const db = getDb();
  const like = `%${q}%`;

  if (type === "order") {
    // 业务系统来的单也认业务系统单号，标题用同一个号（2026-10-22）
    type Row = { id: string; customer_name: string | null; responsible_person: string | null; business_type_name: string | null };
    const select = `SELECT o.id, o.customer_name, o.responsible_person, b.name AS business_type_name
       FROM orders o LEFT JOIN business_types b ON b.id = o.business_type_id`;
    // 搜的正好是一张业务系统单号：这张单拆出来的几张全列在最前（拆得再多也不漏）
    const exactIds = [...new Set((db.prepare("SELECT internal_order_id AS id FROM sync_inbox WHERE source_order_no = ? COLLATE NOCASE AND internal_order_id IS NOT NULL AND internal_order_id <> '' ORDER BY line_no, copy_no").all(q) as { id: string }[]).map((r) => r.id))];
    const exactRows = exactIds.length
      ? (db.prepare(`${select} WHERE o.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(exactIds)) as Row[]).sort((a, b) => exactIds.indexOf(a.id) - exactIds.indexOf(b.id))
      : [];
    const others = (db.prepare(
      `${select}
       WHERE o.id LIKE ? OR o.customer_name LIKE ?
          OR o.id IN (SELECT internal_order_id FROM sync_inbox WHERE source_order_no LIKE ? AND internal_order_id IS NOT NULL)
       ORDER BY o.created_at DESC LIMIT ?`
    ).all(like, like, like, 20 + exactIds.length) as Row[]).filter((r) => !exactIds.includes(r.id)).slice(0, 20);
    const rows = [...exactRows, ...others];
    const numbers = orderNumberInfoFor(db, rows.map((r) => r.id));
    return NextResponse.json(rows.map((r) => {
      const n = numbers.get(r.id);
      // 一张客户单拆成几张办的，几张单号一样：标题后面带上业务和第几份，选的时候分得清
      const which = n && n.parts > 1 ? `（${r.business_type_name || "待分类"} 第${n.part}份）` : "";
      return {
        type: "order",
        id: r.id,
        title: `订单 ${n?.display || r.id}${which}`,
        subtitle: r.customer_name || "",
        href: `/orders/${r.id}`,
        responsible: r.responsible_person || "",
        businessType: r.business_type_name || "待分类",
      };
    }));
  }

  if (type === "todo") {
    const rows = db.prepare(
      "SELECT id, content, status FROM todos WHERE content LIKE ? ORDER BY id DESC LIMIT 20"
    ).all(like) as any[];
    return NextResponse.json(rows.map((r) => ({
      type: "todo",
      id: String(r.id),
      title: r.content || `待办 ${r.id}`,
      subtitle: r.status || "",
      href: `/todos?todo=${r.id}`,
    })));
  }

  // issue（工单）
  const rows = db.prepare(
    "SELECT id, description, status FROM issue_tickets WHERE description LIKE ? ORDER BY id DESC LIMIT 20"
  ).all(like) as any[];
  return NextResponse.json(rows.map((r) => ({
    type: "issue",
    id: String(r.id),
    title: r.description || `工单 ${r.id}`,
    subtitle: r.status || "",
    href: `/issues?open=${r.id}`,
  })));
}
