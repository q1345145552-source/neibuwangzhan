import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

const FIELDS = "id, employee_id, type, points, content, created_by, created_at";

// GET /api/employees/records?employee_id=X — 某员工的记过/记优点记录（仅管理员，按时间倒序）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const employeeId = Number(new URL(req.url).searchParams.get("employee_id"));
  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });

  const rows = db.prepare(`SELECT ${FIELDS} FROM employee_records WHERE employee_id = ? ORDER BY created_at DESC, id DESC`).all(employeeId);
  return NextResponse.json(rows);
}

// POST /api/employees/records — 记过/记优点（仅管理员）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const employeeId = Number(body?.employee_id);
  const type = String(body?.type || "");
  const points = Number(body?.points);
  const content = String(body?.content || "").trim();

  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });
  const emp = db.prepare("SELECT id, name FROM employees WHERE id = ?").get(employeeId) as { id: number; name: string } | undefined;
  if (!emp) return NextResponse.json({ error: "员工不存在" }, { status: 404 });
  if (type !== "demerit" && type !== "merit") return NextResponse.json({ error: "类型不正确" }, { status: 400 });
  if (!Number.isInteger(points) || points <= 0) return NextResponse.json({ error: "分值需为正整数" }, { status: 400 });
  if (!content) return NextResponse.json({ error: "请填写内容" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO employee_records (employee_id, type, points, content, created_by) VALUES (?, ?, ?, ?, ?)"
  ).run(employeeId, type, points, content, auth.name);

  logOperation(auth.name, type === "demerit" ? "记过" : "记优点", "employee", String(employeeId), `${emp.name} ${content}（${points}分）`);

  const row = db.prepare(`SELECT ${FIELDS} FROM employee_records WHERE id = ?`).get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}
