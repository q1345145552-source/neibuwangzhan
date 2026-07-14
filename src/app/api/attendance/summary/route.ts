import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") || new Date().toISOString().slice(0, 7); // YYYY-MM

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

  // 工作日天数（该月周一至周五）
  const workDays = getWorkDays(y, m);

  const results = employees.map((emp) => {
    // 正常打卡记录
    const attendances = db.prepare(
      "SELECT * FROM attendance WHERE employee_name = ? AND date >= ? AND date <= ?"
    ).all(emp.name, from, to) as any[];

    // 请假审批通过的天数
    const leaveDays = db.prepare(
      "SELECT COUNT(*) as cnt FROM leave_requests WHERE employee_name = ? AND status = '已通过' AND start_date <= ? AND end_date >= ?"
    ).get(emp.name, to, from) as any;

    // 统计
    let totalHours = 0;
    let lateCount = 0;
    let absentCount = 0;
    let normalDays = 0;
    let supplementDays = 0;
    let leaveCount = parseInt(String(leaveDays?.cnt || 0));

    const seenDates = new Set<string>();

    attendances.forEach((a: any) => {
      seenDates.add(a.date);
      if (a.type === "请假") {
        leaveCount++;
        return;
      }
      if (a.type === "补签") supplementDays++;
      else normalDays++;

      if (a.work_hours) totalHours += a.work_hours;
      if (a.check_in && a.check_in > `${a.date} 09:00:00`) lateCount++;
    });

    // 缺勤：工作日 - 有打卡的天数 - 请假天数
    const monthStart = new Date(y, m - 1, 1);
    const today = new Date();
    const checkEnd = today < new Date(y, m, 0) ? today : new Date(y, m - 1, lastDay);
    // 只算到今天的已过工作日
    const elapsedWorkDays = getWorkDaysUpTo(y, m, checkEnd.getDate());
    absentCount = Math.max(0, elapsedWorkDays - seenDates.size - leaveCount);

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

function getWorkDays(year: number, month: number): number {
  const lastDay = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= lastDay; d++) {
    const day = new Date(year, month - 1, d).getDay();
    if (day !== 0) count++;
  }
  return count;
}

function getWorkDaysUpTo(year: number, month: number, upToDay: number): number {
  let count = 0;
  for (let d = 1; d <= upToDay; d++) {
    const day = new Date(year, month - 1, d).getDay();
    if (day !== 0) count++;
  }
  return count;
}
