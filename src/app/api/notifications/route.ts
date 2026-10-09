import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { MESSAGE_CENTER_TYPES } from "@/lib/notification-types";

// GET /api/notifications — 消息中心列表：未读排前面，再按时间倒序；已隐藏的不返回
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "100", 10) || 100));

  const placeholders = MESSAGE_CENTER_TYPES.map(() => "?").join(",");
  const params: any[] = [...MESSAGE_CENTER_TYPES, auth.name];
  const sql = `SELECT * FROM notifications
    WHERE hidden = 0
      AND type IN (${placeholders})
      AND (recipient = ? OR recipient = '')
    ORDER BY is_read ASC, created_at DESC, id DESC
    LIMIT ?`;
  params.push(limit);
  return NextResponse.json(db.prepare(sql).all(...params));
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
