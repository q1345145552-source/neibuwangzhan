import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// GET /api/projects — 项目列表（仅老板/管理员）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅老板或管理员可查看" }, { status: 403 });

  const db = getDb();
  const rows = db.prepare("SELECT * FROM projects ORDER BY created_at DESC, id DESC").all();
  return NextResponse.json(rows);
}

// POST /api/projects — 创建项目（仅老板）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅老板能创建项目" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const { name, description, assignee } = body;

  // 项目名称必填
  if (!name?.trim()) {
    return NextResponse.json({ error: "请填写项目名称" }, { status: 400 });
  }

  const result = db.prepare(
    "INSERT INTO projects (name, description, assignee, current_phase, status, created_by) VALUES (?, ?, ?, '构思', '孵化中', ?)"
  ).run(name.trim(), description?.trim() || "", assignee?.trim() || "", auth.name);

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(result.lastInsertRowid);
  logOperation(auth.name, "创建项目", "project", String(result.lastInsertRowid), name.trim());
  return NextResponse.json(project, { status: 201 });
}
