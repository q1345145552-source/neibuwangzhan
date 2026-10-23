import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

const FIELDS = "id, employee_id, employee_name, month, base_salary, diligence_bonus, skill_allowance, bonus, commission, overtime, merit_income, social_security, late_deduction, personal_leave_deduction, sick_leave_deduction, absence_deduction, demerit_deduction, withholding_tax, status, reject_reason, summary";

// 老板按编号查看原工资详情，权限与原全月/历史列表相同，不重新计算或修改工资。
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看工资详情" }, { status: 403 });
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return NextResponse.json({ error: "工资单编号无效" }, { status: 400 });
  const row = getDb().prepare(`SELECT ${FIELDS} FROM payslips WHERE id = ?`).get(id);
  if (!row) return NextResponse.json({ error: "工资单不存在或你无权查看" }, { status: 404 });
  return NextResponse.json(row, { headers: { "Cache-Control": "private, no-store" } });
}
