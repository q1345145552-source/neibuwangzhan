import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { parseMeetingParticipants } from "@/lib/meeting-todos";

/** 心得编号反查会议；不提交、退回、翻译或记录已阅。 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const rawId = (await params).id;
  const id = Number(rawId);
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "心得编号无效。" }, { status: 400 });
  const row = getDb().prepare(`SELECT r.id, r.meeting_id, r.employee_name, m.participants
    FROM meeting_reflections r JOIN meetings m ON m.id=r.meeting_id WHERE r.id=?`).get(id) as {
    id: number; meeting_id: number; employee_name: string; participants: string;
  } | undefined;
  // 与会议列表、心得列表的可见范围一致：员工须参会且只能定位自己的心得。
  if (!row || (auth.role !== "admin" && (row.employee_name !== auth.name || !parseMeetingParticipants(row.participants).includes(auth.name)))) {
    return NextResponse.json({ error: "心得不存在或你无权查看。" }, { status: 404 });
  }
  return NextResponse.json({ id: row.id, meeting_id: row.meeting_id }, { headers: { "Cache-Control": "private, no-store" } });
}
