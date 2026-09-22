import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation, notifyAdmins } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// POST /api/problems/:id/follow-ups — 添加跟进记录（仅负责人或管理员）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const problem = db.prepare("SELECT assignee, problem_number FROM problems WHERE id = ?").get(id) as { assignee: string; problem_number: string } | undefined;
  if (!problem) return NextResponse.json({ error: "问题不存在" }, { status: 404 });

  // 只有负责人和管理员能添加跟进记录
  if (auth.role !== "admin" && auth.name !== problem.assignee) {
    return NextResponse.json({ error: "只有负责人或管理员能添加跟进记录" }, { status: 403 });
  }

  const body = await readJson(req);
  const { content } = body;
  if (!content?.trim()) return NextResponse.json({ error: "请填写跟进内容" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO problem_follow_ups (problem_id, content, created_by) VALUES (?, ?, ?)"
  ).run(id, content.trim(), auth.name);

  const followUp = db.prepare("SELECT * FROM problem_follow_ups WHERE id = ?").get(result.lastInsertRowid);
  logOperation(auth.name, "添加问题跟进", "problem", String(id), content.trim());

  // 通知联动：有新跟进记录时自动通知老板
  notifyAdmins(
    "problem_followup",
    "问题新跟进",
    `问题 ${problem.problem_number} 有新的跟进记录：${content.trim()}`,
    String(id),
    "problem"
  );

  return NextResponse.json(followUp, { status: 201 });
}
