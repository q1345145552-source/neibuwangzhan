import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { summarizeChatTranscript } from "@/lib/deepseek";

// 把一条消息格式化成给大模型看的纯文本（图片/卡片只留占位，不塞 URL）
function formatMessage(m: {
  sender: string;
  content: string;
  image_url: string;
  order_id: string;
  created_at: string;
}): string {
  const sender = m.sender || "?";
  const time = (m.created_at || "").slice(11, 16);
  const ts = time ? ` ${time}` : "";
  if (m.image_url) return `${sender}${ts}: [图片]`;
  if (m.order_id) {
    // 分享卡片：content 是 JSON{title,subtitle}（旧订单卡片则是客户名）
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

// GET /api/chat/summary?conversation_id=X | group_id=X — 该会话的历史总结列表（按生成时间倒序）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const conversationId = Number(searchParams.get("conversation_id")) || 0;
  const groupId = Number(searchParams.get("group_id")) || 0;
  if ((conversationId && groupId) || (!conversationId && !groupId)) {
    return NextResponse.json({ error: "请提供 conversation_id 或 group_id（二选一）" }, { status: 400 });
  }

  const db = getDb();
  let scopeKey: string;
  if (conversationId) {
    const conv = db.prepare("SELECT user_a, user_b FROM conversations WHERE id = ?").get(conversationId) as
      { user_a: string; user_b: string } | undefined;
    if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    if (conv.user_a !== auth.name && conv.user_b !== auth.name) {
      return NextResponse.json({ error: "无权访问该会话" }, { status: 403 });
    }
    scopeKey = `conversation:${conversationId}`;
  } else {
    const member = db.prepare("SELECT id FROM group_members WHERE group_id = ? AND member = ?").get(groupId, auth.name);
    if (!member) return NextResponse.json({ error: "你不是该群成员" }, { status: 403 });
    scopeKey = `group:${groupId}`;
  }

  const rows = db.prepare(
    "SELECT id, from_at, to_at, topics, conclusions, todos, commitments, created_at FROM chat_summaries WHERE scope_key = ? ORDER BY created_at DESC, id DESC"
  ).all(scopeKey);
  return NextResponse.json(rows);
}

// POST /api/chat/summary — 总结一段聊天记录（body: { conversation_id | group_id, from, to }）
// 返回四块：topics / conclusions / todos / commitments；同会话同时间段命中缓存直接返回。
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const body = await readJson(req);
  const conversationId = body?.conversation_id ? Number(body.conversation_id) : 0;
  const groupId = body?.group_id ? Number(body.group_id) : 0;
  const from = String(body?.from || "").trim();
  const to = String(body?.to || "").trim();

  if (!from || !to) return NextResponse.json({ error: "请提供 from 和 to 时间段" }, { status: 400 });
  if ((conversationId && groupId) || (!conversationId && !groupId)) {
    return NextResponse.json({ error: "请提供 conversation_id 或 group_id（二选一）" }, { status: 400 });
  }

  const db = getDb();

  // 校验权限 + 确定缓存作用域 key
  let scopeKey: string;
  if (conversationId) {
    const conv = db.prepare("SELECT user_a, user_b FROM conversations WHERE id = ?").get(conversationId) as
      { user_a: string; user_b: string } | undefined;
    if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    if (conv.user_a !== auth.name && conv.user_b !== auth.name) {
      return NextResponse.json({ error: "无权访问该会话" }, { status: 403 });
    }
    scopeKey = `conversation:${conversationId}`;
  } else {
    const member = db.prepare("SELECT id FROM group_members WHERE group_id = ? AND member = ?").get(groupId, auth.name);
    if (!member) return NextResponse.json({ error: "你不是该群成员" }, { status: 403 });
    scopeKey = `group:${groupId}`;
  }

  // 缓存命中：同会话 + 同时间段直接返回，不再调大模型
  const cached = db.prepare(
    "SELECT topics, conclusions, todos, commitments, created_at FROM chat_summaries WHERE scope_key = ? AND from_at = ? AND to_at = ?"
  ).get(scopeKey, from, to) as
    { topics: string; conclusions: string; todos: string; commitments: string; created_at: string } | undefined;
  if (cached) {
    return NextResponse.json({
      topics: cached.topics,
      conclusions: cached.conclusions,
      todos: cached.todos,
      commitments: cached.commitments,
      cached: true,
      created_at: cached.created_at,
    });
  }

  // 拉取该时间段的消息（排除已撤回）
  const messages = conversationId
    ? db.prepare(
        "SELECT sender, content, image_url, order_id, created_at FROM messages WHERE conversation_id = ? AND recalled = 0 AND created_at >= ? AND created_at <= ? ORDER BY id ASC"
      ).all(conversationId, from, to)
    : db.prepare(
        "SELECT sender, content, image_url, order_id, created_at FROM messages WHERE group_id = ? AND recalled = 0 AND created_at >= ? AND created_at <= ? ORDER BY id ASC"
      ).all(groupId, from, to);

  if (messages.length === 0) {
    return NextResponse.json({ error: "该时间段没有聊天记录" }, { status: 400 });
  }

  const transcript = (messages as any[]).map(formatMessage).join("\n");

  let summary;
  try {
    summary = await summarizeChatTranscript(transcript);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "总结失败" }, { status: 502 });
  }

  // 落库缓存（并发下 OR IGNORE 兜底，避免撞 UNIQUE）
  db.prepare(
    "INSERT OR IGNORE INTO chat_summaries (scope_key, from_at, to_at, topics, conclusions, todos, commitments) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(scopeKey, from, to, summary.topics, summary.conclusions, summary.todos, summary.commitments);

  return NextResponse.json({ ...summary, cached: false });
}
