import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const totalOrders = (db.prepare("SELECT COUNT(*) as c FROM orders").get() as { c: number }).c;
  const inProgress = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = '进行中'").get() as { c: number }).c;
  const completed = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = '已完成'").get() as { c: number }).c;
  const todayTodos = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE status IN ('待处理','进行中')").get() as { c: number }).c;

  return NextResponse.json({
    total_orders: totalOrders,
    in_progress: inProgress,
    completed: completed,
    today_todos: todayTodos,
  });
}
