import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// GET /api/todos/:id/follow-ups — 该待办的所有跟进记录（按时间倒序，最新的在上面）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const todo = db.prepare("SELECT assignee FROM todos WHERE id = ?").get(id) as { assignee: string } | undefined;
  if (!todo) return NextResponse.json({ error: "待办不存在" }, { status: 404 });

  // 权限：员工只能看自己的待办跟进，管理员任何
  if (auth.role !== "admin" && auth.name !== todo.assignee) {
    return NextResponse.json({ error: "只能查看自己的待办跟进记录" }, { status: 403 });
  }

  const rows = db.prepare(
    "SELECT * FROM todo_follow_ups WHERE todo_id = ? ORDER BY created_at DESC, id DESC"
  ).all(id);
  return NextResponse.json(rows);
}

// POST /api/todos/:id/follow-ups — 给待办加跟进记录
// 权限：员工只能给自己的待办加；管理员能给任何人的待办加
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const todo = db.prepare("SELECT assignee FROM todos WHERE id = ?").get(id) as { assignee: string } | undefined;
  if (!todo) return NextResponse.json({ error: "待办不存在" }, { status: 404 });

  // 权限：员工只能给自己，管理员任何人
  if (auth.role !== "admin" && auth.name !== todo.assignee) {
    return NextResponse.json({ error: "只能给自己的待办加跟进记录" }, { status: 403 });
  }

  const body = await readJson(req);
  const { content } = body;
  if (!content?.trim()) {
    return NextResponse.json({ error: "请填写跟进内容" }, { status: 400 });
  }

  const result = db.prepare(
    "INSERT INTO todo_follow_ups (todo_id, content, created_by) VALUES (?, ?, ?)"
  ).run(id, content.trim(), auth.name);

  // 负责人本人跟进 = 他自己看过；别人（管理员/老板）跟进则负责人那边会显示「新跟进」未读
  if (auth.name === todo.assignee) {
    db.prepare("UPDATE todos SET seen_at = datetime('now') WHERE id = ?").run(id);
  }

  const followUp = db.prepare("SELECT * FROM todo_follow_ups WHERE id = ?").get(result.lastInsertRowid);
  logOperation(auth.name, "添加待办跟进", "todo", String(id), content.trim());
  return NextResponse.json(followUp, { status: 201 });
}
