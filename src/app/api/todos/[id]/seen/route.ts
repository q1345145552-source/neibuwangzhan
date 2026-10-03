import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

// POST /api/todos/:id/seen — 把待办标记为已看过（设置 seen_at）
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

  // 权限：员工只能标记自己的待办，管理员任何人
  if (auth.role !== "admin" && auth.name !== todo.assignee) {
    return NextResponse.json({ error: "只能操作自己的待办" }, { status: 403 });
  }

  db.prepare("UPDATE todos SET seen_at = datetime('now') WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
