import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation, ONBOARDING_DOC_ITEMS } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { utcNowStr } from "@/lib/time";

const FIELDS = "id, employee_id, item, collected, updated_by, updated_at, created_at";

// GET /api/employees/onboarding?employee_id=X — 入职资料清单（管理员看任意员工；员工只看自己）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const employeeId = Number(new URL(req.url).searchParams.get("employee_id"));
  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });
  if (auth.role !== "admin" && employeeId !== auth.id) return NextResponse.json({ error: "无权限" }, { status: 403 });

  // 首次查看时补全默认清单项（幂等）
  const ins = db.prepare("INSERT OR IGNORE INTO employee_onboarding_docs (employee_id, item) VALUES (?, ?)");
  for (const item of ONBOARDING_DOC_ITEMS) ins.run(employeeId, item);

  const items = db.prepare(`SELECT ${FIELDS} FROM employee_onboarding_docs WHERE employee_id = ? ORDER BY id ASC`).all(employeeId);
  return NextResponse.json({ items });
}

// PATCH /api/employees/onboarding — 逐项勾选已收集/未收集（仅管理员），body: { id, collected }
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const id = Number(body?.id);
  const collected = body?.collected === true || body?.collected === 1 ? 1 : 0;

  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少事项ID" }, { status: 400 });

  const row = db.prepare(`SELECT ${FIELDS} FROM employee_onboarding_docs WHERE id = ?`).get(id) as any;
  if (!row) return NextResponse.json({ error: "事项不存在" }, { status: 404 });

  db.prepare("UPDATE employee_onboarding_docs SET collected = ?, updated_by = ?, updated_at = ? WHERE id = ?")
    .run(collected, auth.name, utcNowStr(), id);
  logOperation(auth.name, collected ? "入职资料已收集" : "入职资料取消收集", "employee", String(row.employee_id), `${row.item}`);

  const updated = db.prepare(`SELECT ${FIELDS} FROM employee_onboarding_docs WHERE id = ?`).get(id);
  return NextResponse.json(updated);
}
