import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listMySteps } from "@/lib/my-steps";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const db = getDb();
  const totalOrders = (db.prepare("SELECT COUNT(*) as c FROM orders").get() as { c: number }).c;
  const inProgress = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = '进行中'").get() as { c: number }).c;
  const completed = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = '已完成'").get() as { c: number }).c;
  const canceled = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = '客户取消'").get() as { c: number }).c;

  // 今日待办：我名下现在就能动手的环节（前一步已做完、单子没取消；没写经办人的步骤算订单负责人的），与「我的环节」同一口径
  const userName = auth.name || "";
  let todayTodos = 0;
  if (userName) {
    try {
      todayTodos = listMySteps(db, userName).filter((s) => s.can_start).length;
    } catch {
      todayTodos = 0;
    }
  }

  return NextResponse.json({
    total_orders: totalOrders,
    in_progress: inProgress,
    completed: completed,
    canceled: canceled,
    today_todos: todayTodos,
  });
}
