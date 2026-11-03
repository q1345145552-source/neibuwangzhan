/** Pure presentation model shared by the detail view and Excel. Never recalculates stored pay. */
export interface BreakdownPayslip {
  base_salary: number; diligence_bonus: number; skill_allowance: number;
  bonus: number | string; commission: number | string; overtime: number | string; merit_income: number;
  social_security: number; late_deduction: number; personal_leave_deduction: number;
  sick_leave_deduction: number; absence_deduction: number; demerit_deduction: number;
  withholding_tax: number | string; summary?: string;
}
export type BreakdownLine = { label: string; formula: string; amount?: number };
const money = (n: number) => n.toFixed(2);
const round = (n: number) => Math.round(n * 100) / 100;
const quantity = (n: number) => Number(n.toFixed(6)).toString();
const numeric = (v: unknown) => {
  const n = typeof v === "number" || typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
};

export function buildPayslipBreakdown(p: BreakdownPayslip) {
  const incomeFields = [["底薪", "base_salary"], ["勤奋奖", "diligence_bonus"], ["技能津贴", "skill_allowance"],
    ["奖金", "bonus"], ["佣金", "commission"], ["加班费", "overtime"], ["功过收入", "merit_income"]] as const;
  const deductionFields = ["social_security", "late_deduction", "personal_leave_deduction", "sick_leave_deduction",
    "absence_deduction", "demerit_deduction", "withholding_tax"] as const;
  const income = round(incomeFields.reduce((s, [, key]) => s + numeric(p[key]), 0));
  const deduction = round(deductionFields.reduce((s, key) => s + numeric(p[key]), 0));
  const net = round(income - deduction);
  let summary: Record<string, any> = {};
  try { const parsed = JSON.parse(p.summary || "{}"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) summary = parsed; } catch { /* legacy missing snapshot */ }
  const c = summary.calculation;
  const hasSnapshot = c?.version === 1 && ["total_salary", "daily_rate", "hourly_rate", "late_minutes", "expected_days", "absence_days", "leave_days"].every(k => typeof c[k] === "number" && Number.isFinite(c[k]));
  const sections: { title: string; lines: BreakdownLine[] }[] = [];
  sections.push({ title: "收入明细", lines: [...incomeFields.map(([label, key]) => ({ label, formula: "工资单金额", amount: numeric(p[key]) })),
    { label: "收入合计", formula: "底薪 + 勤奋奖 + 技能津贴 + 奖金 + 佣金 + 加班费 + 功过收入", amount: income }] });
  const totalSalary = numeric(p.base_salary) + numeric(p.diligence_bonus) + numeric(p.skill_allowance);
  sections.push({ title: "计算基准", lines: hasSnapshot ? [
    { label: "总工资", formula: `底薪 + 勤奋奖 + 技能津贴 = ${money(c.total_salary)} 铢` },
    { label: "日薪", formula: `${money(c.total_salary)} ÷ 30 = ${quantity(c.daily_rate)} 铢/天` },
    { label: "时薪", formula: `${quantity(c.daily_rate)} ÷ 8 = ${quantity(c.hourly_rate)} 铢/时` },
    { label: "应出勤天数", formula: `${c.expected_days} 天` },
    { label: "实际出勤天数", formula: `${numeric(summary.attendance_days)} 天` },
    { label: "请假天数", formula: `${c.leave_days} 天（含带薪请假）` },
  ] : [
    { label: "基准参考", formula: `本单总工资 ${money(totalSalary)}；按现规则日薪 ${quantity(totalSalary / 30)} 铢，时薪 ${quantity(totalSalary / 30 / 8)} 铢。历史扣款依据未保存，不能据此倒推。` },
    { label: "实际出勤天数", formula: typeof summary.attendance_days === "number" ? `${summary.attendance_days} 天` : "历史未记录" },
    { label: "应出勤及请假天数", formula: "历史计算快照未记录" },
  ] });
  const lines: BreakdownLine[] = [];
  function formulaLine(label: string, formula: string, expected: number, actual: number) {
    lines.push({ label, formula: `${formula} = ${money(round(expected))} 铢`, amount: actual });
    if (round(expected) !== round(actual)) lines.push({ label: `${label}金额差异`, formula: `计算依据得出 ${money(round(expected))} 铢，工资单保存 ${money(actual)} 铢；以工资单金额为准，请核对原记录。` });
  }
  formulaLine("社保", `底薪 ${money(numeric(p.base_salary))} × 5%`, numeric(p.base_salary) * .05, numeric(p.social_security));
  if (hasSnapshot) {
    formulaLine("迟到扣款", `累计迟到 ${quantity(c.late_minutes)} 分钟；max(0, ${quantity(c.late_minutes)} − 30 分钟豁免) × 10`, Math.max(0, c.late_minutes - 30) * 10, numeric(p.late_deduction));
  } else lines.push({ label: "迟到扣款", formula: "历史未保存精确累计分钟及适用规则，展示原工资单金额", amount: numeric(p.late_deduction) });
  const leaves = Array.isArray(summary.leave_details) ? summary.leave_details : [];
  for (const [sick, label, field] of [[false, "事假及其他请假扣款", "personal_leave_deduction"], [true, "病假扣款", "sick_leave_deduction"]] as const) {
    const records = leaves.filter((l: any) => l && (l.type === "病假") === sick);
    let sum = 0;
    let complete = hasSnapshot;
    for (const l of records) {
      if (!hasSnapshot || typeof l.start_date !== "string" || ![l.quantity, l.rate, l.amount].every(n => typeof n === "number" && Number.isFinite(n))) { complete = false; continue; }
      const dates = l.start_date === l.end_date ? l.start_date : `${l.start_date} 至 ${l.end_date}`;
      const paid = l.pay_status === "带薪";
      const formula = paid ? `${quantity(l.quantity)} ${l.unit}（带薪，不扣款）` : `${quantity(l.quantity)} ${l.unit}（不带薪） × ${l.unit === "小时" ? "时薪" : "日薪"} ${quantity(l.rate)} 铢/${l.unit === "小时" ? "时" : "天"}`;
      lines.push({ label: `${dates} ${l.type}`, formula, amount: l.amount });
      sum += l.amount;
    }
    const actual = numeric(p[field]);
    if (complete && round(sum) !== round(actual)) lines.push({ label: `${sick ? "病假" : "事假及其他请假"}尾差/差异`, formula: `逐条金额合计 ${money(round(sum))}；与工资单相差 ${money(round(actual - sum))}（逐项及汇总舍入可能产生尾差，请核对）`, amount: round(actual - sum) });
    lines.push({ label, formula: complete ? (records.length ? "以上逐条扣款合计（按工资单汇总舍入）" : "本月无此类已通过请假") : "历史未保存逐条日期、费率及扣款，展示原工资单金额", amount: actual });
  }
  if (hasSnapshot) formulaLine("缺勤扣款", `缺勤 ${c.absence_days} 天 × 日薪 ${quantity(c.daily_rate)}`, c.absence_days * c.daily_rate, numeric(p.absence_deduction));
  else lines.push({ label: "缺勤扣款", formula: "历史未保存缺勤天数及适用日薪，展示原工资单金额", amount: numeric(p.absence_deduction) });
  lines.push({ label: "功过扣款", formula: "工资单记录金额", amount: numeric(p.demerit_deduction) },
    { label: "预扣税", formula: "手动项，工资单记录金额", amount: numeric(p.withholding_tax) },
    { label: "扣除合计", formula: "社保 + 迟到 + 事假及其他请假 + 病假 + 缺勤 + 功过扣款 + 预扣税", amount: deduction });
  sections.push({ title: "扣除明细", lines });
  sections.push({ title: "实发", lines: [{ label: "实发工资", formula: `收入合计 ${money(income)} − 扣除合计 ${money(deduction)}`, amount: net }] });
  return { sections, income, deduction, net, note: hasSnapshot ? "金额单位：泰铢。费率展示至6位小数，计算使用完整精度，金额保留2位小数。" : "历史工资单缺少完整计算快照，保留原金额，不按新规则重算；新生成或刷新草稿后会保存完整计算依据。" };
}
