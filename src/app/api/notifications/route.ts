import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const recipient = searchParams.get("recipient");
  const unreadOnly = searchParams.get("unread") === "1";
  const limit = parseInt(searchParams.get("limit") || "50");

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
  const body = await req.json();
  const { id, markAll, recipient } = body;

  if (markAll && recipient) {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE recipient = ?").run(recipient);
    return NextResponse.json({ success: true });
  }
  if (id) {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id);
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ error: "缺少参数" }, { status: 400 });
}
