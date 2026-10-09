import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { MESSAGE_CENTER_TYPES } from "@/lib/notification-types";

// GET /api/notifications/unread-count — 当前用户消息中心未读数（侧栏角标轮询）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const db = getDb();
  const placeholders = MESSAGE_CENTER_TYPES.map(() => "?").join(",");
  const row = db.prepare(
    `SELECT COUNT(*) AS count FROM notifications
     WHERE hidden = 0 AND is_read = 0
       AND type IN (${placeholders})
       AND (recipient = ? OR recipient = '')`
  ).get(...MESSAGE_CENTER_TYPES, auth.name) as { count: number };
  return NextResponse.json({ count: row.count });
}
