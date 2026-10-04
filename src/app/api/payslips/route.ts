import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { computeDeductions } from "@/lib/payslips";
import { bangkokMonthKey } from "@/lib/time";

const MONTH_RE = /^\d{4}-\d{2}$/;

const FIELDS = "id, employee_id, employee_name, month, base_salary, diligence_bonus, skill_allowance, bonus, commission, overtime, merit_income, social_security, late_deduction, personal_leave_deduction, sick_leave_deduction, absence_deduction, demerit_deduction, withholding_tax, status, reject_reason, summary";

// GET /api/payslips?month=YYYY-MM — 管理员看某月全部工资单；?month=all 看全部历史月份；员工看自己的工资单
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const db = getDb();
  const month = new URL(req.url).searchParams.get("month") || "";

  if (auth.role === "admin") {
    if (month === "all") {
      const rows = db.prepare(`SELECT ${FIELDS} FROM payslips ORDER BY month DESC, employee_name ASC, id ASC`).all();
      return NextResponse.json(rows);
    }
    if (!MONTH_RE.test(month)) return NextResponse.json({ error: "月份格式不正确" }, { status: 400 });
    const rows = db.prepare(`SELECT ${FIELDS} FROM payslips WHERE month = ? ORDER BY employee_name ASC, id ASC`).all(month);
    return NextResponse.json(rows);
  }

  // 员工：只看自己的工资单
  if (month && MONTH_RE.test(month)) {
    const rows = db.prepare(`SELECT ${FIELDS} FROM payslips WHERE employee_name = ? AND month = ? ORDER BY month DESC, id DESC`).all(auth.name, month);
    return NextResponse.json(rows);
  }
  const rows = db.prepare(`SELECT ${FIELDS} FROM payslips WHERE employee_name = ? ORDER BY month DESC, id DESC`).all(auth.name);
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

  // 当月还没过完、或未来月份，禁止生成工资单：只能算已经过完的月份
  if (month >= bangkokMonthKey()) {
    return NextResponse.json({ error: "当月还没结束，不能生成工资单，只能生成已过完的月份" }, { status: 400 });
  }

  const employees = db.prepare(
    "SELECT id, name, base_salary, diligence_bonus, skill_allowance FROM employees WHERE status = '在职' AND role = 'employee' AND (hire_date = '' OR hire_date <= ?)"
  ).all(`${month}-31`) as { id: number; name: string; base_salary: number | null; diligence_bonus: number | null; skill_allowance: number | null }[];

  let created = 0;
  db.transaction(() => {
    for (const e of employees) {
      const base = e.base_salary ?? 0;
      const diligence = e.diligence_bonus ?? 0;
      const skill = e.skill_allowance ?? 0;
      const totalSalary = base + diligence + skill; // 用于事假/病假按天扣
      const ded = computeDeductions(db, e.name, month, totalSalary);
      const summary = JSON.stringify({ attendance_days: ded.attendanceDays, late_details: ded.lateDetails, leave_details: ded.leaveDetails });

      // 功过联动：当月记优点总分×10 = 功过收入；当月记过总分×10 = 功过扣款
      const meritPoints = (db.prepare("SELECT COALESCE(SUM(points), 0) AS total FROM employee_records WHERE employee_id = ? AND type = 'merit' AND substr(created_at, 1, 7) = ?").get(e.id, month) as { total: number }).total;
      const demeritPoints = (db.prepare("SELECT COALESCE(SUM(points), 0) AS total FROM employee_records WHERE employee_id = ? AND type = 'demerit' AND substr(created_at, 1, 7) = ?").get(e.id, month) as { total: number }).total;
      const meritIncome = meritPoints * 10;
      const demeritDeduction = demeritPoints * 10;

      const existing = db.prepare("SELECT id FROM payslips WHERE employee_id = ? AND month = ?").get(e.id, month);
      if (existing) {
        // 已存在：刷新自动字段（收入自动项 + 扣除自动项 + 功过 + 考勤汇总），保留手动填写的奖金/佣金/加班费/预扣税
        db.prepare(
          `UPDATE payslips SET employee_name = ?, base_salary = ?, diligence_bonus = ?, skill_allowance = ?, merit_income = ?, social_security = ?, late_deduction = ?, personal_leave_deduction = ?, sick_leave_deduction = ?, absence_deduction = ?, demerit_deduction = ?, summary = ? WHERE employee_id = ? AND month = ?`
        ).run(e.name, base, diligence, skill, meritIncome, ded.social, ded.late, ded.personalLeave, ded.sickLeave, ded.absenceDeduction, demeritDeduction, summary, e.id, month);
      } else {
        db.prepare(
          `INSERT INTO payslips (employee_id, employee_name, month, base_salary, diligence_bonus, skill_allowance, bonus, commission, overtime, merit_income, social_security, late_deduction, personal_leave_deduction, sick_leave_deduction, absence_deduction, demerit_deduction, withholding_tax, summary)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
        ).run(e.id, e.name, month, base, diligence, skill, meritIncome, ded.social, ded.late, ded.personalLeave, ded.sickLeave, ded.absenceDeduction, demeritDeduction, summary);
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

// DELETE /api/payslips — 删除草稿/打回状态的工资单（仅管理员）
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少工资单" }, { status: 400 });

  const existing = db.prepare("SELECT id, status FROM payslips WHERE id = ?").get(id) as { id: number; status: string } | undefined;
  if (!existing) return NextResponse.json({ error: "工资单不存在" }, { status: 404 });
  if (existing.status !== "草稿" && existing.status !== "打回") {
    return NextResponse.json({ error: "只有草稿或打回状态的工资单能删除" }, { status: 400 });
  }

  db.prepare("DELETE FROM payslips WHERE id = ?").run(id);
  logOperation(auth.name, "删除工资单", "payslip", String(id), `删除 ${existing.status} 状态工资单`);
  return NextResponse.json({ success: true, id });
}
