import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

const PHASES = ["构思", "执行", "里程碑", "收益"];

// PATCH /api/projects/:id — 切换项目阶段
// 权限：老板(管理员)或负责人
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const project = db.prepare("SELECT assignee, current_phase FROM projects WHERE id = ?").get(id) as { assignee: string; current_phase: string } | undefined;
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  // 权限：老板或负责人
  if (auth.role !== "admin" && auth.name !== project.assignee) {
    return NextResponse.json({ error: "只有老板或负责人能切换阶段" }, { status: 403 });
  }

  const body = await readJson(req);
  const { phase } = body;
  if (!phase || !PHASES.includes(phase)) {
    return NextResponse.json({ error: "无效的阶段" }, { status: 400 });
  }

  db.prepare(
    "UPDATE projects SET current_phase = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(phase, id);
  logOperation(auth.name, "切换项目阶段", "project", String(id), phase);

  const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return NextResponse.json(updated);
}
