import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

const FIELDS = "id, employee_id, follow_date, content, created_by, created_at";

// GET /api/employees/personal/followups?employee_id=X — 跟进记录历史（仅管理员，按时间倒序）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const db = getDb();
  const employeeId = Number(new URL(req.url).searchParams.get("employee_id"));
  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });

  const rows = db.prepare(
    `SELECT ${FIELDS} FROM employee_personal_followups WHERE employee_id = ? ORDER BY follow_date DESC, id DESC`
  ).all(employeeId);
  return NextResponse.json(rows);
}

// POST /api/employees/personal/followups — 记一条跟进（仅管理员），body: { employee_id, follow_date, content }
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const employeeId = Number(body?.employee_id);
  const follow_date = String(body?.follow_date ?? "").trim();
  const content = String(body?.content ?? "").trim();

  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });
  const emp = db.prepare("SELECT id FROM employees WHERE id = ?").get(employeeId);
  if (!emp) return NextResponse.json({ error: "员工不存在" }, { status: 404 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(follow_date)) return NextResponse.json({ error: "请填写跟进日期（YYYY-MM-DD）" }, { status: 400 });
  if (!content) return NextResponse.json({ error: "请填写跟进内容" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO employee_personal_followups (employee_id, follow_date, content, created_by) VALUES (?, ?, ?, ?)"
  ).run(employeeId, follow_date, content, auth.name);

  logOperation(auth.name, "新增个人情况跟进", "employee", String(employeeId), `${follow_date} ${content}`);
  const row = db.prepare(`SELECT ${FIELDS} FROM employee_personal_followups WHERE id = ?`).get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

// DELETE /api/employees/personal/followups — 删除一条跟进（仅管理员），body: { id }
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少记录ID" }, { status: 400 });

  const existing = db.prepare(`SELECT ${FIELDS} FROM employee_personal_followups WHERE id = ?`).get(id) as any;
  if (!existing) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  db.prepare("DELETE FROM employee_personal_followups WHERE id = ?").run(id);
  logOperation(auth.name, "删除个人情况跟进", "employee", String(existing.employee_id), `${existing.follow_date} ${existing.content}`);
  return NextResponse.json({ success: true, id });
}
