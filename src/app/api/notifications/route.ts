import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { messageCenterFilter } from "@/lib/notification-types";

// GET /api/notifications — 消息中心列表：未读排前面，再按时间倒序；已隐藏的不返回
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "100", 10) || 100));

  const filter = messageCenterFilter();
  const sql = `SELECT * FROM notifications
    WHERE hidden = 0
      AND ${filter.sql}
      AND (recipient = ? OR recipient = '')
    ORDER BY is_read ASC, created_at DESC, id DESC
    LIMIT ?`;
  const rows = db.prepare(sql).all(...filter.params, auth.name, limit) as { related_type: string; related_id: string }[];

  // 客户站订单提醒的 related_id 有的是内部办理单号，有的是客户站单号：统一换成内部办理单号，点开能直接进订单
  const byId = db.prepare("SELECT id FROM orders WHERE id = ?");
  const bySource = db.prepare(
    "SELECT internal_order_id FROM sync_inbox WHERE source_order_no = ? AND internal_order_id IS NOT NULL AND internal_order_id <> '' ORDER BY line_no, copy_no LIMIT 1"
  );
  const withOrder = rows.map((n) => {
    if (n.related_type !== "order" || !n.related_id) return n;
    const own = byId.get(n.related_id) as { id: string } | undefined;
    const synced = own ? undefined : (bySource.get(n.related_id) as { internal_order_id: string } | undefined);
    return { ...n, order_id: own?.id || synced?.internal_order_id || null };
  });
  return NextResponse.json(withOrder);
}

// PATCH /api/notifications — 标记已读 / 隐藏 / 全部已读
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { id, markAll, hide } = body;
  const recipient = auth.role === "admin" && body.recipient ? body.recipient : auth.name;

  if (markAll) {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE recipient = ?").run(recipient);
    return NextResponse.json({ success: true });
  }
  if (id) {
    const setClause = hide ? "hidden = 1" : "is_read = 1";
    if (auth.role === "admin") {
      db.prepare(`UPDATE notifications SET ${setClause} WHERE id = ?`).run(id);
    } else {
      db.prepare(`UPDATE notifications SET ${setClause} WHERE id = ? AND (recipient = ? OR recipient = '')`).run(id, auth.name);
    }
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ error: "缺少参数" }, { status: 400 });
}
