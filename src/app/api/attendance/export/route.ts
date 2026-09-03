import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { bangkokToday, bangkokLastDayOfMonth, toThaiTimeOnly, bangkokTimeToUtc } from "@/lib/time";
import * as XLSX from "xlsx";

// GET /api/attendance/export?type=detail|summary&month=YYYY-MM
// 仅管理员可导出（员工不可见按钮、也无法调用此接口）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可导出" }, { status: 403 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "detail";
  const month = searchParams.get("month") || bangkokToday().slice(0, 7); // YYYY-MM

  const [y, m] = month.split("-").map(Number);
  const lastDay = bangkokLastDayOfMonth(y, m);
  const from = `${month}-01`;
  const to = `${month}-${String(lastDay).padStart(2, "0")}`;

  // 与考勤月度汇总一致的员工范围（排除 Pop、张三，且不含客户角色）
  const employees = db.prepare(
    "SELECT name FROM employees WHERE role IN ('admin','employee') AND name NOT IN ('Pop','张三') ORDER BY name"
  ).all() as { name: string }[];

  const isSummary = type === "summary";
  const header = isSummary
    ? ["员工", "总出勤天数", "迟到次数", "请假天数", "病假天数", "事假天数"]
    : ["员工", "日期", "签到时间", "签退时间", "工作小时数", "请假类型"];

  const rows = isSummary
    ? buildSummaryRows(db, employees, month, y, m, from, to, lastDay)
    : buildDetailRows(db, employees, month, from, to, lastDay);

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, isSummary ? "月度汇总" : "明细");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new Uint8Array(buf);

  const filename = isSummary
    ? `attendance_summary_${month}.xlsx`
    : `attendance_detail_${month}.xlsx`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/** 明细导出：每个员工每一天一行（签到/签退/工时/请假类型） */
function buildDetailRows(
  db: ReturnType<typeof getDb>,
  employees: { name: string }[],
  month: string,
  from: string,
  to: string,
  lastDay: number
): (string | number)[][] {
  const attMap = new Map<string, any>();
  const atts = db.prepare(
    "SELECT employee_name, date, check_in, check_out, work_hours, type FROM attendance WHERE date >= ? AND date <= ?"
  ).all(from, to) as any[];
  for (const a of atts) attMap.set(`${a.employee_name}|${a.date}`, a);

  const leaveMap = new Map<string, string>();
  const leaves = db.prepare(
    "SELECT employee_name, leave_type, start_date, end_date FROM leave_requests WHERE status = '已通过' AND start_date <= ? AND end_date >= ?"
  ).all(to, from) as any[];
  for (const l of leaves) {
    for (let d = new Date(l.start_date + "T00:00:00Z"); d <= new Date(l.end_date + "T00:00:00Z"); d = new Date(d.getTime() + 86400000)) {
      const date = d.toISOString().split("T")[0];
      if (date < from || date > to) continue;
      leaveMap.set(`${l.employee_name}|${date}`, l.leave_type);
    }
  }

  const rows: (string | number)[][] = [];
  for (const emp of employees) {
    for (let day = 1; day <= lastDay; day++) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const att = attMap.get(`${emp.name}|${date}`);
      const leaveType = leaveMap.get(`${emp.name}|${date}`);
      rows.push([
        emp.name,
        date,
        att?.check_in ? toThaiTimeOnly(att.check_in) : "",
        att?.check_out ? toThaiTimeOnly(att.check_out) : "",
        att?.check_in ? (typeof att.work_hours === "number" ? att.work_hours : "") : "",
        leaveType || (att?.type === "请假" ? "请假" : ""),
      ]);
    }
  }
  return rows;
}

/** 汇总导出：每个员工一行（出勤天数/迟到/请假天数/病假/事假），口径与考勤月度汇总一致 */
function buildSummaryRows(
  db: ReturnType<typeof getDb>,
  employees: { name: string }[],
  month: string,
  y: number,
  m: number,
  from: string,
  to: string,
  lastDay: number
): (string | number)[][] {
  const todayStr = bangkokToday();
  const currentMonth = todayStr.slice(0, 7);
  let elapsedUpToDay: number;
  if (month < currentMonth) elapsedUpToDay = lastDay;
  else if (month > currentMonth) elapsedUpToDay = 0;
  else elapsedUpToDay = Number(todayStr.slice(8, 10));
  const windowEnd = elapsedUpToDay > 0 ? `${month}-${String(elapsedUpToDay).padStart(2, "0")}` : from;

  const rows: (string | number)[][] = [];
  for (const emp of employees) {
    const attendances = db.prepare(
      "SELECT * FROM attendance WHERE employee_name = ? AND date >= ? AND date <= ?"
    ).all(emp.name, from, to) as any[];

    const leaveRows = db.prepare(
      "SELECT leave_type, start_date, end_date FROM leave_requests WHERE employee_name = ? AND status = '已通过' AND start_date <= ? AND end_date >= ?"
    ).all(emp.name, windowEnd, from) as { leave_type: string; start_date: string; end_date: string }[];

    let leaveCount = 0;
    let sickDays = 0;
    let personalDays = 0;
    for (const lr of leaveRows) {
      const s = lr.start_date > from ? lr.start_date : from;
      const e = lr.end_date < windowEnd ? lr.end_date : windowEnd;
      if (e >= s) {
        const days = Math.floor((new Date(e).getTime() - new Date(s).getTime()) / 86400000) + 1;
        leaveCount += days;
        if (lr.leave_type === "病假") sickDays += days;
        else if (lr.leave_type === "事假") personalDays += days;
      }
    }

    let normalDays = 0;
    let supplementDays = 0;
    let lateCount = 0;
    for (const a of attendances) {
      if (a.type === "请假") continue;
      if (a.type === "补签") supplementDays++;
      else normalDays++;
      if (a.check_in) {
        const threshold = a.type === "补签" ? `${a.date} 09:00:00` : bangkokTimeToUtc(a.date, "09:00");
        if (a.check_in > threshold) lateCount++;
      }
    }

    rows.push([
      emp.name,
      normalDays + supplementDays,
      lateCount,
      leaveCount,
      sickDays,
      personalDays,
    ]);
  }
  return rows;
}
