import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// PATCH /api/chat/groups/mute — 成员设置自己在某群的免打扰（body: { group_id, muted }），各设各的
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const groupId = Number(body?.group_id);
  const muted = body?.muted ? 1 : 0;
  if (!Number.isInteger(groupId) || groupId <= 0) return NextResponse.json({ error: "缺少群" }, { status: 400 });

  const isMember = db.prepare("SELECT id FROM group_members WHERE group_id = ? AND member = ?").get(groupId, auth.name);
  if (!isMember) return NextResponse.json({ error: "你不在这个群里" }, { status: 403 });

  db.prepare("UPDATE group_members SET muted = ? WHERE group_id = ? AND member = ?").run(muted, groupId, auth.name);
  return NextResponse.json({ success: true, muted: muted === 1 });
}
