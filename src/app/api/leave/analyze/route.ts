import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { analyzeLeaveRequest } from "@/lib/deepseek";

// POST /api/leave/analyze — 分析一次请假（正常/疑似异常），结果缓存，同一条不重复分析（仅管理员）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少请假ID" }, { status: 400 });

  const leave = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id) as any;
  if (!leave) return NextResponse.json({ error: "请假记录不存在" }, { status: 404 });

  // 缓存命中：同一条请假不重复分析
  const cached = db.prepare("SELECT judgment, reason, analyzed_at FROM leave_ai_analyses WHERE leave_id = ?").get(id) as any;
  if (cached && cached.judgment) {
    return NextResponse.json({ leave_id: id, judgment: cached.judgment, reason: cached.reason, analyzed_at: cached.analyzed_at, cached: true });
  }

  // 历史请假记录（排除本次，最近 20 条）
  const historyRows = db.prepare(
    "SELECT leave_type, start_date, end_date, reason FROM leave_requests WHERE employee_name = ? AND id != ? ORDER BY start_date DESC, id DESC LIMIT 20"
  ).all(leave.employee_name, id) as { leave_type: string; start_date: string; end_date: string; reason: string }[];
  const history = historyRows.map((h) => `${h.leave_type} ${h.start_date}~${h.end_date}：${h.reason || "无"}`).join("\n");

  // 个人情况（家庭/感情/父母/工作 + 近期跟进）
  const emp = db.prepare("SELECT id FROM employees WHERE name = ?").get(leave.employee_name) as { id: number } | undefined;
  let personal = "";
  if (emp) {
    const notes = db.prepare("SELECT * FROM employee_personal_notes WHERE employee_id = ?").get(emp.id) as any;
    if (notes) {
      personal = [
        `家庭：${notes.family_composition || "无"}；关系：${notes.family_relationship || "无"}；经济：${notes.family_economy || "无"}`,
        `感情：${notes.relationship_status || "无"}（${notes.relationship_stability || "未知"}）；影响工作：${notes.relationship_affect || "无"}`,
        `父母：${notes.parents_alive || "无"}；健康：${notes.parents_health || "无"}；需照顾：${notes.parents_care || "无"}`,
        `工作：状态${notes.work_status || "无"}；压力${notes.work_pressure || "无"}；心态${notes.work_mentality || "无"}；适应度${notes.work_adaptation || "无"}`,
      ].join("\n");
    }
    const followups = db.prepare(
      "SELECT follow_date, content FROM employee_personal_followups WHERE employee_id = ? ORDER BY follow_date DESC, id DESC LIMIT 5"
    ).all(emp.id) as { follow_date: string; content: string }[];
    if (followups.length) {
      personal += "\n\n近期跟进：\n" + followups.map((f) => `${f.follow_date} ${f.content}`).join("\n");
    }
  }

  let result;
  try {
    result = await analyzeLeaveRequest({
      employeeName: leave.employee_name,
      leaveType: leave.leave_type,
      startDate: leave.start_date,
      endDate: leave.end_date,
      reason: leave.reason || "",
      history,
      personal,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 分析失败" }, { status: 502 });
  }

  db.prepare(
    "INSERT INTO leave_ai_analyses (leave_id, judgment, reason) VALUES (?, ?, ?) ON CONFLICT(leave_id) DO UPDATE SET judgment = excluded.judgment, reason = excluded.reason, analyzed_at = datetime('now')"
  ).run(id, result.judgment, result.reason);

  return NextResponse.json({ leave_id: id, judgment: result.judgment, reason: result.reason, cached: false });
}
