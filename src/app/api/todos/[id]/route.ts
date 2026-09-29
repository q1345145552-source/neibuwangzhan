import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// PATCH /api/todos/:id — 标记完成 / 恢复未完成
// 权限：员工只能标记自己的待办，管理员能标记任何人的
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const todo = db.prepare("SELECT assignee FROM todos WHERE id = ?").get(id) as { assignee: string } | undefined;
  if (!todo) return NextResponse.json({ error: "待办不存在" }, { status: 404 });

  // 权限：员工标记自己，管理员任何人
  if (auth.role !== "admin" && auth.name !== todo.assignee) {
    return NextResponse.json({ error: "只能标记自己的待办完成" }, { status: 403 });
  }

  const body = await readJson(req);
  const { status } = body;

  if (status === "已完成") {
    db.prepare(
      "UPDATE todos SET status = '已完成', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(id);
    logOperation(auth.name, "标记待办完成", "todo", String(id));
  } else if (status === "未完成") {
    db.prepare(
      "UPDATE todos SET status = '未完成', completed_at = '', updated_at = datetime('now') WHERE id = ?"
    ).run(id);
    logOperation(auth.name, "待办恢复未完成", "todo", String(id));
  } else {
    return NextResponse.json({ error: "无效的状态" }, { status: 400 });
  }

  const updated = db.prepare("SELECT * FROM todos WHERE id = ?").get(id);
  return NextResponse.json(updated);
}
