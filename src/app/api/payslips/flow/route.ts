import { NextRequest, NextResponse } from "next/server";
import { getDb, sendNotification, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { PAYSLIP_REJECTED_TITLE } from "@/lib/notification-types";

const FIELDS = "id, employee_id, employee_name, month, base_salary, diligence_bonus, skill_allowance, bonus, commission, overtime, social_security, late_deduction, personal_leave_deduction, sick_leave_deduction, withholding_tax, status, reject_reason, summary";

// POST /api/payslips/flow — 工资单流程流转
// action: send（管理员发给员工）| confirm（员工确认）| reject（员工打回，带意见）| pay（管理员发放）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const id = Number(body?.id);
  const action = String(body?.action || "").trim();
  const reason = String(body?.reason || "").trim();
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少工资单" }, { status: 400 });

  if (action === "reject") return db.transaction(() => {
    const p = db.prepare("SELECT id, employee_name, month, status FROM payslips WHERE id = ?").get(id) as
      { id: number; employee_name: string; month: string; status: string } | undefined;
    if (!p) return NextResponse.json({ error: "工资单不存在" }, { status: 404 });
    if (auth.name !== p.employee_name) return NextResponse.json({ error: "只能打回自己的工资单" }, { status: 403 });
    if (p.status !== "待确认") return NextResponse.json({ error: `当前状态（${p.status}）不能打回` }, { status: 400 });
    if (typeof body?.reason !== "string" || !reason) return NextResponse.json({ error: "请填写修改意见" }, { status: 400 });
    const changed = db.prepare("UPDATE payslips SET status = '打回', reject_reason = ? WHERE id = ? AND status = '待确认'").run(reason, id);
    if (changed.changes !== 1) return NextResponse.json({ error: "工资单状态已变化，请刷新后重试" }, { status: 409 });
    // 与系统“所有管理员”口径一致，不只通知原处理人；按通知使用的姓名身份去重。
    const bosses = db.prepare("SELECT DISTINCT name FROM employees WHERE role = 'admin' AND TRIM(name) <> ''").all() as { name: string }[];
    const insert = db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)");
    for (const boss of bosses) insert.run("", PAYSLIP_REJECTED_TITLE, `${auth.name}打回了 ${p.month} 的工资单。\n员工：${p.employee_name}\n修改意见：${reason}`, boss.name, String(p.id), "payslip_rejected");
    logOperation(auth.name, "打回工资单", "payslip", String(id), reason);
    return NextResponse.json(db.prepare(`SELECT ${FIELDS} FROM payslips WHERE id = ?`).get(id));
  }).immediate();

  const p = db.prepare("SELECT id, employee_name, month, status FROM payslips WHERE id = ?").get(id) as
    { id: number; employee_name: string; month: string; status: string } | undefined;
  if (!p) return NextResponse.json({ error: "工资单不存在" }, { status: 404 });

  if (action === "send") {
    if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });
    if (p.status !== "草稿" && p.status !== "打回") return NextResponse.json({ error: `当前状态（${p.status}）不能发送` }, { status: 400 });
    db.prepare("UPDATE payslips SET status = '待确认', reject_reason = '' WHERE id = ?").run(id);
    sendNotification("payslip", "工资单待确认", `你 ${p.month} 的工资单已生成，请查看并确认`, p.employee_name, String(id), "payslip");
    logOperation(auth.name, "发送工资单", "payslip", String(id), p.employee_name);
  } else if (action === "confirm") {
    if (auth.name !== p.employee_name) return NextResponse.json({ error: "只能确认自己的工资单" }, { status: 403 });
    if (p.status !== "待确认") return NextResponse.json({ error: `当前状态（${p.status}）不能确认` }, { status: 400 });
    db.prepare("UPDATE payslips SET status = '已确认' WHERE id = ?").run(id);
    logOperation(auth.name, "确认工资单", "payslip", String(id));
  } else if (action === "pay") {
    if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });
    if (p.status !== "已确认") return NextResponse.json({ error: `当前状态（${p.status}）不能发放` }, { status: 400 });
    db.prepare("UPDATE payslips SET status = '已发放' WHERE id = ?").run(id);
    logOperation(auth.name, "发放工资单", "payslip", String(id), p.employee_name);
  } else {
    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  }

  const row = db.prepare(`SELECT ${FIELDS} FROM payslips WHERE id = ?`).get(id);
  return NextResponse.json(row);
}
