import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// 允许的表情：赞 / 爱心 / 大笑
const ALLOWED_EMOJIS = ["👍", "❤️", "😂"];

// 某条消息的所有反应，按表情分组：[{ emoji, users: [...] }]
function getMessageReactions(db: ReturnType<typeof getDb>, messageId: number) {
  const rows = db.prepare(
    "SELECT emoji, user_name FROM message_reactions WHERE message_id = ? ORDER BY id ASC"
  ).all(messageId) as { emoji: string; user_name: string }[];
  const map = new Map<string, string[]>();
  for (const r of rows) {
    if (!map.has(r.emoji)) map.set(r.emoji, []);
    map.get(r.emoji)!.push(r.user_name);
  }
  return [...map.entries()].map(([emoji, users]) => ({ emoji, users }));
}

// GET /api/chat/reactions?conversation_id=X | group_id=X — 该会话/群内所有消息的反应（按 message_id 分组）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const conversationId = Number(searchParams.get("conversation_id")) || 0;
  const groupId = Number(searchParams.get("group_id")) || 0;
  if (!conversationId && !groupId) {
    return NextResponse.json({ error: "请提供 conversation_id 或 group_id" }, { status: 400 });
  }

  const db = getDb();
  // 权限：1:1 双方之一 / 群成员
  if (conversationId) {
    const conv = db.prepare("SELECT user_a, user_b FROM conversations WHERE id = ?").get(conversationId) as
      { user_a: string; user_b: string } | undefined;
    if (!conv || (conv.user_a !== auth.name && conv.user_b !== auth.name)) {
      return NextResponse.json({ error: "无权访问该会话" }, { status: 403 });
    }
  } else {
    const member = db.prepare("SELECT id FROM group_members WHERE group_id = ? AND member = ?").get(groupId, auth.name);
    if (!member) return NextResponse.json({ error: "你不是该群成员" }, { status: 403 });
  }

  const rows = conversationId
    ? db.prepare(`
        SELECT mr.message_id, mr.emoji, mr.user_name
        FROM message_reactions mr
        JOIN messages m ON m.id = mr.message_id
        WHERE m.conversation_id = ?
        ORDER BY mr.id ASC
      `).all(conversationId)
    : db.prepare(`
        SELECT mr.message_id, mr.emoji, mr.user_name
        FROM message_reactions mr
        JOIN messages m ON m.id = mr.message_id
        WHERE m.group_id = ?
        ORDER BY mr.id ASC
      `).all(groupId);

  const grouped: Record<string, { emoji: string; users: string[] }[]> = {};
  for (const r of rows as { message_id: number; emoji: string; user_name: string }[]) {
    const key = String(r.message_id);
    if (!grouped[key]) grouped[key] = [];
    let g = grouped[key].find((x) => x.emoji === r.emoji);
    if (!g) { g = { emoji: r.emoji, users: [] }; grouped[key].push(g); }
    g.users.push(r.user_name);
  }
  return NextResponse.json({ reactions: grouped });
}

// POST /api/chat/reactions — 切换表情反应（body: { message_id, emoji }），同一表情点一下加、再点取消
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const body = await readJson(req);
  const messageId = Number(body?.message_id);
  const emoji = String(body?.emoji || "");
  if (!Number.isInteger(messageId) || messageId <= 0) return NextResponse.json({ error: "缺少消息" }, { status: 400 });
  if (!ALLOWED_EMOJIS.includes(emoji)) return NextResponse.json({ error: "不支持的表情" }, { status: 400 });

  const db = getDb();
  const msg = db.prepare("SELECT id, conversation_id, group_id FROM messages WHERE id = ?").get(messageId) as
    { id: number; conversation_id: number | null; group_id: number | null } | undefined;
  if (!msg) return NextResponse.json({ error: "消息不存在" }, { status: 404 });

  // 权限：1:1 双方之一 / 群成员
  if (msg.conversation_id != null) {
    const conv = db.prepare("SELECT user_a, user_b FROM conversations WHERE id = ?").get(msg.conversation_id) as
      { user_a: string; user_b: string } | undefined;
    if (!conv || (conv.user_a !== auth.name && conv.user_b !== auth.name)) {
      return NextResponse.json({ error: "无权操作该消息" }, { status: 403 });
    }
  } else if (msg.group_id != null) {
    const member = db.prepare("SELECT id FROM group_members WHERE group_id = ? AND member = ?").get(msg.group_id, auth.name);
    if (!member) return NextResponse.json({ error: "无权操作该消息" }, { status: 403 });
  } else {
    return NextResponse.json({ error: "消息数据异常" }, { status: 400 });
  }

  const existing = db.prepare(
    "SELECT id FROM message_reactions WHERE message_id = ? AND user_name = ? AND emoji = ?"
  ).get(messageId, auth.name, emoji) as { id: number } | undefined;
  if (existing) {
    db.prepare("DELETE FROM message_reactions WHERE id = ?").run(existing.id);
  } else {
    db.prepare("INSERT INTO message_reactions (message_id, user_name, emoji) VALUES (?, ?, ?)").run(messageId, auth.name, emoji);
  }

  return NextResponse.json({ message_id: messageId, reactions: getMessageReactions(db, messageId) });
}
