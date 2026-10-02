import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// POST /api/chat/recall — 撤回自己发的消息（两分钟内），一对一和群聊通用
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await readJson(req);
  const messageId = Number(body?.message_id);
  if (!Number.isInteger(messageId) || messageId <= 0) return NextResponse.json({ error: "缺少消息" }, { status: 400 });

  const msg = db.prepare("SELECT id, sender, recalled, created_at FROM messages WHERE id = ?").get(messageId) as
    { id: number; sender: string; recalled: number; created_at: string } | undefined;
  if (!msg) return NextResponse.json({ error: "消息不存在" }, { status: 404 });
  if (msg.sender !== auth.name) return NextResponse.json({ error: "只能撤回自己发的消息" }, { status: 403 });
  if (msg.recalled === 1) return NextResponse.json({ error: "消息已撤回" }, { status: 400 });

  // 两分钟内才能撤回（created_at 为 UTC，datetime('now') 也是 UTC）
  const within2 = db.prepare(
    "SELECT id FROM messages WHERE id = ? AND created_at >= datetime('now', '-2 minutes')"
  ).get(messageId);
  if (!within2) return NextResponse.json({ error: "超过两分钟，无法撤回" }, { status: 400 });

  db.prepare("UPDATE messages SET recalled = 1 WHERE id = ?").run(messageId);
  return NextResponse.json({ success: true });
}
