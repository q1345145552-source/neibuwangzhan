import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// POST /api/chat/groups/transfer — 群主转让群主给其他成员（body: { group_id, new_owner }）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await readJson(req);
  const groupId = Number(body?.group_id);
  const newOwner = String(body?.new_owner ?? "").trim();
  if (!Number.isInteger(groupId) || groupId <= 0) return NextResponse.json({ error: "缺少群" }, { status: 400 });
  if (!newOwner) return NextResponse.json({ error: "缺少新群主" }, { status: 400 });

  const group = db.prepare("SELECT id, name, owner FROM chat_groups WHERE id = ?").get(groupId) as
    { id: number; name: string; owner: string } | undefined;
  if (!group) return NextResponse.json({ error: "群不存在" }, { status: 404 });
  if (group.owner !== auth.name) return NextResponse.json({ error: "只有群主能转让" }, { status: 403 });
  if (newOwner === group.owner) return NextResponse.json({ error: "不能转让给自己" }, { status: 400 });

  const target = db.prepare("SELECT id FROM group_members WHERE group_id = ? AND member = ?").get(groupId, newOwner);
  if (!target) return NextResponse.json({ error: "新群主必须是群成员" }, { status: 400 });

  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  db.transaction(() => {
    db.prepare("UPDATE chat_groups SET owner = ? WHERE id = ?").run(newOwner, groupId);
    // 角色互换：原群主降为成员，新群主升为 owner
    db.prepare("UPDATE group_members SET role = 'member' WHERE group_id = ? AND member = ?").run(groupId, group.owner);
    db.prepare("UPDATE group_members SET role = 'owner' WHERE group_id = ? AND member = ?").run(groupId, newOwner);
    // 群里广播一条转让系统消息
    db.prepare("INSERT INTO messages (group_id, sender, receiver, content, is_read, created_at) VALUES (?, '', ?, ?, 0, ?)")
      .run(groupId, group.name, `群主已转让给 ${newOwner}`, now);
  })();

  const members = (db.prepare(
    "SELECT member FROM group_members WHERE group_id = ? ORDER BY (role = 'owner') DESC, member ASC"
  ).all(groupId) as { member: string }[]).map((r) => r.member);

  return NextResponse.json({ success: true, owner: newOwner, members });
}
