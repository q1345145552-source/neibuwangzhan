import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import * as XLSX from "xlsx";

const round2 = (n: number) => Math.round(n * 100) / 100;

// GET /api/payslips/export?month=YYYY-MM — 导出某月全部工资单 Excel（仅管理员）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可导出" }, { status: 403 });

  const month = new URL(req.url).searchParams.get("month") || "";
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "月份格式不正确" }, { status: 400 });

  const db = getDb();
  const rows = db.prepare(
    "SELECT employee_name, month, base_salary, diligence_bonus, skill_allowance, bonus, commission, overtime, social_security, late_deduction, personal_leave_deduction, sick_leave_deduction, withholding_tax, status FROM payslips WHERE month = ? ORDER BY employee_name ASC, id ASC"
  ).all(month) as any[];

  const header = ["员工", "月份", "底薪", "勤奋奖", "技能津贴", "奖金", "佣金", "加班费", "收入合计", "社保", "迟到扣款", "事假扣款", "病假扣款", "预扣税", "扣除合计", "净收入", "状态"];

  const data = rows.map((p) => {
    const income = (p.base_salary || 0) + (p.diligence_bonus || 0) + (p.skill_allowance || 0) + (p.bonus || 0) + (p.commission || 0) + (p.overtime || 0);
    const deduct = (p.social_security || 0) + (p.late_deduction || 0) + (p.personal_leave_deduction || 0) + (p.sick_leave_deduction || 0) + (p.withholding_tax || 0);
    return [
      p.employee_name,
      p.month,
      p.base_salary || 0,
      p.diligence_bonus || 0,
      p.skill_allowance || 0,
      p.bonus || 0,
      p.commission || 0,
      p.overtime || 0,
      round2(income),
      p.social_security || 0,
      p.late_deduction || 0,
      p.personal_leave_deduction || 0,
      p.sick_leave_deduction || 0,
      p.withholding_tax || 0,
      round2(deduct),
      round2(income - deduct),
      p.status || "草稿",
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "工资单");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new Uint8Array(buf);

  const filename = `payslips_${month}.xlsx`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
