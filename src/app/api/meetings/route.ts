import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { syncMeetingReminders } from "@/lib/meeting-sync";
import { parseMeetingTopics } from "@/lib/meeting-topics";

// 解析参会人 JSON 数组 → 去重后的员工名数组
function parseParticipants(raw: unknown): string[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) arr = p; } catch {}
  }
  const names = arr.map((s: unknown) => String(s).trim()).filter(Boolean);
  return [...new Set(names)];
}

// GET /api/meetings — 管理员看全部会议；员工看自己参加的（参会人含自己）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const isAdmin = auth.role === "admin";

  // 顺带触发会议提醒同步：当天下午没交的发通知，昨天没交的生成补交待办
  try { syncMeetingReminders(); } catch {}

  const rows = (isAdmin
    ? db.prepare("SELECT * FROM meetings ORDER BY meeting_date DESC, id DESC").all()
    : db.prepare("SELECT * FROM meetings ORDER BY meeting_date DESC, id DESC").all()) as any[];

  // 员工只看参会人里有自己的会议
  const result = isAdmin ? rows : rows.filter((m) => parseParticipants(m.participants).includes(auth.name));
  // 一次查询全部有效提交，按会议和员工去重；退回的心得不计入。
  const submittedRows = db.prepare(
    "SELECT DISTINCT meeting_id, employee_name FROM meeting_reflections WHERE status = '已提交'"
  ).all() as { meeting_id: number; employee_name: string }[];
  const submittedByMeeting = new Map<number, Set<string>>();
  for (const row of submittedRows) {
    const names = submittedByMeeting.get(row.meeting_id) ?? new Set<string>();
    names.add(row.employee_name);
    submittedByMeeting.set(row.meeting_id, names);
  }
  return NextResponse.json(result.map((meeting) => {
    const participants = parseParticipants(meeting.participants);
    const submitted = submittedByMeeting.get(meeting.id);
    const submittedCount = participants.filter((name) => submitted?.has(name)).length;
    return {
      ...meeting,
      participant_count: participants.length,
      submitted_count: submittedCount,
      unsubmitted_count: participants.length - submittedCount,
      my_submitted: participants.includes(auth.name) && Boolean(submitted?.has(auth.name)),
    };
  }));
}

// POST /api/meetings — 管理员发起会议通知
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可发起会议" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const { title, meeting_date, meeting_time, agenda, participants, topics } = body;

  if (!title || !String(title).trim()) return NextResponse.json({ error: "请填写会议主题" }, { status: 400 });
  const date = String(meeting_date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "请填写会议日期" }, { status: 400 });

  const names = parseParticipants(participants);
  if (names.length === 0) return NextResponse.json({ error: "请选择参会人" }, { status: 400 });
  if (topics !== undefined && !Array.isArray(topics)) return NextResponse.json({ error: "会议主题须为数组" }, { status: 400 });

  const now = new Date().toISOString();
  const result = db.prepare(
    "INSERT INTO meetings (title, meeting_date, meeting_time, agenda, participants, topics, creator, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    String(title).trim(),
    date,
    String(meeting_time || "").trim(),
    String(agenda || "").trim(),
    JSON.stringify(names),
    JSON.stringify(parseMeetingTopics(topics)),
    auth.name,
    now,
    now
  );

  logOperation(auth.name, "发起会议", "meeting", String(result.lastInsertRowid), String(title).trim());
  return NextResponse.json(db.prepare("SELECT * FROM meetings WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
}
