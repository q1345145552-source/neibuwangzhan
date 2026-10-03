import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

const MONTH_RE = /^\d{4}-\d{2}$/;

// 法定假日额度（每月固定天数，用于算应出勤）
const HOLIDAY_QUOTA: Record<number, number> = {
  1: 1, 2: 1, 3: 0, 4: 3, 5: 2, 6: 0, 7: 2, 8: 1, 9: 0, 10: 1, 11: 0, 12: 1,
};

// 曼谷时间 08:00 后打卡算迟到，返回迟到分钟数（浮点）
function lateMinutesFromUtc(utcStr: string): number {
  const m = (utcStr || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const utcMs = Date.UTC(y, mo - 1, d, h, mi, s);
  const bkk = new Date(utcMs + 7 * 3600 * 1000);
  const bkkMinutes = bkk.getUTCHours() * 60 + bkk.getUTCMinutes() + bkk.getUTCSeconds() / 60;
  const late = bkkMinutes - 8 * 60;
  return late > 0 ? late : 0;
}

// 曼谷时间 17:00 前签退算早退，返回早退分钟数（浮点）
function earlyMinutesFromUtc(utcStr: string): number {
  const m = (utcStr || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const utcMs = Date.UTC(y, mo - 1, d, h, mi, s);
  const bkk = new Date(utcMs + 7 * 3600 * 1000);
  const bkkMinutes = bkk.getUTCHours() * 60 + bkk.getUTCMinutes() + bkk.getUTCSeconds() / 60;
  const early = 17 * 60 - bkkMinutes;
  return early > 0 ? early : 0;
}

// 当月天数（YYYY-MM → 该月有多少天）
function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// 当月周日（单休日）的天数
function sundayCount(month: string): number {
  const [y, m] = month.split("-").map(Number);
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let count = 0;
  for (let d = 1; d <= total; d++) {
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0) count++;
  }
  return count;
}

// HH:MM 之间的小时数（跨天自动加 24h）
function hoursBetween(start: string, end: string): number {
  const [sh, sm] = (start || "09:00").split(":").map(Number);
  const [eh, em] = (end || "17:00").split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

// 两个日期之间的天数（含头尾）
function daysBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return 1;
  return Math.round((e - s) / 86400000) + 1;
}

const FIELDS = "id, employee_id, employee_name, month, attendance_days, expected_days, late_details, early_details, leave_details, work_hours, absence_days";

// GET /api/attendance/summaries?month=YYYY-MM — 某月考勤汇总列表（仅管理员）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const month = new URL(req.url).searchParams.get("month") || "";

  if (auth.role === "admin") {
    if (!MONTH_RE.test(month)) return NextResponse.json({ error: "月份格式不正确" }, { status: 400 });
    const rows = db.prepare(`SELECT ${FIELDS} FROM attendance_summaries WHERE month = ? ORDER BY employee_name ASC, id ASC`).all(month);
    return NextResponse.json(rows);
  }

  // 员工只看自己的考勤汇总
  if (month && MONTH_RE.test(month)) {
    const rows = db.prepare(`SELECT ${FIELDS} FROM attendance_summaries WHERE employee_name = ? AND month = ? ORDER BY month DESC, id DESC`).all(auth.name, month);
    return NextResponse.json(rows);
  }
  const rows = db.prepare(`SELECT ${FIELDS} FROM attendance_summaries WHERE employee_name = ? ORDER BY month DESC, id DESC`).all(auth.name);
  return NextResponse.json(rows);
}

// POST /api/attendance/summaries — 生成某月考勤汇总（仅管理员）：统计出勤/迟到/早退/工作时间/缺勤/请假，存库
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const month = String(body?.month || "").trim();
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: "月份格式不正确" }, { status: 400 });

  const employees = db.prepare(
    "SELECT id, name FROM employees WHERE status = '在职' AND role != 'client' AND (hire_date = '' OR hire_date <= ?) ORDER BY name"
  ).all(`${month}-31`) as { id: number; name: string }[];

  // 应出勤天数 = 当月天数 - 周日数 - 法定假日额度
  const monthNumber = Number(month.split("-")[1]);
  const expectedDays = daysInMonth(month) - sundayCount(month) - (HOLIDAY_QUOTA[monthNumber] ?? 0);

  let created = 0;
  db.transaction(() => {
    for (const e of employees) {
      // 出勤天数 + 迟到明细 + 早退明细 + 工作时间（同一批打卡记录）
      const attRows = db.prepare(
        "SELECT date, check_in, check_out, work_hours FROM attendance WHERE employee_name = ? AND date LIKE ? AND check_in != '' ORDER BY date"
      ).all(e.name, `${month}%`) as { date: string; check_in: string; check_out: string; work_hours: number }[];
      const attendanceDays = attRows.length;
      const lateDetails: { date: string; minutes: number }[] = [];
      const earlyDetails: { date: string; minutes: number }[] = [];
      let workHours = 0;
      for (const a of attRows) {
        const lm = lateMinutesFromUtc(a.check_in);
        if (lm > 0) lateDetails.push({ date: a.date, minutes: Math.round(lm * 10) / 10 });
        const em = earlyMinutesFromUtc(a.check_out);
        if (em > 0) earlyDetails.push({ date: a.date, minutes: Math.round(em * 10) / 10 });
        workHours += Number(a.work_hours) || 0;
      }
      workHours = Math.round(workHours * 10) / 10;

      // 请假明细（已通过、开始日期在该月）
      const leaveRows = db.prepare(
        "SELECT leave_type, start_date, end_date, start_time, end_time, images FROM leave_requests WHERE employee_name = ? AND status = '已通过' AND start_date LIKE ? ORDER BY start_date"
      ).all(e.name, `${month}%`) as { leave_type: string; start_date: string; end_date: string; start_time: string; end_time: string; images: string }[];
      const leaveDetails: { type: string; days: number; hours: number; has_certificate: boolean; images: string[] }[] = [];
      let leaveDays = 0;
      for (const l of leaveRows) {
        const days = daysBetween(l.start_date, l.end_date);
        const hours = days === 1 ? hoursBetween(l.start_time, l.end_time) : days * 8;
        const images = (() => { try { const a = JSON.parse(l.images || "[]"); return Array.isArray(a) ? a.filter((x: unknown) => x && String(x).trim()) : []; } catch { return []; } })();
        leaveDetails.push({
          type: l.leave_type,
          days,
          hours: Math.round(hours * 10) / 10,
          has_certificate: l.leave_type === "病假" && images.length > 0,
          images,
        });
        leaveDays += days;
      }

      // 缺勤 = 应出勤 - 实际出勤 - 请假天数；负数按 0
      const absenceDays = Math.max(0, expectedDays - attendanceDays - leaveDays);

      const lateJson = JSON.stringify(lateDetails);
      const earlyJson = JSON.stringify(earlyDetails);
      const leaveJson = JSON.stringify(leaveDetails);
      const existing = db.prepare("SELECT id FROM attendance_summaries WHERE employee_id = ? AND month = ?").get(e.id, month);
      if (existing) {
        db.prepare(
          "UPDATE attendance_summaries SET employee_name = ?, attendance_days = ?, expected_days = ?, late_details = ?, early_details = ?, leave_details = ?, work_hours = ?, absence_days = ? WHERE employee_id = ? AND month = ?"
        ).run(e.name, attendanceDays, expectedDays, lateJson, earlyJson, leaveJson, workHours, absenceDays, e.id, month);
      } else {
        db.prepare(
          "INSERT INTO attendance_summaries (employee_id, employee_name, month, attendance_days, expected_days, late_details, early_details, leave_details, work_hours, absence_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(e.id, e.name, month, attendanceDays, expectedDays, lateJson, earlyJson, leaveJson, workHours, absenceDays);
        created++;
      }
    }
  })();

  logOperation(auth.name, "生成考勤汇总", "attendance_summary", month, `生成 ${created} 份`);

  const summaries = db.prepare(`SELECT ${FIELDS} FROM attendance_summaries WHERE month = ? ORDER BY employee_name ASC, id ASC`).all(month);
  return NextResponse.json({ created, summaries });
}
