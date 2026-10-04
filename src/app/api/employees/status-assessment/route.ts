import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { assessEmployeeStatus } from "@/lib/deepseek";

function parseFactors(v: string): string {
  try {
    const a = JSON.parse(v || "[]");
    return Array.isArray(a) ? a.join("、") : "";
  } catch {
    return "";
  }
}

// GET /api/employees/status-assessment?employee_id=X — 已缓存的评估结果（仅管理员）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const employeeId = Number(new URL(req.url).searchParams.get("employee_id"));
  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });

  const row = db.prepare(
    "SELECT employee_id, level, reason, analyzed_at FROM employee_status_assessments WHERE employee_id = ?"
  ).get(employeeId) as any;
  return NextResponse.json(row || null);
}

// POST /api/employees/status-assessment — 评估员工状态（仅管理员，结果缓存，同一员工不重复分析）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const employeeId = Number(body?.employee_id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });

  const emp = db.prepare("SELECT id, name FROM employees WHERE id = ?").get(employeeId) as { id: number; name: string } | undefined;
  if (!emp) return NextResponse.json({ error: "员工不存在" }, { status: 404 });

  // 缓存命中
  const cached = db.prepare(
    "SELECT employee_id, level, reason, analyzed_at FROM employee_status_assessments WHERE employee_id = ?"
  ).get(employeeId) as any;
  if (cached && cached.level) {
    return NextResponse.json({ ...cached, cached: true });
  }

  // 个人情况
  const notes = db.prepare("SELECT * FROM employee_personal_notes WHERE employee_id = ?").get(employeeId) as any;
  const family = notes
    ? `组成：${notes.family_composition || "无"}；关系：${notes.family_relationship || "无"}；经济：${notes.family_economy || "无"}；因素：${parseFactors(notes.family_factors) || "无"}；备注：${notes.family_factor_remark || "无"}`
    : "无";
  const relationship = notes
    ? `状态：${notes.relationship_status || "无"}；稳定性：${notes.relationship_stability || "无"}；影响工作：${notes.relationship_affect || "无"}；因素：${parseFactors(notes.relationship_factors) || "无"}；备注：${notes.relationship_factor_remark || "无"}`
    : "无";
  const health = notes
    ? `自己/家人健康因素：${parseFactors(notes.health_factors) || "无"}；备注：${notes.health_factor_remark || "无"}；父母健康：${notes.parents_health || "无"}；父母是否健在：${notes.parents_alive || "无"}；是否需照顾：${notes.parents_care || "无"}`
    : "无";
  const work = notes
    ? `状态：${notes.work_status || "无"}；压力：${notes.work_pressure || "无"}；心态：${notes.work_mentality || "无"}；适应度：${notes.work_adaptation || "无"}；其他因素：${parseFactors(notes.other_factors) || "无"}；备注：${notes.other_factor_remark || "无"}`
    : "无";

  // 请假记录（最近 20 条）
  const leaveRows = db.prepare(
    "SELECT leave_type, start_date, end_date, reason FROM leave_requests WHERE employee_name = ? ORDER BY start_date DESC, id DESC LIMIT 20"
  ).all(emp.name) as { leave_type: string; start_date: string; end_date: string; reason: string }[];
  const leave = leaveRows.length
    ? leaveRows.map((l) => `${l.leave_type} ${l.start_date}~${l.end_date}：${l.reason || "无"}`).join("\n")
    : "无";

  let result;
  try {
    result = await assessEmployeeStatus({
      employeeName: emp.name,
      family,
      relationship,
      health,
      work,
      leave,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 评估失败" }, { status: 502 });
  }

  db.prepare(
    "INSERT INTO employee_status_assessments (employee_id, level, reason) VALUES (?, ?, ?) ON CONFLICT(employee_id) DO UPDATE SET level = excluded.level, reason = excluded.reason, analyzed_at = datetime('now')"
  ).run(employeeId, result.level, result.reason);

  return NextResponse.json({ employee_id: employeeId, level: result.level, reason: result.reason, cached: false });
}
