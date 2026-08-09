import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { bangkokToday } from "@/lib/time";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const today = bangkokToday();
  const monthPrefix = today.slice(0, 7);

  // ── 今日请假 ──
  const todayOnLeave = db.prepare(
    "SELECT employee_name, leave_type, start_date, end_date FROM leave_requests WHERE status = '已通过' AND start_date <= ? AND end_date >= ? ORDER BY employee_name"
  ).all(today, today) as { employee_name: string; leave_type: string; start_date: string; end_date: string }[];

  // ── 待审批 ──
  const pendingCount = (db.prepare("SELECT COUNT(*) as cnt FROM leave_requests WHERE status = '待审批'").get() as any).cnt;
  const pendingList = db.prepare(
    "SELECT employee_name, leave_type, start_date, end_date, created_at FROM leave_requests WHERE status = '待审批' ORDER BY created_at DESC LIMIT 10"
  ).all() as any[];

  // ── 当月统计：每人请了多少次 + 各类型次数 + 总天数 ──
  const monthLeaves = db.prepare(
    "SELECT employee_name, leave_type, start_date, end_date FROM leave_requests WHERE status = '已通过' AND start_date LIKE ? ORDER BY employee_name"
  ).all(monthPrefix + "%") as { employee_name: string; leave_type: string; start_date: string; end_date: string }[];

  const employeeMonth: Record<string, { sick: number; personal: number; annual: number; other: number; totalDays: number; leaves: any[] }> = {};
  for (const l of monthLeaves) {
    if (!employeeMonth[l.employee_name]) {
      employeeMonth[l.employee_name] = { sick: 0, personal: 0, annual: 0, other: 0, totalDays: 0, leaves: [] };
    }
    const e = employeeMonth[l.employee_name];
    const days = Math.round(
      (new Date(l.end_date + "T00:00:00").getTime() - new Date(l.start_date + "T00:00:00").getTime()) / 86400000
    ) + 1;
    e.totalDays += days;
    if (l.leave_type === "病假") e.sick++;
    else if (l.leave_type === "事假") e.personal++;
    else if (l.leave_type === "年假") e.annual++;
    else e.other++;
    e.leaves.push({ leave_type: l.leave_type, start_date: l.start_date, end_date: l.end_date, days });
  }

  const monthStats = Object.entries(employeeMonth)
    .map(([name, s]) => ({ employee_name: name, ...s }))
    .sort((a, b) => b.totalDays - a.totalDays);

  // ── 病假排行 ──
  const sickLeaders = monthStats
    .filter(s => s.sick > 0)
    .sort((a, b) => b.sick - a.sick);

  // ── 拼假嫌疑（当月已通过的病假，跨/贴法定假日） ──
  const holidays = db.prepare("SELECT date, name FROM thai_holidays WHERE date LIKE ? ORDER BY date").all(monthPrefix + "%") as { date: string; name: string }[];
  const bridgeSuspects: { employee_name: string; start_date: string; end_date: string; holidays: { date: string; name: string }[] }[] = [];
  const approvedSick = db.prepare(
    "SELECT employee_name, leave_type, start_date, end_date FROM leave_requests WHERE status = '已通过' AND leave_type = '病假' AND start_date LIKE ?"
  ).all(monthPrefix + "%") as { employee_name: string; leave_type: string; start_date: string; end_date: string }[];

  for (const l of approvedSick) {
    const s = new Date(l.start_date + "T00:00:00+07:00");
    const e = new Date(l.end_date + "T00:00:00+07:00");
    const extS = new Date(s); extS.setDate(s.getDate() - 1);
    const extE = new Date(e); extE.setDate(e.getDate() + 1);
    const hits = holidays.filter(h => {
      const hd = new Date(h.date + "T00:00:00+07:00");
      return hd >= extS && hd <= extE;
    });
    if (hits.length > 0) {
      bridgeSuspects.push({ employee_name: l.employee_name, start_date: l.start_date, end_date: l.end_date, holidays: hits });
    }
  }

  return NextResponse.json({
    todayOnLeave,
    pendingCount,
    pendingList,
    monthStats,
    sickLeaders,
    bridgeSuspects,
  });
}
