import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// POST /api/chat/groups/leave — 成员退出群聊（群主不能退，只能转让或解散）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await readJson(req);
  const groupId = Number(body?.group_id);
  if (!Number.isInteger(groupId) || groupId <= 0) return NextResponse.json({ error: "缺少群" }, { status: 400 });

  const group = db.prepare("SELECT id, name, owner FROM chat_groups WHERE id = ?").get(groupId) as
    { id: number; name: string; owner: string } | undefined;
  if (!group) return NextResponse.json({ error: "群不存在" }, { status: 404 });
  if (group.owner === auth.name) {
    return NextResponse.json({ error: "群主不能退群，请先转让群主或解散群" }, { status: 400 });
  }

  const isMember = db.prepare("SELECT id FROM group_members WHERE group_id = ? AND member = ?").get(groupId, auth.name);
  if (!isMember) return NextResponse.json({ error: "你不在这个群里" }, { status: 400 });

  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  db.transaction(() => {
    db.prepare("DELETE FROM group_members WHERE group_id = ? AND member = ?").run(groupId, auth.name);
    // 清理该成员在本群的已读回执和 @提醒
    db.prepare("DELETE FROM message_reads WHERE member = ? AND message_id IN (SELECT id FROM messages WHERE group_id = ?)").run(auth.name, groupId);
    db.prepare("DELETE FROM message_mentions WHERE member = ? AND message_id IN (SELECT id FROM messages WHERE group_id = ?)").run(auth.name, groupId);
    // 群里广播一条退群系统消息（sender 为空串，前端按系统消息居中显示）
    db.prepare("INSERT INTO messages (group_id, sender, receiver, content, is_read, created_at) VALUES (?, '', ?, ?, 0, ?)")
      .run(groupId, group.name, `${auth.name} 退出了群聊`, now);
  })();

  return NextResponse.json({ success: true });
}
