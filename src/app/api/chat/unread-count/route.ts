import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// GET /api/chat/unread-count — 一对一未读 + 非免打扰群聊未读（侧栏「消息」角标）
// 一对一只统计在职员工（在职/试用期/待离职/停薪留职）和老板(admin)发来的未读消息，
// 离职员工发来的旧消息不计入，避免角标卡着一个消不掉的数字。
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const db = getDb();
  // 发送方白名单：老板(admin) 或 在职状态员工（在职/试用期/待离职/停薪留职）
  const ACTIVE_STATUS = "('在职','试用期','待离职','停薪留职')";

  // 一对一未读消息数（群聊消息 receiver 是群名，不计入）
  const { c } = db.prepare(
    `SELECT COUNT(*) AS c
     FROM messages msg
     LEFT JOIN employees e ON e.name = msg.sender
     WHERE msg.receiver = ? AND msg.is_read = 0 AND msg.group_id IS NULL
       AND (e.role = 'admin' OR (e.role = 'employee' AND e.status IN ${ACTIVE_STATUS}))`
  ).get(auth.name) as { c: number };

  // 与群列表一致：我加入的群中，别人发送且没有我的已读记录的消息。
  // 这里只排除免打扰群；@消息已包含在消息数中，不再额外累加提醒。
  const { g } = db.prepare(
    `SELECT COUNT(*) AS g
     FROM messages msg
     JOIN chat_groups cg ON cg.id = msg.group_id
     JOIN group_members gm ON gm.group_id = msg.group_id AND gm.member = ?
     WHERE COALESCE(gm.muted, 0) = 0 AND msg.sender <> ?
       AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id = msg.id AND mr.member = ?)`
  ).get(auth.name, auth.name, auth.name) as { g: number };

  return NextResponse.json({ count: c + g });
}
