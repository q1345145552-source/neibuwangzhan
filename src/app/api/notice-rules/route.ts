import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "客户不能查看通知/规则" }, { status: 403 });
  // submitted_at 表示员工完成提交，与老板是否已审核分别统计。
  const rows = getDb().prepare(`
    SELECT n.*, (SELECT COUNT(*) FROM notice_rule_implementations r WHERE r.notice_id=n.id) AS recipient_count,
      (SELECT COUNT(*) FROM notice_rule_implementations r WHERE r.notice_id=n.id AND r.submitted_at IS NOT NULL AND r.review_status != '打回') AS implemented_count
    FROM notice_rules n
    ${auth.role === "admin" ? "" : "WHERE EXISTS (SELECT 1 FROM notice_rule_implementations mine WHERE mine.notice_id=n.id AND mine.employee_id=?)"}
    ORDER BY n.published_at DESC, n.id DESC
  `).all(...(auth.role === "admin" ? [] : [auth.id]));
  const mine = auth.role === "employee" ? getDb().prepare("SELECT notice_id, printed, printed_at, photos, statement, submitted_at, review_status, boss_comment, reviewed_at FROM notice_rule_implementations WHERE employee_id=?").all(auth.id) as { notice_id: number }[] : [];
  const records = new Map(mine.map(record => [record.notice_id, record]));
  return NextResponse.json((rows as { id: number }[]).map(row => ({ ...row, implementation: records.get(row.id) })), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员能发布" }, { status: 403 });
  const body = await readJson(req);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.body === "string" ? body.body.trim() : "";
  if (!title || !content) return NextResponse.json({ error: "请填写标题和正文" }, { status: 400 });
  if (body.type !== "通知" && body.type !== "规则") return NextResponse.json({ error: "请选择通知或规则" }, { status: 400 });
  if (body.recipient_mode !== "all" && body.recipient_mode !== "selected") return NextResponse.json({ error: "请选择发送对象" }, { status: 400 });
  const ids: number[] = Array.isArray(body.recipient_ids) ? [...new Set<number>(body.recipient_ids)] : [];
  if (body.recipient_mode === "selected" && (!ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0))) {
    return NextResponse.json({ error: "请勾选有效的员工" }, { status: 400 });
  }
  const db = getDb();
  const result = db.transaction(() => {
    const employees = db.prepare("SELECT id, name FROM employees WHERE role='employee' AND status != '离职' ORDER BY id").all() as { id: number; name: string }[];
    const recipients = body.recipient_mode === "all" ? employees : employees.filter(e => ids.includes(e.id));
    if (!recipients.length || (body.recipient_mode === "selected" && recipients.length !== ids.length)) return null;
    const created = db.prepare("INSERT INTO notice_rules (title, body, type, publisher_id, publisher_name, recipient_mode, recipient_ids) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(title, content, body.type, auth.id, auth.name, body.recipient_mode, JSON.stringify(recipients.map(e => e.id)));
    const insert = db.prepare("INSERT INTO notice_rule_implementations (notice_id, employee_id, employee_name) VALUES (?, ?, ?)");
    for (const employee of recipients) insert.run(created.lastInsertRowid, employee.id, employee.name);
    return { id: Number(created.lastInsertRowid), recipient_count: recipients.length };
  })();
  if (!result) return NextResponse.json({ error: "没有可接收的员工，或所选员工已离职/不是普通员工，请重新选择" }, { status: 400 });
  return NextResponse.json(result, { status: 201 });
}
