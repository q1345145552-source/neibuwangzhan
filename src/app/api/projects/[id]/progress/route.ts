import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// POST /api/projects/:id/progress — 写项目进展
// 权限：老板(管理员)或负责人
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const project = db.prepare("SELECT assignee FROM projects WHERE id = ?").get(id) as { assignee: string } | undefined;
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  // 权限：老板或负责人
  if (auth.role !== "admin" && auth.name !== project.assignee) {
    return NextResponse.json({ error: "只有老板或负责人能写进展" }, { status: 403 });
  }

  const body = await readJson(req);
  const { content } = body;
  if (!content?.trim()) {
    return NextResponse.json({ error: "请填写进展内容" }, { status: 400 });
  }

  const result = db.prepare(
    "INSERT INTO project_progress (project_id, content, created_by) VALUES (?, ?, ?)"
  ).run(id, content.trim(), auth.name);

  const progress = db.prepare("SELECT * FROM project_progress WHERE id = ?").get(result.lastInsertRowid);
  logOperation(auth.name, "更新项目进展", "project", String(id), content.trim());
  return NextResponse.json(progress, { status: 201 });
}
