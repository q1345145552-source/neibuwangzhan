import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { bangkokToday, bangkokTimeToUtc } from "@/lib/time";

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
  // 计算该月最后一天
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${month}-${String(lastDay).padStart(2, "0")}`;

  // 统计窗口只算到"今天"（曼谷日历）：过去的月份取整月，当前月取到今天，未来月份为 0 天
  const currentMonth = todayStr.slice(0, 7);
  let elapsedUpToDay: number;
  if (month < currentMonth) elapsedUpToDay = lastDay;
  else if (month > currentMonth) elapsedUpToDay = 0;
  else elapsedUpToDay = Number(todayStr.slice(8, 10));
  const windowEnd = elapsedUpToDay > 0 ? `${month}-${String(elapsedUpToDay).padStart(2, "0")}` : from;

  const results = employees.map((emp) => {
    // 打卡记录
    const attendances = db.prepare(
      "SELECT * FROM attendance WHERE employee_name = ? AND date >= ? AND date <= ?"
    ).all(emp.name, from, to) as any[];

    // 请假审批通过的记录：按与本月窗口的重叠天数计算（此前用 COUNT(*) 把一张 5 天假条算成 1 天）
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

    // 统计
    let totalHours = 0;
    let lateCount = 0;
    let normalDays = 0;
    let supplementDays = 0;

    const seenDates = new Set<string>();

    attendances.forEach((a: any) => {
      seenDates.add(a.date);
      // type='请假' 的打卡记录不再重复累加请假天数（请假天数以 leave_requests 为准）
      if (a.type === "请假") return;
      if (a.type === "补签") supplementDays++;
      else normalDays++;

      if (a.work_hours) totalHours += a.work_hours;
      if (a.check_in) {
        // 正常打卡的 check_in 存的是 UTC，需与"曼谷 09:00"对应的 UTC 时刻比较；
        // 补签记录存的是本地时间字符串，直接与本地 09:00 比较
        const threshold = a.type === "补签" ? `${a.date} 09:00:00` : bangkokTimeToUtc(a.date, "09:00");
        if (a.check_in > threshold) lateCount++;
      }
    });

    // 缺勤：已过工作日 - 有打卡的天数 - 请假天数
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

// 工作日 = 周一至周六（day !== 0，与原实现保持一致；如公司实行五天工作制，把条件改为 day !== 0 && day !== 6）
function getWorkDaysUpTo(year: number, month: number, upToDay: number): number {
  let count = 0;
  for (let d = 1; d <= upToDay; d++) {
    const day = new Date(year, month - 1, d).getDay();
    if (day !== 0) count++;
  }
  return count;
}
