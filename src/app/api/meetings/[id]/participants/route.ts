import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { assignMeetingTodos, invalidMeetingParticipants, parseMeetingParticipants } from "@/lib/meeting-todos";

// 仅追加参会人，保留原参会人和会议其他字段；重复请求不会重复派待办。
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可新增参会人" }, { status: 403 });
  const { id } = await params;
  const body = await readJson(req);
  if (!Array.isArray(body.participants)) return NextResponse.json({ error: "参会人须为数组" }, { status: 400 });
  const names = parseMeetingParticipants(body.participants);
  if (!names.length) return NextResponse.json({ error: "请选择新增参会人" }, { status: 400 });
  const db = getDb();
  const result = db.transaction(() => {
    const meeting = db.prepare("SELECT * FROM meetings WHERE id=?").get(id) as { id: number; title: string; participants: string } | undefined;
    if (!meeting) return { status: 404, data: { error: "会议不存在" } };
    if (invalidMeetingParticipants(db, names).length) return { status: 400, data: { error: "请选择在岗员工参会" } };
    const existing = parseMeetingParticipants(meeting.participants);
    const added = names.filter(name => !existing.includes(name));
    if (added.length) {
      const stamp = new Date().toISOString();
      db.prepare("UPDATE meetings SET participants=?,updated_at=? WHERE id=?").run(JSON.stringify([...existing, ...added]), stamp, meeting.id);
      assignMeetingTodos(db, meeting.id, meeting.title, added, stamp);
      logOperation(auth.name, "新增会议参会人", "meeting", String(meeting.id), added.join("、"));
    }
    return { status: 200, data: db.prepare("SELECT * FROM meetings WHERE id=?").get(meeting.id) };
  }).immediate();
  return NextResponse.json(result.data, { status: result.status });
}
