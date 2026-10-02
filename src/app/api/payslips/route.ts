import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

const MONTH_RE = /^\d{4}-\d{2}$/;

const FIELDS = "id, employee_id, employee_name, month, base_salary, diligence_bonus, skill_allowance, bonus, commission, overtime";

// GET /api/payslips?month=YYYY-MM — 某月工资单列表（仅管理员）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const month = new URL(req.url).searchParams.get("month") || "";
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: "月份格式不正确" }, { status: 400 });

  const db = getDb();
  const rows = db.prepare(
    `SELECT ${FIELDS} FROM payslips WHERE month = ? ORDER BY employee_name ASC, id ASC`
  ).all(month);
  return NextResponse.json(rows);
}

// POST /api/payslips — 生成某月工资单（仅管理员）：底薪/勤奋奖/技能津贴从员工档案读，奖金/佣金/加班费置 0
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const month = String(body?.month || "").trim();
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: "月份格式不正确" }, { status: 400 });

  // 在职员工（不含客户账号）
  const employees = db.prepare(
    "SELECT id, name, base_salary, diligence_bonus, skill_allowance FROM employees WHERE status = '在职' AND role != 'client'"
  ).all() as { id: number; name: string; base_salary: number | null; diligence_bonus: number | null; skill_allowance: number | null }[];

  const ins = db.prepare(
    `INSERT OR IGNORE INTO payslips (employee_id, employee_name, month, base_salary, diligence_bonus, skill_allowance, bonus, commission, overtime)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)`
  );
  let created = 0;
  db.transaction(() => {
    for (const e of employees) {
      const r = ins.run(e.id, e.name, month, e.base_salary ?? 0, e.diligence_bonus ?? 0, e.skill_allowance ?? 0);
      if (r.changes > 0) created++;
    }
  })();

  logOperation(auth.name, "生成工资单", "payslip", month, `生成 ${created} 张`);

  const payslips = db.prepare(
    `SELECT ${FIELDS} FROM payslips WHERE month = ? ORDER BY employee_name ASC, id ASC`
  ).all(month);
  return NextResponse.json({ created, payslips });
}

// PATCH /api/payslips — 修改奖金/佣金/加班费（仅管理员），收入合计由前端按各字段加总
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
  const numFields: [string, string][] = [["bonus", "奖金"], ["commission", "佣金"], ["overtime", "加班费"]];
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
