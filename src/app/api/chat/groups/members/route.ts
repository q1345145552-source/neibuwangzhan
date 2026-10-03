import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

type Db = ReturnType<typeof getDb>;

function getGroup(db: Db, groupId: number) {
  return db.prepare("SELECT id, owner FROM chat_groups WHERE id = ?").get(groupId) as
    { id: number; owner: string } | undefined;
}

function getMembers(db: Db, groupId: number): string[] {
  return (db.prepare(
    "SELECT member FROM group_members WHERE group_id = ? ORDER BY (role = 'owner') DESC, member ASC"
  ).all(groupId) as { member: string }[]).map((r) => r.member);
}

// POST /api/chat/groups/members — 群主邀请成员入群（body: { group_id, members: string[] }）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const groupId = Number(body?.group_id);
  const rawMembers = Array.isArray(body?.members) ? body.members : [];
  const members: string[] = [];
  for (const raw of rawMembers) {
    const n = String(raw ?? "").trim();
    if (n && !members.includes(n)) members.push(n);
  }
  if (!Number.isInteger(groupId) || groupId <= 0) return NextResponse.json({ error: "缺少群" }, { status: 400 });

  const group = getGroup(db, groupId);
  if (!group) return NextResponse.json({ error: "群不存在" }, { status: 404 });
  if (group.owner !== auth.name) return NextResponse.json({ error: "只有群主能邀请成员" }, { status: 403 });
  if (members.length === 0) return NextResponse.json({ error: "请选择要邀请的成员" }, { status: 400 });

  // 校验都是在职员工（群主自己已在群内，跳过）
  const staffStmt = db.prepare(
    "SELECT id FROM employees WHERE name = ? AND status = '在职' AND role IN ('admin','employee')"
  );
  const valid: string[] = [];
  for (const m of members) {
    if (m === auth.name) continue;
    if (!staffStmt.get(m)) return NextResponse.json({ error: `成员「${m}」不存在或已离职` }, { status: 400 });
    valid.push(m);
  }

  const ins = db.prepare("INSERT OR IGNORE INTO group_members (group_id, member, role) VALUES (?, ?, 'member')");
  db.transaction(() => { for (const m of valid) ins.run(groupId, m); })();

  return NextResponse.json({ success: true, members: getMembers(db, groupId) });
}

// DELETE /api/chat/groups/members — 群主移除成员（body: { group_id, member }）
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const groupId = Number(body?.group_id);
  const member = String(body?.member ?? "").trim();
  if (!Number.isInteger(groupId) || groupId <= 0) return NextResponse.json({ error: "缺少群" }, { status: 400 });
  if (!member) return NextResponse.json({ error: "缺少成员" }, { status: 400 });

  const group = getGroup(db, groupId);
  if (!group) return NextResponse.json({ error: "群不存在" }, { status: 404 });
  if (group.owner !== auth.name) return NextResponse.json({ error: "只有群主能移除成员" }, { status: 403 });
  if (member === group.owner) return NextResponse.json({ error: "不能移除群主" }, { status: 400 });

  db.transaction(() => {
    db.prepare("DELETE FROM group_members WHERE group_id = ? AND member = ?").run(groupId, member);
    // 清理该成员在本群的已读回执和 @提醒，避免被移除后还出现在「已读 X/Y」里
    db.prepare("DELETE FROM message_reads WHERE member = ? AND message_id IN (SELECT id FROM messages WHERE group_id = ?)").run(member, groupId);
    db.prepare("DELETE FROM message_mentions WHERE member = ? AND message_id IN (SELECT id FROM messages WHERE group_id = ?)").run(member, groupId);
  })();

  return NextResponse.json({ success: true, members: getMembers(db, groupId) });
}
