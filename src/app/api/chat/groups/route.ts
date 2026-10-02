import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// GET /api/chat/groups — 我所在的群（含成员名单，群主在前），带最后一条消息预览，按最新消息倒序
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const groups = db.prepare(`
    SELECT g.id, g.name, g.owner, g.background, g.announcement, g.avatar, me.muted,
      (SELECT m.sender FROM messages m WHERE m.group_id = g.id ORDER BY m.id DESC LIMIT 1) AS last_sender,
      (SELECT m.content FROM messages m WHERE m.group_id = g.id ORDER BY m.id DESC LIMIT 1) AS last_content,
      (SELECT m.image_url FROM messages m WHERE m.group_id = g.id ORDER BY m.id DESC LIMIT 1) AS last_image_url,
      (SELECT m.order_id FROM messages m WHERE m.group_id = g.id ORDER BY m.id DESC LIMIT 1) AS last_order_id,
      (SELECT m.created_at FROM messages m WHERE m.group_id = g.id ORDER BY m.id DESC LIMIT 1) AS last_at
    FROM chat_groups g
    JOIN group_members me ON me.group_id = g.id AND me.member = ?
    ORDER BY COALESCE((SELECT m.created_at FROM messages m WHERE m.group_id = g.id ORDER BY m.id DESC LIMIT 1), '') DESC, g.id DESC
  `).all(auth.name) as {
    id: number;
    name: string;
    owner: string;
    background: string;
    announcement: string;
    avatar: string;
    muted: number;
    last_sender: string | null;
    last_content: string | null;
    last_image_url: string | null;
    last_order_id: string | null;
    last_at: string | null;
  }[];

  const membersStmt = db.prepare(
    "SELECT member FROM group_members WHERE group_id = ? ORDER BY (role = 'owner') DESC, member ASC"
  );
  const result = groups.map((g) => {
    let preview: string | null = null;
    if (g.last_image_url) preview = "[图片]";
    else if (g.last_order_id) preview = "[订单]";
    else if (g.last_content) preview = g.last_content.slice(0, 50);
    return {
      id: g.id,
      name: g.name,
      owner: g.owner,
      background: g.background || "",
      announcement: g.announcement || "",
      avatar: g.avatar || "",
      muted: !!g.muted,
      members: (membersStmt.all(g.id) as { member: string }[]).map((m) => m.member),
      last_at: g.last_at || null,
      last_sender: g.last_sender || null,
      last_preview: preview,
      unread: 0,
    };
  });
  return NextResponse.json(result);
}

// POST /api/chat/groups — 建群（body: { name, members: string[] }），谁都能建，创建者自动成为群主
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await readJson(req);
  const name = String(body?.name || "").trim();
  const rawMembers = Array.isArray(body?.members) ? body.members : [];
  if (!name) return NextResponse.json({ error: "请填写群名称" }, { status: 400 });

  // 成员名单：去重、去掉自己（自己作为群主自动加入）
  const memberSet = new Set<string>();
  for (const raw of rawMembers) {
    const n = String(raw || "").trim();
    if (n && n !== auth.name) memberSet.add(n);
  }
  const members = [...memberSet];
  if (members.length === 0) return NextResponse.json({ error: "请至少选择一名成员" }, { status: 400 });

  // 校验所有成员都是在职员工
  const staffStmt = db.prepare(
    "SELECT id FROM employees WHERE name = ? AND status = '在职' AND role IN ('admin','employee')"
  );
  for (const m of members) {
    if (!staffStmt.get(m)) return NextResponse.json({ error: `成员「${m}」不存在或已离职` }, { status: 400 });
  }

  const groupId = db.transaction(() => {
    const g = db.prepare("INSERT INTO chat_groups (name, owner) VALUES (?, ?)").run(name, auth.name);
    const id = Number(g.lastInsertRowid);
    const ins = db.prepare("INSERT INTO group_members (group_id, member, role) VALUES (?, ?, ?)");
    ins.run(id, auth.name, "owner");
    for (const m of members) ins.run(id, m, "member");
    return id;
  })();

  const group = db.prepare("SELECT id, name, owner FROM chat_groups WHERE id = ?").get(groupId) as
    { id: number; name: string; owner: string };
  const memberRows = db.prepare(
    "SELECT member FROM group_members WHERE group_id = ? ORDER BY (role = 'owner') DESC, member ASC"
  ).all(groupId) as { member: string }[];

  return NextResponse.json({ group: { ...group, members: memberRows.map((m) => m.member) } }, { status: 201 });
}

// PATCH /api/chat/groups — 群主设置群背景 / 群公告（body: { group_id, background?, announcement? }）
// 只有群主（创建人）能设置，普通成员无权。
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await readJson(req);
  const groupId = Number(body?.group_id);
  if (!Number.isInteger(groupId) || groupId <= 0) return NextResponse.json({ error: "缺少群" }, { status: 400 });

  const db = getDb();
  const group = db.prepare("SELECT id, owner FROM chat_groups WHERE id = ?").get(groupId) as
    { id: number; owner: string } | undefined;
  if (!group) return NextResponse.json({ error: "群不存在" }, { status: 404 });
  if (group.owner !== auth.name) return NextResponse.json({ error: "只有群主能设置" }, { status: 403 });

  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.background !== undefined) {
    const bg = String(body.background ?? "").trim();
    if (bg && !bg.startsWith("/api/files/") && !/^[a-z0-9_-]+$/.test(bg)) {
      return NextResponse.json({ error: "背景值无效" }, { status: 400 });
    }
    sets.push("background = ?"); params.push(bg);
  }
  if (body.announcement !== undefined) {
    sets.push("announcement = ?"); params.push(String(body.announcement ?? "").trim());
  }
  if (body.name !== undefined) {
    const nm = String(body.name ?? "").trim();
    if (!nm) return NextResponse.json({ error: "群名称不能为空" }, { status: 400 });
    if (nm.length > 50) return NextResponse.json({ error: "群名称不能超过 50 字" }, { status: 400 });
    sets.push("name = ?"); params.push(nm);
  }
  if (body.avatar !== undefined) {
    const av = String(body.avatar ?? "").trim();
    if (av && !av.startsWith("/api/files/")) return NextResponse.json({ error: "头像地址无效" }, { status: 400 });
    sets.push("avatar = ?"); params.push(av);
  }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });

  db.prepare(`UPDATE chat_groups SET ${sets.join(", ")} WHERE id = ?`).run(...params, groupId);
  const updated = db.prepare("SELECT id, name, owner, background, announcement, avatar FROM chat_groups WHERE id = ?").get(groupId);
  return NextResponse.json({ group: updated });
}
