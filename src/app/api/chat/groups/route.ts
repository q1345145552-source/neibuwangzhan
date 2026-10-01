import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// GET /api/chat/groups — 我所在的群（含成员名单，群主在前）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const groups = db.prepare(`
    SELECT g.id, g.name, g.owner
    FROM chat_groups g
    JOIN group_members me ON me.group_id = g.id AND me.member = ?
    ORDER BY g.id DESC
  `).all(auth.name) as { id: number; name: string; owner: string }[];

  const membersStmt = db.prepare(
    "SELECT member FROM group_members WHERE group_id = ? ORDER BY (role = 'owner') DESC, member ASC"
  );
  const result = groups.map((g) => ({
    ...g,
    members: (membersStmt.all(g.id) as { member: string }[]).map((m) => m.member),
  }));
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
