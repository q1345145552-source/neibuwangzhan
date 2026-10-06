import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { bangkokDayRange, bangkokWeekRange, bangkokMonthRange, bangkokToday } from "@/lib/time";

// GET /api/todos/stats — 待办看板统计（仅管理员/老板可见）
// 返回：未完成总数（当前），以及今天/本周/本月三个时间范围内的
// 新增待办数、完成待办数、跟进记录条数。时间边界按曼谷时区换算成 UTC 区间。
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看" }, { status: 403 });

  const db = getDb();

  // 未完成：当前所有未完成待办总数（不随时间范围变化）
  const unfinished = (db.prepare("SELECT COUNT(*) AS c FROM todos WHERE status = '未完成'").get() as { c: number }).c;

  // 今天 / 本周 / 本月 的 UTC 半开区间 [start, end)
  const today = bangkokToday();
  const [y, m] = today.split("-").map(Number);
  const dayRange = bangkokDayRange(today);
  const weekRange = bangkokWeekRange();
  const monthRange = bangkokMonthRange(y, m);

  const countBetween = (table: string, col: string, range: { start: string; end: string }) => {
    const row = db.prepare(
      `SELECT COUNT(*) AS c FROM ${table} WHERE ${col} >= ? AND ${col} < ?`
    ).get(range.start, range.end) as { c: number };
    return row.c;
  };

  const statsFor = (range: { start: string; end: string }) => ({
    created: countBetween("todos", "created_at", range),
    completed: countBetween("todos", "completed_at", range),
    followups: countBetween("todo_follow_ups", "created_at", range),
  });

  return NextResponse.json({
    unfinished,
    today: statsFor(dayRange),
    week: statsFor(weekRange),
    month: statsFor(monthRange),
  });
}
