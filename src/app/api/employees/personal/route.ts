import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { utcNowStr } from "@/lib/time";

const FIELDS = [
  "family_composition", "family_relationship", "family_economy",
  "relationship_status", "relationship_stability", "relationship_affect",
  "parents_alive", "parents_health", "parents_care",
  "work_status", "work_pressure", "work_mentality", "work_adaptation",
  "family_factors", "relationship_factors", "health_factors", "other_factors",
  "family_factor_remark", "relationship_factor_remark", "health_factor_remark", "other_factor_remark",
] as const;

const EMPTY: Record<string, string> = Object.fromEntries(FIELDS.map((f) => [f, ""]));

// GET /api/employees/personal?employee_id=X — 个人情况记录（仅管理员，员工不可见）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const db = getDb();
  const employeeId = Number(new URL(req.url).searchParams.get("employee_id"));
  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });

  const row = db.prepare(
    `SELECT employee_id, ${FIELDS.join(", ")}, updated_by, updated_at FROM employee_personal_notes WHERE employee_id = ?`
  ).get(employeeId) as Record<string, unknown> | undefined;

  return NextResponse.json(row ? row : { employee_id: employeeId, ...EMPTY, updated_by: "", updated_at: "" });
}

// PUT /api/employees/personal — 保存个人情况记录（仅管理员），body: { employee_id, ...字段 }
export async function PUT(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const employeeId = Number(body?.employee_id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });
  const emp = db.prepare("SELECT id, name FROM employees WHERE id = ?").get(employeeId);
  if (!emp) return NextResponse.json({ error: "员工不存在" }, { status: 404 });

  const vals: string[] = [];
  for (const f of FIELDS) {
    const v = body?.[f];
    vals.push(v === undefined || v === null ? "" : String(v).trim());
  }

  const updateSets = FIELDS.map((f) => `${f} = excluded.${f}`).join(", ");
  db.prepare(
    `INSERT INTO employee_personal_notes (employee_id, ${FIELDS.join(", ")}, updated_by, updated_at)
     VALUES (?, ${FIELDS.map(() => "?").join(", ")}, ?, ?)
     ON CONFLICT(employee_id) DO UPDATE SET ${updateSets}, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(employeeId, ...vals, auth.name, utcNowStr());

  logOperation(auth.name, "更新个人情况", "employee", String(employeeId), "家庭/感情/父母/工作情况");

  const row = db.prepare(
    `SELECT employee_id, ${FIELDS.join(", ")}, updated_by, updated_at FROM employee_personal_notes WHERE employee_id = ?`
  ).get(employeeId);
  return NextResponse.json(row);
}
