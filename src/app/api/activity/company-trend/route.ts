import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { bangkokDayRange } from "@/lib/time";

// 曼谷时区 N 天前的日期（YYYY-MM-DD）
function daysAgo(n: number): string {
  return new Date(Date.now() + 7 * 3600 * 1000 - n * 86400000).toISOString().split("T")[0];
}

// GET /api/activity/company-trend?days=7|30 — 全公司近 N 天每日总操作数（仅管理员）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看" }, { status: 403 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const days = searchParams.get("days") === "30" ? 30 : 7;

  // 近 N 天（含今天），每天全公司总操作数，按日期升序
  const points: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = daysAgo(i);
    const { start, end } = bangkokDayRange(d);
    const count = (db.prepare(
      "SELECT COUNT(*) AS c FROM audit_logs WHERE created_at >= ? AND created_at < ?"
    ).get(start, end) as { c: number }).c;
    points.push({ date: d, count });
  }

  return NextResponse.json({ days, points });
}
