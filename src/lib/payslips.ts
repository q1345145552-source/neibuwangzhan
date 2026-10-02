/**
 * 工资单自动项计算与刷新的共享逻辑。
 * 生成工资单（POST /api/payslips）和工资设置保存后的草稿工资单自动刷新都复用这里，
 * 保证「自动项怎么算」只有一份代码，不会两边算出来不一致。
 */
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

const round2 = (n: number) => Math.round(n * 100) / 100;

// 曼谷时间 08:00 后打卡算迟到，返回迟到的分钟数（浮点）
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

function parseImages(imagesJson: string): string[] {
  try {
    const arr = JSON.parse(imagesJson || "[]");
    return Array.isArray(arr) ? arr.filter((x: unknown) => x && String(x).trim()) : [];
  } catch {
    return [];
  }
}

// 计算某员工某月的扣除：社保 / 迟到 / 事假 / 病假；同时返回考勤汇总明细（出勤天数/迟到明细/请假明细）
export function computeDeductions(db: Db, name: string, month: string, totalSalary: number) {
  const base = (db.prepare("SELECT base_salary FROM employees WHERE name = ?").get(name) as { base_salary: number | null } | undefined)?.base_salary ?? 0;

  // 社保 = 底薪 * 5%
  const social = round2(base * 0.05);

  // 迟到：该月考勤里曼谷 08:00 后打卡的迟到分钟数 × 5 铢
  let lateMinutes = 0;
  const lateDetails: { date: string; minutes: number }[] = [];
  const attRows = db.prepare(
    "SELECT date, check_in FROM attendance WHERE employee_name = ? AND date LIKE ? AND check_in != '' AND type != '请假' ORDER BY date"
  ).all(name, `${month}%`) as { date: string; check_in: string }[];
  for (const a of attRows) {
    const minutes = lateMinutesFromUtc(a.check_in);
    if (minutes > 0) {
      lateMinutes += minutes;
      lateDetails.push({ date: a.date, minutes: Math.round(minutes * 10) / 10 });
    }
  }
  const late = round2(lateMinutes * 5);
  const attendanceDays = attRows.length;

  // 事假 / 病假（已通过、开始日期在该月）
  let personalLeave = 0;
  let sickLeave = 0;
  const leaveDetails: { type: string; days: number; hours: number; has_certificate: boolean; images: string[] }[] = [];
  const leaveRows = db.prepare(
    "SELECT leave_type, start_date, end_date, start_time, end_time, images FROM leave_requests WHERE employee_name = ? AND status = '已通过' AND leave_type IN ('事假','病假') AND start_date LIKE ? ORDER BY start_date"
  ).all(name, `${month}%`) as { leave_type: string; start_date: string; end_date: string; start_time: string; end_time: string; images: string }[];
  for (const l of leaveRows) {
    const days = daysBetween(l.start_date, l.end_date);
    const hours = days === 1 ? hoursBetween(l.start_time, l.end_time) : days * 8;
    const images = parseImages(l.images);
    leaveDetails.push({
      type: l.leave_type,
      days,
      hours: Math.round(hours * 10) / 10,
      has_certificate: l.leave_type === "病假" && images.length > 0,
      images,
    });
    if (l.leave_type === "事假") {
      if (days === 1) {
        // 5 小时内按小时扣（60 铢/时），超过 5 小时按整天扣
        personalLeave += hours <= 5 ? hours * 60 : totalSalary / 25;
      } else {
        personalLeave += days * (totalSalary / 25);
      }
    } else {
      // 病假：有医院证明（images 非空）不扣，没证明按天扣
      if (!hasImages(l.images)) sickLeave += days * (totalSalary / 25);
    }
  }
  personalLeave = round2(personalLeave);
  sickLeave = round2(sickLeave);

  return { social, late, personalLeave, sickLeave, attendanceDays, lateDetails, leaveDetails };
}

/**
 * 刷新某员工某月的工资单自动项（底薪/勤奋奖/技能津贴 + 社保/迟到/事假/病假 + 考勤汇总）。
 * 只对「草稿」「打回」状态的工资单生效；待确认/已确认/已发放一律不动，保留原样。
 * 手动项（奖金/佣金/加班费/预扣税）不在此函数内更新，保持原值。
 * @returns 是否真的刷新了（true = 存在草稿/打回工资单并已更新）
 */
export function refreshPayslipAutoFields(db: Db, employeeId: number, month: string): boolean {
  const e = db.prepare(
    "SELECT id, name, base_salary, diligence_bonus, skill_allowance FROM employees WHERE id = ?"
  ).get(employeeId) as { id: number; name: string; base_salary: number | null; diligence_bonus: number | null; skill_allowance: number | null } | undefined;
  if (!e) return false;

  const ps = db.prepare("SELECT id, status FROM payslips WHERE employee_id = ? AND month = ?").get(employeeId, month) as
    { id: number; status: string } | undefined;
  if (!ps || (ps.status !== "草稿" && ps.status !== "打回")) return false;

  const base = e.base_salary ?? 0;
  const diligence = e.diligence_bonus ?? 0;
  const skill = e.skill_allowance ?? 0;
  const totalSalary = base + diligence + skill;
  const ded = computeDeductions(db, e.name, month, totalSalary);
  const summary = JSON.stringify({ attendance_days: ded.attendanceDays, late_details: ded.lateDetails, leave_details: ded.leaveDetails });

  db.prepare(
    `UPDATE payslips SET employee_name = ?, base_salary = ?, diligence_bonus = ?, skill_allowance = ?, social_security = ?, late_deduction = ?, personal_leave_deduction = ?, sick_leave_deduction = ?, summary = ? WHERE employee_id = ? AND month = ?`
  ).run(e.name, base, diligence, skill, ded.social, ded.late, ded.personalLeave, ded.sickLeave, summary, employeeId, month);

  return true;
}
