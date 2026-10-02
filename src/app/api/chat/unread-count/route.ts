import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

// GET /api/chat/unread-count — 当前用户未读的一对一消息数 + 群聊 @提醒数（侧栏「消息」角标）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  // 一对一未读消息数（群聊消息 receiver 是群名，不计入）
  const { c } = db.prepare(
    "SELECT COUNT(*) AS c FROM messages WHERE receiver = ? AND is_read = 0 AND group_id IS NULL"
  ).get(auth.name) as { c: number };

  // 群聊里有人 @ 我、我还没看的提醒数
  const { m } = db.prepare(
    "SELECT COUNT(*) AS m FROM message_mentions WHERE member = ? AND is_read = 0"
  ).get(auth.name) as { m: number };

  return NextResponse.json({ count: c + m });
}
