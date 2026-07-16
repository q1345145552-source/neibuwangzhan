import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { bangkokToday, bangkokTimeToUtc, bangkokLastDayOfMonth, bangkokDayOfWeek, bangkokMonthKey } from "@/lib/time";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const todayStr = bangkokToday(); // 业务时区（曼谷）的今天
  const month = searchParams.get("month") || todayStr.slice(0, 7); // YYYY-MM

  // 获取所有员工或当前员工
  let employees: { name: string }[];
  if (auth.role === "admin") {
    const empName = searchParams.get("employee");
    if (empName) {
      employees = [{ name: empName }];
    } else {
      employees = db.prepare("SELECT name FROM employees WHERE role IN ('admin','employee')").all() as any[];
    }
  } else {
    employees = [{ name: auth.name }];
  }

  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const lastDay = bangkokLastDayOfMonth(y, m);
  const to = `${month}-${String(lastDay).padStart(2, "0")}`;

  // 统计窗口只算到"今天"（曼谷日历）
  const currentMonth = todayStr.slice(0, 7);
  let elapsedUpToDay: number;
  if (month < currentMonth) elapsedUpToDay = lastDay;
  else if (month > currentMonth) elapsedUpToDay = 0;
  else elapsedUpToDay = Number(todayStr.slice(8, 10));
  const windowEnd = elapsedUpToDay > 0 ? `${month}-${String(elapsedUpToDay).padStart(2, "0")}` : from;

  const results = employees.map((emp) => {
    const attendances = db.prepare(
      "SELECT * FROM attendance WHERE employee_name = ? AND date >= ? AND date <= ?"
    ).all(emp.name, from, to) as any[];

    const leaveRows = db.prepare(
      "SELECT start_date, end_date FROM leave_requests WHERE employee_name = ? AND status = '已通过' AND start_date <= ? AND end_date >= ?"
    ).all(emp.name, windowEnd, from) as { start_date: string; end_date: string }[];
    let leaveCount = 0;
    for (const lr of leaveRows) {
      const s = lr.start_date > from ? lr.start_date : from;
      const e = lr.end_date < windowEnd ? lr.end_date : windowEnd;
      if (e >= s) {
        leaveCount += Math.floor((new Date(e).getTime() - new Date(s).getTime()) / 86400000) + 1;
      }
    }

    let totalHours = 0;
    let lateCount = 0;
    let normalDays = 0;
    let supplementDays = 0;

    const seenDates = new Set<string>();

    attendances.forEach((a: any) => {
      seenDates.add(a.date);
      if (a.type === "请假") return;
      if (a.type === "补签") supplementDays++;
      else normalDays++;

      if (a.work_hours) totalHours += a.work_hours;
      if (a.check_in) {
        const threshold = a.type === "补签" ? `${a.date} 09:00:00` : bangkokTimeToUtc(a.date, "09:00");
        if (a.check_in > threshold) lateCount++;
      }
    });

    const elapsedWorkDays = getWorkDaysUpTo(y, m, elapsedUpToDay);
    const absentCount = Math.max(0, elapsedWorkDays - seenDates.size - leaveCount);

    return {
      name: emp.name,
      month,
      totalHours: Math.round(totalHours * 100) / 100,
      lateCount,
      absentCount,
      leaveCount,
      normalDays,
      supplementDays,
      workDays: elapsedWorkDays,
    };
  });

  return NextResponse.json(results);
}

// 工作日 = 周一至周六（周日休息），按曼谷日历计算
function getWorkDaysUpTo(year: number, month: number, upToDay: number): number {
  let count = 0;
  for (let d = 1; d <= upToDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (bangkokDayOfWeek(dateStr) !== 0) count++;
  }
  return count;
}
