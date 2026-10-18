import { publishBossSubmission } from "@/lib/boss-submissions";
import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

function parseList(raw: unknown): string[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) arr = p; } catch {}
  }
  return arr.map((s: unknown) => String(s).trim()).filter(Boolean);
}

// GET /api/meetings/[id]/reflections — 老板看该会议全部心得；员工只看自己提交的
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const meeting = db.prepare("SELECT * FROM meetings WHERE id = ?").get(id) as any;
  if (!meeting) return NextResponse.json({ error: "会议不存在" }, { status: 404 });

  const isAdmin = auth.role === "admin";
  const rows = (isAdmin
    ? db.prepare("SELECT * FROM meeting_reflections WHERE meeting_id = ? ORDER BY id DESC").all(meeting.id)
    : db.prepare("SELECT * FROM meeting_reflections WHERE meeting_id = ? AND employee_name = ? ORDER BY id DESC").all(meeting.id, auth.name)) as any[];

  return NextResponse.json(rows);
}

// POST /api/meetings/[id]/reflections — 员工提交心得（同一场会议可提交多条）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const meeting = db.prepare("SELECT * FROM meetings WHERE id = ?").get(id) as any;
  if (!meeting) return NextResponse.json({ error: "会议不存在" }, { status: 404 });

  // 提交人必须是该会议的参会人
  if (!parseList(meeting.participants).includes(auth.name)) {
    return NextResponse.json({ error: "你不是这场会议的参会人" }, { status: 403 });
  }

  const body = await readJson(req);
  const { content, images } = body;
  if (!content || !String(content).trim()) return NextResponse.json({ error: "请填写心得内容" }, { status: 400 });

  const imgUrls = [...new Set(parseList(images))];
  const result = db.transaction(() => {
    const saved = db.prepare(
    "INSERT INTO meeting_reflections (meeting_id, employee_name, content, images, status) VALUES (?, ?, ?, ?, '已提交')"
  ).run(meeting.id, auth.name, String(content).trim(), JSON.stringify(imgUrls));

    publishBossSubmission(db, "meeting", Number(saved.lastInsertRowid), auth.name, `提交了会议「${meeting.title}」的心得`);
    return saved;
  })();
  logOperation(auth.name, "提交会议心得", "meeting_reflection", String(result.lastInsertRowid), meeting.title);
  return NextResponse.json(db.prepare("SELECT * FROM meeting_reflections WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
}
