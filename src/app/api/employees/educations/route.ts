import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

const FIELDS = "id, employee_id, level, school, major, grad_year, created_at";

// GET /api/employees/educations?employee_id=X — 教育履历（管理员看任意员工；普通员工只看自己）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const employeeId = Number(new URL(req.url).searchParams.get("employee_id"));
  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });
  if (auth.role !== "admin" && employeeId !== auth.id) return NextResponse.json({ error: "无权限" }, { status: 403 });

  const rows = db.prepare(`SELECT ${FIELDS} FROM employee_educations WHERE employee_id = ? ORDER BY id DESC`).all(employeeId);
  return NextResponse.json(rows);
}

// POST /api/employees/educations — 新增一条学历（仅管理员），body: { employee_id, level, school, major, grad_year }
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const employeeId = Number(body?.employee_id);
  const level = String(body?.level ?? "").trim();
  const school = String(body?.school ?? "").trim();
  const major = String(body?.major ?? "").trim();
  const grad_year = String(body?.grad_year ?? "").trim();

  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });
  const emp = db.prepare("SELECT id FROM employees WHERE id = ?").get(employeeId);
  if (!emp) return NextResponse.json({ error: "员工不存在" }, { status: 404 });
  if (!level || !school) return NextResponse.json({ error: "学历层次和学校名称必填" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO employee_educations (employee_id, level, school, major, grad_year) VALUES (?, ?, ?, ?, ?)"
  ).run(employeeId, level, school, major, grad_year);

  logOperation(auth.name, "新增教育履历", "employee", String(employeeId), `${level} ${school}`);
  const row = db.prepare(`SELECT ${FIELDS} FROM employee_educations WHERE id = ?`).get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

// PATCH /api/employees/educations — 编辑一条学历（仅管理员），body: { id, level, school, major, grad_year }
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const id = Number(body?.id);
  const level = String(body?.level ?? "").trim();
  const school = String(body?.school ?? "").trim();
  const major = String(body?.major ?? "").trim();
  const grad_year = String(body?.grad_year ?? "").trim();

  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少记录ID" }, { status: 400 });
  const existing = db.prepare(`SELECT ${FIELDS} FROM employee_educations WHERE id = ?`).get(id) as any;
  if (!existing) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  if (!level || !school) return NextResponse.json({ error: "学历层次和学校名称必填" }, { status: 400 });

  db.prepare("UPDATE employee_educations SET level = ?, school = ?, major = ?, grad_year = ? WHERE id = ?")
    .run(level, school, major, grad_year, id);
  logOperation(auth.name, "编辑教育履历", "employee", String(existing.employee_id), `${level} ${school}`);
  const row = db.prepare(`SELECT ${FIELDS} FROM employee_educations WHERE id = ?`).get(id);
  return NextResponse.json(row);
}

// DELETE /api/employees/educations — 删除一条学历（仅管理员），body: { id }
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少记录ID" }, { status: 400 });

  const existing = db.prepare(`SELECT ${FIELDS} FROM employee_educations WHERE id = ?`).get(id) as any;
  if (!existing) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  db.prepare("DELETE FROM employee_educations WHERE id = ?").run(id);
  logOperation(auth.name, "删除教育履历", "employee", String(existing.employee_id), `${existing.level} ${existing.school}`);
  return NextResponse.json({ success: true, id });
}
