import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// GET /api/chat/unread-count — 当前用户未读的一对一消息数 + 群聊 @提醒数（侧栏「消息」角标）
// 只统计在职员工（在职/试用期/待离职/停薪留职）和老板(admin)发来的未读消息，
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

  // 群聊里有人 @ 我、我还没看的提醒数（免打扰的群不计入）
  const { m } = db.prepare(
    `SELECT COUNT(*) AS m
     FROM message_mentions mm
     JOIN messages msg ON msg.id = mm.message_id
     LEFT JOIN group_members gm ON gm.group_id = msg.group_id AND gm.member = mm.member
     LEFT JOIN employees e ON e.name = msg.sender
     WHERE mm.member = ? AND mm.is_read = 0 AND COALESCE(gm.muted, 0) = 0
       AND (e.role = 'admin' OR (e.role = 'employee' AND e.status IN ${ACTIVE_STATUS}))`
  ).get(auth.name) as { m: number };

  return NextResponse.json({ count: c + m });
}
