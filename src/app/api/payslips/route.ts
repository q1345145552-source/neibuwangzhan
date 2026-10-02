import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

const MONTH_RE = /^\d{4}-\d{2}$/;

const FIELDS = "id, employee_id, employee_name, month, base_salary, diligence_bonus, skill_allowance, bonus, commission, overtime, social_security, late_deduction, personal_leave_deduction, sick_leave_deduction, withholding_tax";

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

type Db = ReturnType<typeof getDb>;

// 计算某员工某月的扣除：社保 / 迟到 / 事假 / 病假
function computeDeductions(db: Db, name: string, month: string, totalSalary: number) {
  const base = (db.prepare("SELECT base_salary FROM employees WHERE name = ?").get(name) as { base_salary: number | null } | undefined)?.base_salary ?? 0;

  // 社保 = 底薪 * 5%
  const social = round2(base * 0.05);

  // 迟到：该月考勤里曼谷 08:00 后打卡的迟到分钟数 × 5 铢
  let lateMinutes = 0;
  const attRows = db.prepare(
    "SELECT check_in FROM attendance WHERE employee_name = ? AND date LIKE ? AND check_in != '' AND type != '请假'"
  ).all(name, `${month}%`) as { check_in: string }[];
  for (const a of attRows) lateMinutes += lateMinutesFromUtc(a.check_in);
  const late = round2(lateMinutes * 5);

  // 事假 / 病假（已通过、开始日期在该月）
  let personalLeave = 0;
  let sickLeave = 0;
  const leaveRows = db.prepare(
    "SELECT leave_type, start_date, end_date, start_time, end_time, images FROM leave_requests WHERE employee_name = ? AND status = '已通过' AND leave_type IN ('事假','病假') AND start_date LIKE ?"
  ).all(name, `${month}%`) as { leave_type: string; start_date: string; end_date: string; start_time: string; end_time: string; images: string }[];
  for (const l of leaveRows) {
    const days = daysBetween(l.start_date, l.end_date);
    if (l.leave_type === "事假") {
      if (days === 1) {
        const hours = hoursBetween(l.start_time, l.end_time);
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

  return { social, late, personalLeave, sickLeave };
}

// GET /api/payslips?month=YYYY-MM — 某月工资单列表（仅管理员）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const month = new URL(req.url).searchParams.get("month") || "";
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: "月份格式不正确" }, { status: 400 });

  const db = getDb();
  const rows = db.prepare(`SELECT ${FIELDS} FROM payslips WHERE month = ? ORDER BY employee_name ASC, id ASC`).all(month);
  return NextResponse.json(rows);
}

// POST /api/payslips — 生成某月工资单（仅管理员）：自动读收入 + 自动算扣除；手动项（奖金/佣金/加班费/预扣税）保留已有值
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const month = String(body?.month || "").trim();
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: "月份格式不正确" }, { status: 400 });

  const employees = db.prepare(
    "SELECT id, name, base_salary, diligence_bonus, skill_allowance FROM employees WHERE status = '在职' AND role != 'client'"
  ).all() as { id: number; name: string; base_salary: number | null; diligence_bonus: number | null; skill_allowance: number | null }[];

  let created = 0;
  db.transaction(() => {
    for (const e of employees) {
      const base = e.base_salary ?? 0;
      const diligence = e.diligence_bonus ?? 0;
      const skill = e.skill_allowance ?? 0;
      const totalSalary = base + diligence + skill; // 用于事假/病假按天扣
      const ded = computeDeductions(db, e.name, month, totalSalary);

      const existing = db.prepare("SELECT id FROM payslips WHERE employee_id = ? AND month = ?").get(e.id, month);
      if (existing) {
        // 已存在：刷新自动字段（收入自动项 + 扣除自动项），保留手动填写的奖金/佣金/加班费/预扣税
        db.prepare(
          `UPDATE payslips SET employee_name = ?, base_salary = ?, diligence_bonus = ?, skill_allowance = ?, social_security = ?, late_deduction = ?, personal_leave_deduction = ?, sick_leave_deduction = ? WHERE employee_id = ? AND month = ?`
        ).run(e.name, base, diligence, skill, ded.social, ded.late, ded.personalLeave, ded.sickLeave, e.id, month);
      } else {
        db.prepare(
          `INSERT INTO payslips (employee_id, employee_name, month, base_salary, diligence_bonus, skill_allowance, bonus, commission, overtime, social_security, late_deduction, personal_leave_deduction, sick_leave_deduction, withholding_tax)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, 0)`
        ).run(e.id, e.name, month, base, diligence, skill, ded.social, ded.late, ded.personalLeave, ded.sickLeave);
        created++;
      }
    }
  })();

  logOperation(auth.name, "生成工资单", "payslip", month, `生成 ${created} 张`);

  const payslips = db.prepare(`SELECT ${FIELDS} FROM payslips WHERE month = ? ORDER BY employee_name ASC, id ASC`).all(month);
  return NextResponse.json({ created, payslips });
}

// PATCH /api/payslips — 修改奖金/佣金/加班费/预扣税（仅管理员）
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少工资单" }, { status: 400 });

  const existing = db.prepare("SELECT id FROM payslips WHERE id = ?").get(id);
  if (!existing) return NextResponse.json({ error: "工资单不存在" }, { status: 404 });

  const sets: string[] = [];
  const params: unknown[] = [];
  const numFields: [string, string][] = [["bonus", "奖金"], ["commission", "佣金"], ["overtime", "加班费"], ["withholding_tax", "预扣税"]];
  for (const [key, label] of numFields) {
    const v = body?.[key];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: `${label}格式不正确` }, { status: 400 });
    sets.push(`${key} = ?`); params.push(n);
  }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });

  db.prepare(`UPDATE payslips SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);

  const row = db.prepare(`SELECT ${FIELDS} FROM payslips WHERE id = ?`).get(id);
  return NextResponse.json(row);
}
