import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { bangkokToday } from "@/lib/time";

const WARN_DAYS = 30;

function daysUntil(dateStr: string, today: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`).getTime();
  const t = new Date(`${today}T00:00:00Z`).getTime();
  if (Number.isNaN(d) || Number.isNaN(t)) return Number.NaN;
  return Math.round((d - t) / 86400000);
}

// GET /api/internal/expiry-alerts — 工作证/签证到期提醒（仅管理员）
// 返回快到期（30 天内）和已过期的员工证照，按「已过期优先、剩余天数少优先」排序。
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const today = bangkokToday();

  const rows = db.prepare(
    "SELECT name, work_permit_expiry, visa_expiry FROM employees WHERE role = 'employee' AND status = '在职' AND (work_permit_expiry != '' OR visa_expiry != '')"
  ).all() as { name: string; work_permit_expiry: string; visa_expiry: string }[];

  const alerts: { employee_name: string; label: string; date: string; days_left: number; expired: boolean }[] = [];

  for (const e of rows) {
    for (const [label, date] of [["工作证", e.work_permit_expiry], ["签证", e.visa_expiry]] as [string, string][]) {
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const days = daysUntil(date, today);
      if (Number.isNaN(days)) continue;
      if (days < 0) {
        alerts.push({ employee_name: e.name, label, date, days_left: Math.abs(days), expired: true });
      } else if (days <= WARN_DAYS) {
        alerts.push({ employee_name: e.name, label, date, days_left: days, expired: false });
      }
    }
  }

  alerts.sort((a, b) => {
    if (a.expired !== b.expired) return a.expired ? -1 : 1; // 已过期排前面
    return a.days_left - b.days_left; // 剩余天数少的排前面
  });

  return NextResponse.json(alerts);
}
