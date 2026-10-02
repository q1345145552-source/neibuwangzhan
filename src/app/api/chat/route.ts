import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

type Db = ReturnType<typeof getDb>;

// 会话双方按字典序规范化（user_a < user_b），配合 conversations 表的 UNIQUE(user_a, user_b)
// 保证同一对员工只存在一条会话记录。返回该会话 id（不存在则创建）。
function getOrCreateConversation(db: Db, me: string, other: string): number {
  const a = me < other ? me : other;
  const b = me < other ? other : me;
  const existing = db.prepare("SELECT id FROM conversations WHERE user_a = ? AND user_b = ?").get(a, b) as
    { id: number } | undefined;
  if (existing) return existing.id;
  const r = db.prepare("INSERT INTO conversations (user_a, user_b) VALUES (?, ?)").run(a, b);
  return Number(r.lastInsertRowid);
}

function findActiveStaff(db: Db, name: string): boolean {
  const row = db.prepare(
    "SELECT id FROM employees WHERE name = ? AND status = '在职' AND role IN ('admin','employee')"
  ).get(name);
  return !!row;
}

// GET /api/chat?other=姓名[&after=消息id] — 拉取与某员工的一对一会话消息（after 之后的新消息）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const other = (searchParams.get("other") || "").trim();
  const after = Math.max(0, Number(searchParams.get("after")) || 0);
  if (!other) return NextResponse.json({ error: "缺少聊天对象" }, { status: 400 });
  if (other === auth.name) return NextResponse.json({ error: "不能和自己聊天" }, { status: 400 });

  const db = getDb();
  if (!findActiveStaff(db, other)) return NextResponse.json({ error: "聊天对象不存在" }, { status: 404 });

  const conversationId = getOrCreateConversation(db, auth.name, other);

  const messages = db.prepare(
    "SELECT id, conversation_id, group_id, sender, receiver, content, image_url, order_id, is_read, read_at, recalled, created_at FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT 500"
  ).all(conversationId, after);

  // 打开会话即视为已读：把对方发给我的未读消息标记为已读
  db.prepare(
    "UPDATE messages SET is_read = 1, read_at = datetime('now') WHERE conversation_id = ? AND receiver = ? AND is_read = 0"
  ).run(conversationId, auth.name);

  // 我发出去、对方已读的消息 id，供发送方显示「已读」
  const readMessageIds = (db.prepare(
    "SELECT id FROM messages WHERE conversation_id = ? AND sender = ? AND is_read = 1"
  ).all(conversationId, auth.name) as { id: number }[]).map((r) => r.id);

  return NextResponse.json({ conversationId, other, messages, readMessageIds });
}

// POST /api/chat — 发一条消息（body: { other, content?, image_url? }），文字/图片二选一或可带文字说明
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await readJson(req);
  const other = String(body?.other || "").trim();
  const content = String(body?.content || "").trim();
  const imageUrl = String(body?.image_url || "").trim();
  const orderId = String(body?.order_id || "").trim();
  if (!other) return NextResponse.json({ error: "缺少聊天对象" }, { status: 400 });
  if (!content && !imageUrl && !orderId) return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
  if (imageUrl && !imageUrl.startsWith("/api/files/")) return NextResponse.json({ error: "图片地址无效" }, { status: 400 });
  if (other === auth.name) return NextResponse.json({ error: "不能和自己聊天" }, { status: 400 });
  if (!findActiveStaff(db, other)) return NextResponse.json({ error: "聊天对象不存在" }, { status: 404 });

  // 分享订单：存 order_id，并把客户名快照进 content（前端据此渲染订单卡片）
  let finalContent = content;
  let finalOrderId = "";
  if (orderId) {
    const order = db.prepare("SELECT customer_name FROM orders WHERE id = ?").get(orderId) as { customer_name: string } | undefined;
    if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
    finalOrderId = orderId;
    finalContent = order.customer_name;
  }

  const conversationId = getOrCreateConversation(db, auth.name, other);
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const r = db.prepare(
    "INSERT INTO messages (conversation_id, sender, receiver, content, image_url, order_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)"
  ).run(conversationId, auth.name, other, finalContent, imageUrl, finalOrderId, now);

  // 更新会话最后一条消息（后续会话列表排序/预览用）
  const preview = orderId ? "[订单]" : imageUrl ? "[图片]" : finalContent.slice(0, 50);
  db.prepare(
    "UPDATE conversations SET last_message_at = ?, last_message_preview = ? WHERE id = ?"
  ).run(now, preview, conversationId);

  const message = db.prepare(
    "SELECT id, conversation_id, group_id, sender, receiver, content, image_url, order_id, is_read, read_at, recalled, created_at FROM messages WHERE id = ?"
  ).get(Number(r.lastInsertRowid));

  return NextResponse.json({ message }, { status: 201 });
}
