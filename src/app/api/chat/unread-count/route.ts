import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

// GET /api/chat/unread-count — 当前用户未读的一对一消息数（侧栏「消息」角标）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  // 群聊消息的 receiver 是群名，且没有按成员做的已读回执，所以只统计一对一（group_id IS NULL）
  const { c } = db.prepare(
    "SELECT COUNT(*) AS c FROM messages WHERE receiver = ? AND is_read = 0 AND group_id IS NULL"
  ).get(auth.name) as { c: number };

  return NextResponse.json({ count: c });
}
