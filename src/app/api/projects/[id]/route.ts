import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

const PHASES = ["构思", "执行", "里程碑", "收益"];

// GET /api/projects/:id — 项目详情（含完整进展历史 + 各阶段总结）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅老板或管理员可查看" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  const progress = db.prepare(
    "SELECT * FROM project_progress WHERE project_id = ? ORDER BY created_at DESC, id DESC"
  ).all(id);
  const summaries = db.prepare(
    "SELECT * FROM project_summaries WHERE project_id = ? ORDER BY created_at DESC, id DESC"
  ).all(id);

  return NextResponse.json({ ...(project as object), progress, summaries });
}

// PATCH /api/projects/:id — 切换阶段（老板/负责人）或升级为业务线（仅老板）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const project = db.prepare("SELECT assignee, status FROM projects WHERE id = ?").get(id) as { assignee: string; status: string } | undefined;
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  const body = await readJson(req);
  const { phase, status } = body;

  // 升级为业务线：只有老板能点
  if (status === "已孵化为业务线") {
    if (auth.role !== "admin") {
      return NextResponse.json({ error: "只有老板能升级为业务线" }, { status: 403 });
    }
    db.prepare(
      "UPDATE projects SET status = '已孵化为业务线', updated_at = datetime('now') WHERE id = ?"
    ).run(id);
    logOperation(auth.name, "项目升级为业务线", "project", String(id));
    const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return NextResponse.json(updated);
  }

  // 切换阶段：老板或负责人
  if (auth.role !== "admin" && auth.name !== project.assignee) {
    return NextResponse.json({ error: "只有老板或负责人能切换阶段" }, { status: 403 });
  }
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
