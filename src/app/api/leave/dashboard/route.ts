import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  // 仅管理员可查看板数据
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const db = getDb();
  const today = new Date().toISOString().split("T")[0];

  // 今天在请假的员工（已通过且日期区间覆盖今天）
  const todayOnLeave = db.prepare(
    "SELECT employee_name, leave_type, start_date, end_date FROM leave_requests WHERE status = '已通过' AND start_date <= ? AND end_date >= ? ORDER BY employee_name"
  ).all(today, today) as { employee_name: string; leave_type: string; start_date: string; end_date: string }[];

  // 待审批数量
  const pendingCount = (db.prepare("SELECT COUNT(*) as cnt FROM leave_requests WHERE status = '待审批'").get() as any).cnt;

  // 最近请假记录（近30天）
  const recent = db.prepare(
    "SELECT * FROM leave_requests WHERE created_at >= datetime('now', '-30 days') ORDER BY created_at DESC LIMIT 10"
  ).all();

  return NextResponse.json({ todayOnLeave, pendingCount, recent });
}
