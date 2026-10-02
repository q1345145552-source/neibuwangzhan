import { NextRequest, NextResponse } from "next/server";
import { getDb, sendNotification } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

type Db = ReturnType<typeof getDb>;

function getGroup(db: Db, groupId: number) {
  return db.prepare("SELECT id, name, owner FROM chat_groups WHERE id = ?").get(groupId) as
    { id: number; name: string; owner: string } | undefined;
}

function isMember(db: Db, groupId: number, name: string): boolean {
  return !!db.prepare("SELECT id FROM group_members WHERE group_id = ? AND member = ?").get(groupId, name);
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

// GET /api/chat/group-messages?group_id=X[&after=Y] — 拉取群消息（after 之后的新消息），仅群成员
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const groupId = Number(searchParams.get("group_id"));
  const after = Math.max(0, Number(searchParams.get("after")) || 0);
  if (!Number.isInteger(groupId) || groupId <= 0) return NextResponse.json({ error: "缺少群" }, { status: 400 });

  const db = getDb();
  const group = getGroup(db, groupId);
  if (!group) return NextResponse.json({ error: "群不存在" }, { status: 404 });
  if (!isMember(db, groupId, auth.name)) return NextResponse.json({ error: "你不是该群成员" }, { status: 403 });

  const messages = db.prepare(
    "SELECT id, conversation_id, group_id, sender, receiver, content, image_url, order_id, is_read, read_at, recalled, created_at FROM messages WHERE group_id = ? AND id > ? ORDER BY id ASC LIMIT 500"
  ).all(groupId, after);

  // 打开群会话 = 我把该群所有消息标记为已读（发送人发消息时已自动记一条，OR IGNORE 去重）
  db.prepare(
    "INSERT OR IGNORE INTO message_reads (message_id, member) SELECT id, ? FROM messages WHERE group_id = ?"
  ).run(auth.name, groupId);

  // 该群所有消息的已读成员（用于每条消息显示「已读 X/Y」和点开看谁读了谁没读）
  const readRows = db.prepare(
    "SELECT mr.message_id, mr.member FROM message_reads mr JOIN messages m ON m.id = mr.message_id WHERE m.group_id = ?"
  ).all(groupId) as { message_id: number; member: string }[];
  const readMap = new Map<number, string[]>();
  for (const r of readRows) {
    if (!readMap.has(r.message_id)) readMap.set(r.message_id, []);
    readMap.get(r.message_id)!.push(r.member);
  }
  const reads: Record<string, string[]> = {};
  for (const [k, v] of readMap) reads[String(k)] = v;

  const memberCount = (db.prepare("SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?").get(groupId) as { c: number }).c;

  // 该群消息 @ 了哪些成员（用于前端高亮「有人@我」）
  const mentionRows = db.prepare(
    "SELECT mm.message_id, mm.member FROM message_mentions mm JOIN messages m ON m.id = mm.message_id WHERE m.group_id = ?"
  ).all(groupId) as { message_id: number; member: string }[];
  const mentionMap = new Map<number, string[]>();
  for (const r of mentionRows) {
    if (!mentionMap.has(r.message_id)) mentionMap.set(r.message_id, []);
    mentionMap.get(r.message_id)!.push(r.member);
  }

  // 打开群 = 我的 @提醒已读（提醒消掉）
  db.prepare(
    "UPDATE message_mentions SET is_read = 1 WHERE member = ? AND message_id IN (SELECT id FROM messages WHERE group_id = ?)"
  ).run(auth.name, groupId);

  const result = (messages as any[]).map((m) => ({
    ...m,
    read_members: readMap.get(m.id) || [],
    mentioned_members: mentionMap.get(m.id) || [],
  }));

  return NextResponse.json({ group: { ...group, member_count: memberCount }, messages: result, reads });
}

// POST /api/chat/group-messages — 群内发消息（body: { group_id, content?, image_url? }），仅群成员
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await readJson(req);
  const groupId = Number(body?.group_id);
  const content = String(body?.content || "").trim();
  const imageUrl = String(body?.image_url || "").trim();
  const orderId = String(body?.order_id || "").trim();
  const cardType = String(body?.card_type || "").trim();
  const cardId = String(body?.card_id || "").trim();
  if (!Number.isInteger(groupId) || groupId <= 0) return NextResponse.json({ error: "缺少群" }, { status: 400 });
  if (!content && !imageUrl && !orderId && !cardType) return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
  if (imageUrl && !imageUrl.startsWith("/api/files/")) return NextResponse.json({ error: "图片地址无效" }, { status: 400 });

  const group = getGroup(db, groupId);
  if (!group) return NextResponse.json({ error: "群不存在" }, { status: 404 });
  if (!isMember(db, groupId, auth.name)) return NextResponse.json({ error: "你不是该群成员" }, { status: 403 });

  // 分享卡片：order_id 存「类型:id」，content 存卡片标题/副标题快照（前端据此渲染卡片并跳详情）
  let finalContent = content;
  let finalOrderId = "";
  if (cardType) {
    if (!cardId) return NextResponse.json({ error: "缺少分享条目" }, { status: 400 });
    const card = resolveCard(db, cardType, cardId);
    if (!card) return NextResponse.json({ error: "分享的条目不存在" }, { status: 404 });
    finalOrderId = `${cardType}:${cardId}`;
    finalContent = JSON.stringify(card);
  } else if (orderId) {
    // 兼容旧订单分享：存 order_id，并把客户名快照进 content
    const order = db.prepare("SELECT customer_name FROM orders WHERE id = ?").get(orderId) as { customer_name: string } | undefined;
    if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
    finalOrderId = orderId;
    finalContent = order.customer_name;
  }

  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const r = db.prepare(
    "INSERT INTO messages (group_id, sender, receiver, content, image_url, order_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)"
  ).run(groupId, auth.name, group.name, finalContent, imageUrl, finalOrderId, now);
  const messageId = Number(r.lastInsertRowid);

  // 发送人自动视为已读自己这条消息
  db.prepare("INSERT OR IGNORE INTO message_reads (message_id, member) VALUES (?, ?)").run(messageId, auth.name);

  // 解析 @提及：找出内容里 @ 了哪些群成员，写入提醒
  const members = db.prepare("SELECT member FROM group_members WHERE group_id = ?").all(groupId) as { member: string }[];
  const memberSet = new Set(members.map((m) => m.member));
  const mentioned = new Set<string>();
  const mentionRegex = /@([^\s@，。！？、;；:：]+)/g;
  let mm;
  while ((mm = mentionRegex.exec(finalContent)) !== null) {
    const name = mm[1].trim();
    if (name && name !== auth.name && memberSet.has(name)) mentioned.add(name);
  }
  const preview = cardType ? (CARD_LABELS[cardType] || "[卡片]") : orderId ? "[订单]" : imageUrl ? "[图片]" : finalContent.slice(0, 50);
  for (const name of mentioned) {
    db.prepare("INSERT OR IGNORE INTO message_mentions (message_id, member) VALUES (?, ?)").run(messageId, name);
    // 通知中心：群聊里 @ 了某人，生成一条通知（点通知跳转打开该群）
    sendNotification(
      "mention",
      `${auth.name} 在群「${group.name}」@了你`,
      preview,
      name,
      String(groupId),
      "chat_group"
    );
  }

  const message = db.prepare(
    "SELECT id, conversation_id, group_id, sender, receiver, content, image_url, order_id, is_read, read_at, recalled, created_at FROM messages WHERE id = ?"
  ).get(messageId);

  return NextResponse.json({ message: { ...(message as object), read_members: [auth.name], mentioned_members: [...mentioned] } }, { status: 201 });
}
