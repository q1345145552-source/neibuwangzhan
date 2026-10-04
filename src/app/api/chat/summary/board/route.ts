import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { summarizeChatTranscript } from "@/lib/deepseek";

type Db = ReturnType<typeof getDb>;

// 整段会话总结用空时间段作为缓存 key，和「按时间段总结」区分开
const ALL_FROM = "";
const ALL_TO = "";

function formatMessage(m: { sender: string; content: string; image_url: string; order_id: string; created_at: string }): string {
  const sender = m.sender || "?";
  const time = (m.created_at || "").slice(11, 16);
  const ts = time ? ` ${time}` : "";
  if (m.image_url) return `${sender}${ts}: [图片]`;
  if (m.order_id) {
    try {
      const c = JSON.parse(m.content || "{}");
      const title = typeof c.title === "string" ? c.title : "";
      const subtitle = typeof c.subtitle === "string" ? c.subtitle : "";
      if (title) return `${sender}${ts}: [卡片] ${title}${subtitle ? `（${subtitle}）` : ""}`;
    } catch { /* 旧数据容错 */ }
    return `${sender}${ts}: [卡片] ${m.order_id}${m.content ? ` ${m.content}` : ""}`;
  }
  return `${sender}${ts}: ${m.content || ""}`;
}

// 所有有消息的 1:1 会话
function listConversations(db: Db) {
  return db.prepare(`
    SELECT c.id, c.user_a, c.user_b,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
    FROM conversations c
    WHERE (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) > 0
    ORDER BY c.last_message_at DESC
  `).all() as { id: number; user_a: string; user_b: string; message_count: number }[];
}

function getCached(db: Db, id: number) {
  return db.prepare(
    "SELECT topics, conclusions, todos, commitments FROM chat_summaries WHERE scope_key = ? AND from_at = ? AND to_at = ?"
  ).get(`conversation:${id}`, ALL_FROM, ALL_TO) as
    { topics: string; conclusions: string; todos: string; commitments: string } | undefined;
}

// GET /api/chat/summary/board — 返回已生成的整段会话总结（缓存，不调大模型）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const result: Record<string, unknown>[] = [];
  for (const c of listConversations(db)) {
    const s = getCached(db, c.id);
    if (s) {
      result.push({ conversation_id: c.id, user_a: c.user_a, user_b: c.user_b, message_count: c.message_count, ...s, cached: true });
    }
  }
  return NextResponse.json(result);
}

// POST /api/chat/summary/board — 批量生成：未缓存的会话才调大模型，已缓存的直接复用
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const result: Record<string, unknown>[] = [];

  try {
    for (const c of listConversations(db)) {
      let s = getCached(db, c.id);
      let cached = true;
      if (!s) {
        const messages = db.prepare(
          "SELECT sender, content, image_url, order_id, created_at FROM messages WHERE conversation_id = ? AND recalled = 0 ORDER BY id ASC"
        ).all(c.id) as { sender: string; content: string; image_url: string; order_id: string; created_at: string }[];
        if (messages.length === 0) continue;
        const transcript = messages.map(formatMessage).join("\n");
        s = await summarizeChatTranscript(transcript);
        db.prepare(
          "INSERT OR IGNORE INTO chat_summaries (scope_key, from_at, to_at, topics, conclusions, todos, commitments) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(`conversation:${c.id}`, ALL_FROM, ALL_TO, s.topics, s.conclusions, s.todos, s.commitments);
        cached = false;
      }
      result.push({ conversation_id: c.id, user_a: c.user_a, user_b: c.user_b, message_count: c.message_count, ...s, cached });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "批量总结失败" }, { status: 502 });
  }

  return NextResponse.json(result);
}
