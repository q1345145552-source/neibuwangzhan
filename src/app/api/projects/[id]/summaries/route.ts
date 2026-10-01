import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

const PHASES = ["构思", "执行", "里程碑", "收益"];

// POST /api/projects/:id/summaries — 写项目阶段总结
// 权限：老板(管理员)或负责人
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const project = db.prepare("SELECT assignee FROM projects WHERE id = ?").get(id) as { assignee: string } | undefined;
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  // 权限：老板或负责人
  if (auth.role !== "admin" && auth.name !== project.assignee) {
    return NextResponse.json({ error: "只有老板或负责人能写总结" }, { status: 403 });
  }

  const body = await readJson(req);
  const { phase, conclusion, lesson, adjustment } = body;

  if (!phase || !PHASES.includes(phase)) {
    return NextResponse.json({ error: "请选择阶段" }, { status: 400 });
  }
  if (!conclusion?.trim() && !lesson?.trim() && !adjustment?.trim()) {
    return NextResponse.json({ error: "请填写总结内容" }, { status: 400 });
  }

  const result = db.prepare(
    "INSERT INTO project_summaries (project_id, phase, conclusion, lesson, adjustment, created_by) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, phase, conclusion?.trim() || "", lesson?.trim() || "", adjustment?.trim() || "", auth.name);

  const summary = db.prepare("SELECT * FROM project_summaries WHERE id = ?").get(result.lastInsertRowid);
  logOperation(auth.name, "写项目总结", "project", String(id), phase);
  return NextResponse.json(summary, { status: 201 });
}
