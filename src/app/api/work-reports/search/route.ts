import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { orderNumberInfo } from "@/lib/order-display-no";
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
    // 业务系统来的单也认业务系统单号（列表里显示的 ORD…-1 这种，去掉后面的 -几 再找），标题用同一个号（2026-10-22）
    const sourceLike = `%${q.replace(/-\d+$/, "")}%`;
    const rows = db.prepare(
      `SELECT o.id, o.customer_name, o.responsible_person, b.name AS business_type_name
       FROM orders o LEFT JOIN business_types b ON b.id = o.business_type_id
       WHERE o.id LIKE ? OR o.customer_name LIKE ?
          OR o.id IN (SELECT internal_order_id FROM sync_inbox WHERE source_order_no LIKE ? AND internal_order_id IS NOT NULL)
       ORDER BY o.created_at DESC LIMIT 20`
    ).all(like, like, sourceLike) as any[];
    const numbers = orderNumberInfo(db);
    return NextResponse.json(rows.map((r) => ({
      type: "order",
      id: String(r.id),
      title: `订单 ${numbers.get(String(r.id))?.display || r.id}`,
      subtitle: r.customer_name || "",
      href: `/orders/${r.id}`,
      responsible: r.responsible_person || "",
      businessType: r.business_type_name || "待分类",
    })));
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
