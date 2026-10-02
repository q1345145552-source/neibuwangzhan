import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
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

  const result = (messages as any[]).map((m) => ({ ...m, read_members: readMap.get(m.id) || [] }));

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
  if (!Number.isInteger(groupId) || groupId <= 0) return NextResponse.json({ error: "缺少群" }, { status: 400 });
  if (!content && !imageUrl && !orderId) return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
  if (imageUrl && !imageUrl.startsWith("/api/files/")) return NextResponse.json({ error: "图片地址无效" }, { status: 400 });

  const group = getGroup(db, groupId);
  if (!group) return NextResponse.json({ error: "群不存在" }, { status: 404 });
  if (!isMember(db, groupId, auth.name)) return NextResponse.json({ error: "你不是该群成员" }, { status: 403 });

  // 分享订单：存 order_id，并把客户名快照进 content（前端据此渲染订单卡片）
  let finalContent = content;
  let finalOrderId = "";
  if (orderId) {
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

  const message = db.prepare(
    "SELECT id, conversation_id, group_id, sender, receiver, content, image_url, order_id, is_read, read_at, recalled, created_at FROM messages WHERE id = ?"
  ).get(messageId);

  return NextResponse.json({ message: { ...(message as object), read_members: [auth.name] } }, { status: 201 });
}
