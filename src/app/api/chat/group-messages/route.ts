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
    "SELECT id, conversation_id, group_id, sender, receiver, content, image_url, order_id, is_read, read_at, created_at FROM messages WHERE group_id = ? AND id > ? ORDER BY id ASC LIMIT 500"
  ).all(groupId, after);

  return NextResponse.json({ group, messages });
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

  const message = db.prepare(
    "SELECT id, conversation_id, group_id, sender, receiver, content, image_url, order_id, is_read, read_at, created_at FROM messages WHERE id = ?"
  ).get(Number(r.lastInsertRowid));

  return NextResponse.json({ message }, { status: 201 });
}
