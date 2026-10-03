import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import * as XLSX from "xlsx";

const round2 = (n: number) => Math.round(n * 100) / 100;

// GET /api/payslips/export?month=YYYY-MM — 导出某月全部工资单（工资条模板，一人一个 Sheet）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可导出" }, { status: 403 });

  const month = new URL(req.url).searchParams.get("month") || "";
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "月份格式不正确" }, { status: 400 });

  const db = getDb();
  const rows = db.prepare(
    "SELECT id, employee_id, employee_name, month, base_salary, diligence_bonus, skill_allowance, bonus, commission, overtime, merit_income, social_security, late_deduction, personal_leave_deduction, sick_leave_deduction, absence_deduction, demerit_deduction, withholding_tax FROM payslips WHERE month = ? ORDER BY employee_name ASC, id ASC"
  ).all(month) as any[];

  // 底薪/勤奋奖/技能津贴从员工档案读；员工被删时回退到工资单快照
  const empStmt = db.prepare("SELECT base_salary, diligence_bonus, skill_allowance FROM employees WHERE id = ?");

  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  for (const p of rows) {
    const emp = empStmt.get(p.employee_id) as { base_salary: number | null; diligence_bonus: number | null; skill_allowance: number | null } | undefined;
    const base = emp ? (emp.base_salary ?? 0) : (p.base_salary ?? 0);
    const diligence = emp ? (emp.diligence_bonus ?? 0) : (p.diligence_bonus ?? 0);
    const skill = emp ? (emp.skill_allowance ?? 0) : (p.skill_allowance ?? 0);
    const bonus = p.bonus ?? 0;
    const commission = p.commission ?? 0;
    const overtime = p.overtime ?? 0;
    const merit = p.merit_income ?? 0;
    const social = p.social_security ?? 0;
    const late = p.late_deduction ?? 0;
    const personal = p.personal_leave_deduction ?? 0;
    const sick = p.sick_leave_deduction ?? 0;
    const absence = p.absence_deduction ?? 0;
    const demerit = p.demerit_deduction ?? 0;
    const wht = p.withholding_tax ?? 0;

    const income = base + diligence + skill + bonus + commission + overtime + merit;
    const deduct = social + late + personal + sick + absence + demerit + wht;
    const net = income - deduct;

    const aoa: (string | number)[][] = [
      ["工资条"],
      [`员工：${p.employee_name}`],
      [`月份：${p.month}`],
      [],
      ["收入"],
      ["底薪", round2(base)],
      ["勤奋奖", round2(diligence)],
      ["技能津贴", round2(skill)],
      ["奖金", round2(bonus)],
      ["佣金", round2(commission)],
      ["加班费", round2(overtime)],
      ["功过收入", round2(merit)],
      ["收入合计", round2(income)],
      [],
      ["扣除"],
      ["社保", round2(social)],
      ["迟到扣款", round2(late)],
      ["事假扣款", round2(personal)],
      ["病假扣款", round2(sick)],
      ["缺勤扣款", round2(absence)],
      ["功过扣款", round2(demerit)],
      ["预扣税", round2(wht)],
      ["扣除合计", round2(deduct)],
      [],
      ["净收入", round2(net)],
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 14 }, { wch: 14 }];
    // 标题/员工/月份 三行跨两列合并
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },
    ];

    // Sheet 名 = 员工名（去非法字符，超长截断，重名加后缀）
    let name = String(p.employee_name || "员工").replace(/[\\/*?:[\]]/g, "").trim() || "员工";
    if (name.length > 31) name = name.slice(0, 31);
    let finalName = name;
    let n = 2;
    while (usedNames.has(finalName)) finalName = `${name}_${n++}`;
    usedNames.add(finalName);

    XLSX.utils.book_append_sheet(wb, ws, finalName);
  }

  // 空月份兜底：避免空工作簿写入报错
  if (rows.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([["该月份还没有工资单"]]);
    XLSX.utils.book_append_sheet(wb, ws, "无数据");
  }

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
