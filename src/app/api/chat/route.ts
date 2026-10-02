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

// 分享卡片类型 → 会话列表预览文案
const CARD_LABELS: Record<string, string> = {
  order: "[订单]", todo: "[待办]", project: "[项目]", customer: "[客户]",
  vat: "[VAT申报]", wht: "[预扣税]", problem: "[问题]",
};

// 按分类校验分享的条目存在，并返回卡片要展示的标题/副标题
function resolveCard(db: Db, type: string, id: string): { title: string; subtitle: string } | null {
  if (type === "order") {
    const r = db.prepare("SELECT customer_name FROM orders WHERE id = ?").get(id) as { customer_name: string } | undefined;
    return r ? { title: id, subtitle: r.customer_name || "" } : null;
  }
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  if (type === "todo") {
    const r = db.prepare("SELECT content FROM todos WHERE id = ?").get(n) as { content: string } | undefined;
    return r ? { title: r.content, subtitle: "" } : null;
  }
  if (type === "project") {
    const r = db.prepare("SELECT name, current_phase FROM projects WHERE id = ?").get(n) as { name: string; current_phase: string } | undefined;
    return r ? { title: r.name, subtitle: r.current_phase ? `当前阶段：${r.current_phase}` : "" } : null;
  }
  if (type === "customer") {
    const r = db.prepare("SELECT company_name FROM customers WHERE id = ?").get(n) as { company_name: string } | undefined;
    return r ? { title: r.company_name, subtitle: "" } : null;
  }
  if (type === "vat") {
    const r = db.prepare("SELECT vc.company_name, v.year_month FROM vat_records v JOIN vat_customers vc ON vc.id = v.customer_id WHERE v.id = ?").get(n) as { company_name: string; year_month: string } | undefined;
    return r ? { title: r.company_name, subtitle: r.year_month ? `申报月份：${r.year_month}` : "" } : null;
  }
  if (type === "wht") {
    const r = db.prepare("SELECT wc.company_name, w.year_month FROM wht_records w JOIN wht_customers wc ON wc.id = w.customer_id WHERE w.id = ?").get(n) as { company_name: string; year_month: string } | undefined;
    return r ? { title: r.company_name, subtitle: r.year_month ? `申报月份：${r.year_month}` : "" } : null;
  }
  if (type === "problem") {
    const r = db.prepare("SELECT problem_number, company_name FROM problems WHERE id = ?").get(n) as { problem_number: string; company_name: string } | undefined;
    return r ? { title: r.problem_number, subtitle: r.company_name || "" } : null;
  }
  return null;
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
    "SELECT id, conversation_id, group_id, sender, receiver, content, image_url, order_id, is_read, read_at, recalled, reply_to, reply_preview, created_at FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT 500"
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
  const cardType = String(body?.card_type || "").trim();
  const cardId = String(body?.card_id || "").trim();
  const replyTo = Number(body?.reply_to) || null;
  const replyPreview = String(body?.reply_preview || "").trim();
  if (!other) return NextResponse.json({ error: "缺少聊天对象" }, { status: 400 });
  if (!content && !imageUrl && !orderId && !cardType) return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
  if (imageUrl && !imageUrl.startsWith("/api/files/")) return NextResponse.json({ error: "图片地址无效" }, { status: 400 });
  if (other === auth.name) return NextResponse.json({ error: "不能和自己聊天" }, { status: 400 });
  if (!findActiveStaff(db, other)) return NextResponse.json({ error: "聊天对象不存在" }, { status: 404 });

  // 分享卡片：order_id 存「类型:id」，content 存卡片标题/副标题快照（前端据此渲染卡片并跳详情）
  let finalContent = content;
  let finalOrderId = "";
  let cardLabel = "";
  if (cardType) {
    if (!cardId) return NextResponse.json({ error: "缺少分享条目" }, { status: 400 });
    const card = resolveCard(db, cardType, cardId);
    if (!card) return NextResponse.json({ error: "分享的条目不存在" }, { status: 404 });
    finalOrderId = `${cardType}:${cardId}`;
    finalContent = JSON.stringify(card);
    cardLabel = CARD_LABELS[cardType] || "[卡片]";
  } else if (orderId) {
    // 兼容旧订单分享：存 order_id，并把客户名快照进 content
    const order = db.prepare("SELECT customer_name FROM orders WHERE id = ?").get(orderId) as { customer_name: string } | undefined;
    if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
    finalOrderId = orderId;
    finalContent = order.customer_name;
  }

  const conversationId = getOrCreateConversation(db, auth.name, other);
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const r = db.prepare(
    "INSERT INTO messages (conversation_id, sender, receiver, content, image_url, order_id, is_read, reply_to, reply_preview, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)"
  ).run(conversationId, auth.name, other, finalContent, imageUrl, finalOrderId, replyTo, replyPreview, now);

  // 更新会话最后一条消息（后续会话列表排序/预览用）
  const preview = cardLabel || (orderId ? "[订单]" : imageUrl ? "[图片]" : finalContent.slice(0, 50));
  db.prepare(
    "UPDATE conversations SET last_message_at = ?, last_message_preview = ? WHERE id = ?"
  ).run(now, preview, conversationId);

  const message = db.prepare(
    "SELECT id, conversation_id, group_id, sender, receiver, content, image_url, order_id, is_read, read_at, recalled, reply_to, reply_preview, created_at FROM messages WHERE id = ?"
  ).get(Number(r.lastInsertRowid));

  return NextResponse.json({ message }, { status: 201 });
}
