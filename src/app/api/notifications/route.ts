import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unread") === "1";
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
  // 通知里含对账明细、请假理由、工单内容等敏感信息：
  // 普通员工强制只能看发给自己的（recipient 参数不可信），管理员才能按人查
  const requested = searchParams.get("recipient");
  const recipient = auth.role === "admin" ? requested : auth.name;

  let sql = "SELECT * FROM notifications WHERE 1=1";
  const params: any[] = [];
  if (recipient) { sql += " AND (recipient = ? OR recipient = '')"; params.push(recipient); }
  if (unreadOnly) { sql += " AND is_read = 0"; }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  return NextResponse.json(db.prepare(sql).all(...params));
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const body = await readJson(req);
  const { id, markAll } = body;
  // 同 GET：普通员工只能操作自己的通知，不接受请求体里的 recipient
  const recipient = auth.role === "admin" && body.recipient ? body.recipient : auth.name;

  if (markAll) {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE recipient = ?").run(recipient);
    return NextResponse.json({ success: true });
  }
  if (id) {
    // 非管理员只能标记发给自己（或全员广播）的那条
    if (auth.role === "admin") {
      db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id);
    } else {
      db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND (recipient = ? OR recipient = '')").run(id, auth.name);
    }
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ error: "缺少参数" }, { status: 400 });
}
