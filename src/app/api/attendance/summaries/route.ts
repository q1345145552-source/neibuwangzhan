import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

const MONTH_RE = /^\d{4}-\d{2}$/;

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

function hasImages(imagesJson: string): boolean {
  try {
    const arr = JSON.parse(imagesJson || "[]");
    return Array.isArray(arr) && arr.length > 0;
  } catch {
    return false;
  }
}

const FIELDS = "id, employee_id, employee_name, month, attendance_days, late_details, leave_details";

// GET /api/attendance/summaries?month=YYYY-MM — 某月考勤汇总列表（仅管理员）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const month = new URL(req.url).searchParams.get("month") || "";
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: "月份格式不正确" }, { status: 400 });

  const db = getDb();
  const rows = db.prepare(`SELECT ${FIELDS} FROM attendance_summaries WHERE month = ? ORDER BY employee_name ASC, id ASC`).all(month);
  return NextResponse.json(rows);
}

// POST /api/attendance/summaries — 生成某月考勤汇总（仅管理员）：统计出勤天数/迟到明细/请假明细，存库
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const month = String(body?.month || "").trim();
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: "月份格式不正确" }, { status: 400 });

  const employees = db.prepare(
    "SELECT id, name FROM employees WHERE status = '在职' AND role != 'client' ORDER BY name"
  ).all() as { id: number; name: string }[];

  let created = 0;
  db.transaction(() => {
    for (const e of employees) {
      // 出勤天数 + 迟到明细
      const attRows = db.prepare(
        "SELECT date, check_in FROM attendance WHERE employee_name = ? AND date LIKE ? AND check_in != '' ORDER BY date"
      ).all(e.name, `${month}%`) as { date: string; check_in: string }[];
      const attendanceDays = attRows.length;
      const lateDetails: { date: string; minutes: number }[] = [];
      for (const a of attRows) {
        const minutes = lateMinutesFromUtc(a.check_in);
        if (minutes > 0) lateDetails.push({ date: a.date, minutes: Math.round(minutes * 10) / 10 });
      }

      // 请假明细（已通过、开始日期在该月）
      const leaveRows = db.prepare(
        "SELECT leave_type, start_date, end_date, start_time, end_time, images FROM leave_requests WHERE employee_name = ? AND status = '已通过' AND start_date LIKE ? ORDER BY start_date"
      ).all(e.name, `${month}%`) as { leave_type: string; start_date: string; end_date: string; start_time: string; end_time: string; images: string }[];
      const leaveDetails: { type: string; days: number; hours: number; has_certificate: boolean }[] = [];
      for (const l of leaveRows) {
        const days = daysBetween(l.start_date, l.end_date);
        const hours = days === 1 ? hoursBetween(l.start_time, l.end_time) : days * 8;
        leaveDetails.push({
          type: l.leave_type,
          days,
          hours: Math.round(hours * 10) / 10,
          has_certificate: l.leave_type === "病假" && hasImages(l.images),
        });
      }

      const lateJson = JSON.stringify(lateDetails);
      const leaveJson = JSON.stringify(leaveDetails);
      const existing = db.prepare("SELECT id FROM attendance_summaries WHERE employee_id = ? AND month = ?").get(e.id, month);
      if (existing) {
        db.prepare(
          "UPDATE attendance_summaries SET employee_name = ?, attendance_days = ?, late_details = ?, leave_details = ? WHERE employee_id = ? AND month = ?"
        ).run(e.name, attendanceDays, lateJson, leaveJson, e.id, month);
      } else {
        db.prepare(
          "INSERT INTO attendance_summaries (employee_id, employee_name, month, attendance_days, late_details, leave_details) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(e.id, e.name, month, attendanceDays, lateJson, leaveJson);
        created++;
      }
    }
  })();

  logOperation(auth.name, "生成考勤汇总", "attendance_summary", month, `生成 ${created} 份`);

  const summaries = db.prepare(`SELECT ${FIELDS} FROM attendance_summaries WHERE month = ? ORDER BY employee_name ASC, id ASC`).all(month);
  return NextResponse.json({ created, summaries });
}
