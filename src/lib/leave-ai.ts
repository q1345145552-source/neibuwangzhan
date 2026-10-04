import type Database from "better-sqlite3";
import { analyzeLeaveRequest } from "./deepseek";

export interface LeaveAnalysisResult {
  leave_id: number;
  judgment: string;
  reason: string;
  detail: string;
  cached: boolean;
}

/** 分析一条请假（带缓存）：同一条不重复分析。员工不存在返回 error 标记。 */
export async function analyzeLeave(db: Database.Database, leaveId: number): Promise<LeaveAnalysisResult> {
  const leave = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(leaveId) as any;
  if (!leave) throw new Error("请假记录不存在");

  // 缓存命中：直接返回
  const cached = db.prepare("SELECT judgment, reason, detail, analyzed_at FROM leave_ai_analyses WHERE leave_id = ?").get(leaveId) as any;
  if (cached && cached.judgment) {
    return { leave_id: leaveId, judgment: cached.judgment, reason: cached.reason, detail: cached.detail || "", cached: true };
  }

  // 历史请假记录（排除本次，最近 20 条）
  const historyRows = db.prepare(
    "SELECT leave_type, start_date, end_date, reason FROM leave_requests WHERE employee_name = ? AND id != ? ORDER BY start_date DESC, id DESC LIMIT 20"
  ).all(leave.employee_name, leaveId) as { leave_type: string; start_date: string; end_date: string; reason: string }[];
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

  const result = await analyzeLeaveRequest({
    employeeName: leave.employee_name,
    leaveType: leave.leave_type,
    startDate: leave.start_date,
    endDate: leave.end_date,
    reason: leave.reason || "",
    history,
    personal,
  });

  db.prepare(
    "INSERT INTO leave_ai_analyses (leave_id, judgment, reason, detail) VALUES (?, ?, ?, ?) ON CONFLICT(leave_id) DO UPDATE SET judgment = excluded.judgment, reason = excluded.reason, detail = excluded.detail, analyzed_at = datetime('now')"
  ).run(leaveId, result.judgment, result.reason, result.detail);

  return { leave_id: leaveId, judgment: result.judgment, reason: result.reason, detail: result.detail, cached: false };
}
