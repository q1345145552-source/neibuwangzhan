import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { translateText } from "@/lib/deepseek";

// POST /api/chat/translate — 翻译一条消息（body: { message_id, target }，target 仅「中文」「泰语」）
// 翻译结果按 消息+目标语言 缓存，同一条重复点直接返回缓存。
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const body = await readJson(req);
  const messageId = Number(body?.message_id);
  const target = String(body?.target || "").trim();
  if (!Number.isInteger(messageId) || messageId <= 0) return NextResponse.json({ error: "缺少消息" }, { status: 400 });
  if (target !== "中文" && target !== "泰语") return NextResponse.json({ error: "只支持翻译成中文或泰语" }, { status: 400 });

  const db = getDb();
  const msg = db.prepare(
    "SELECT id, conversation_id, group_id, sender, content, image_url, order_id, recalled FROM messages WHERE id = ?"
  ).get(messageId) as
    { id: number; conversation_id: number | null; group_id: number | null; sender: string; content: string; image_url: string; order_id: string; recalled: number } | undefined;
  if (!msg) return NextResponse.json({ error: "消息不存在" }, { status: 404 });
  if (msg.recalled) return NextResponse.json({ error: "消息已撤回" }, { status: 400 });
  if (msg.image_url || msg.order_id) return NextResponse.json({ error: "该消息无可翻译的文字" }, { status: 400 });

  const text = (msg.content || "").trim();
  if (!text) return NextResponse.json({ error: "该消息没有文字内容" }, { status: 400 });

  // 权限：1:1 双方之一 / 群成员
  if (msg.conversation_id != null) {
    const conv = db.prepare("SELECT user_a, user_b FROM conversations WHERE id = ?").get(msg.conversation_id) as
      { user_a: string; user_b: string } | undefined;
    if (!conv || (conv.user_a !== auth.name && conv.user_b !== auth.name)) {
      return NextResponse.json({ error: "无权查看该消息" }, { status: 403 });
    }
  } else if (msg.group_id != null) {
    const member = db.prepare("SELECT id FROM group_members WHERE group_id = ? AND member = ?").get(msg.group_id, auth.name);
    if (!member) return NextResponse.json({ error: "无权查看该消息" }, { status: 403 });
  } else {
    return NextResponse.json({ error: "消息数据异常" }, { status: 400 });
  }

  // 缓存命中
  const cached = db.prepare(
    "SELECT translated FROM message_translations WHERE message_id = ? AND target = ?"
  ).get(messageId, target) as { translated: string } | undefined;
  if (cached) {
    return NextResponse.json({ translated: cached.translated, cached: true });
  }

  let translated: string;
  try {
    translated = await translateText(text, target as "中文" | "泰语");
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "翻译失败" }, { status: 502 });
  }

  db.prepare(
    "INSERT OR IGNORE INTO message_translations (message_id, target, translated) VALUES (?, ?, ?)"
  ).run(messageId, target, translated);

  return NextResponse.json({ translated, cached: false });
}
