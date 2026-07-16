import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const totalOrders = (db.prepare("SELECT COUNT(*) as c FROM orders").get() as { c: number }).c;
  const inProgress = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = '进行中'").get() as { c: number }).c;
  const completed = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = '已完成'").get() as { c: number }).c;

  // 今日待办：当前用户名下所有未完成的步骤数（LIKE 匹配多负责人格式）
  const userName = auth.name || "";
  const likeUser = `%${userName}%`;
  let todayTodos = 0;
  if (userName) {
    try {
      todayTodos = (db.prepare(
        "SELECT COUNT(*) as c FROM order_steps WHERE assignee LIKE ? AND status NOT IN ('已完成','已停止')"
      ).get(likeUser) as { c: number })?.c || 0;
    } catch {
      todayTodos = 0;
    }
  }

  return NextResponse.json({
    total_orders: totalOrders,
    in_progress: inProgress,
    completed: completed,
    today_todos: todayTodos,
  });
}
