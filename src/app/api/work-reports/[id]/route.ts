import { publishBossSubmission, acknowledgeBossSubmission } from "@/lib/boss-submissions";
import { reportSubmissionRevision } from "@/lib/boss-submission-types";
import { completeWorkReportTodos } from "@/lib/work-report-sync";
import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { analyzeWorkReport } from "@/lib/deepseek";
import { normalizeCompletedItems, completedItemText } from "@/lib/work-report-items";
import { WORK_REPORT_RETURN_TITLE } from "@/lib/notification-types";

// 校验并序列化关联业务对象 [{type, id, name}] → JSON 字符串
function parseRelatedObjects(raw: unknown): string {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) arr = p; } catch {}
  }
  const out: { type: string; id: string; name: string }[] = [];
  for (const o of arr) {
    if (!o || typeof o !== "object") continue;
    const rec = o as Record<string, unknown>;
    const type = String(rec.type || "").trim();
    const id = String(rec.id ?? "").trim();
    const name = String(rec.name || "").trim();
    if (!type || !id || !["project", "customer", "order"].includes(type)) continue;
    out.push({ type, id, name });
  }
  return JSON.stringify(out);
}

// 给所有在职老板发一条「日报有风险」系统通知
function notifyRisk(db: ReturnType<typeof getDb>, reportId: number, employeeName: string, date: string, riskDesc: string) {
  const parts = date.split("-").map(Number);
  const admins = db.prepare("SELECT name FROM employees WHERE role = 'admin' AND status = '在职'").all() as { name: string }[];
  if (admins.length === 0) return;
  const ins = db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES ('日报风险', '日报风险提醒', ?, ?, ?, 'work_report')");
  for (const a of admins) {
    ins.run(`${employeeName} ${parts[1]}月${parts[2]}日 的日报有风险：${riskDesc}`, a.name, String(reportId));
  }
}

// 通知定位只读查询；不记录已阅，已阅仍由用户打开详情时的原有流程处理。
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "日报编号无效" }, { status: 400 });
  }
  const db = getDb();
  const report = auth.role === "admin"
    ? db.prepare("SELECT * FROM work_reports WHERE id = ?").get(id)
    : db.prepare("SELECT * FROM work_reports WHERE id = ? AND employee_name = ?").get(id, auth.name);
  if (!report) return NextResponse.json({ error: "日报不存在或你无权查看" }, { status: 404 });
  return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
}

// PATCH /api/work-reports/[id] — 老板退回 / 员工退回后重新提交
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id } = await params;
  const body = await readJson(req);
  const { action } = body;
  if (action === "reject" && auth.role !== "admin") return NextResponse.json({ error: "仅管理员可退回" }, { status: 403 });
  const db = getDb();

  if (action === "reject") {
    const reason = typeof body.rejection_reason === "string" ? body.rejection_reason.trim() : "";
    if (!reason) return NextResponse.json({ error: "请填写退回原因" }, { status: 400 });
    return db.transaction(() => {
      const report = db.prepare("SELECT * FROM work_reports WHERE id = ?").get(id) as any;
      if (!report) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
      if (report.status !== "已提交") return NextResponse.json({ error: "该记录不是已提交状态" }, { status: 400 });
      if (typeof report.employee_name !== "string" || !report.employee_name.trim()) return NextResponse.json({ error: "日报员工信息无效" }, { status: 409 });
      if (body.submission_revision !== undefined && body.submission_revision !== reportSubmissionRevision(report)) return NextResponse.json({ error: "日报已重新提交，请重新打开后审核" }, { status: 409 });
      const changed = db.prepare("UPDATE work_reports SET status = '退回', rejection_reason = ?, updated_at = datetime('now') WHERE id = ? AND status = '已提交'").run(reason, report.id);
      if (changed.changes !== 1) return NextResponse.json({ error: "日报状态已变化，请刷新后重试" }, { status: 409 });
      db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)").run(
        "", WORK_REPORT_RETURN_TITLE, `${auth.name}退回了你 ${report.report_date} 的日报。\n退回原因：${reason}\n请修改日报后重新提交。`,
        report.employee_name, String(report.id), "work_report_return"
      );
      logOperation(auth.name, "退回工作记录", "work_report", String(report.id), String(report.employee_name));
      return NextResponse.json(db.prepare("SELECT * FROM work_reports WHERE id = ?").get(report.id));
    }).immediate();
  }

  const report = db.prepare("SELECT * FROM work_reports WHERE id = ?").get(id) as any;
  if (!report) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  // 老板点评：打 1-5 星 + 一句点评（任意状态都能点评）
  if (action === "review") {
    if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可点评" }, { status: 403 });
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return NextResponse.json({ error: "请打 1-5 星" }, { status: 400 });
    const comment = String(body.comment || "").trim();
    db.prepare("UPDATE work_reports SET boss_rating = ?, boss_comment = ?, updated_at = datetime('now') WHERE id = ?").run(rating, comment, id);
    if (report.status === "已提交") acknowledgeBossSubmission(db, "report", Number(id), auth.name, reportSubmissionRevision(report));
    logOperation(auth.name, "点评工作记录", "work_report", String(id), `${rating}星 ${comment}`);

    // 通知被点评的员工（每次点评都通知，改了也通知）
    try {
      const parts = String(report.report_date || "").split("-").map(Number);
      const monthDay = parts.length === 3 ? `${parts[1]}月${parts[2]}日` : report.report_date;
      db.prepare(
        "INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES ('日报点评', '老板点评了你的日报', ?, ?, ?, 'work_report')"
      ).run(`老板点评了你的 ${monthDay} 工作记录，评了 ${rating} 星`, report.employee_name, String(id));
    } catch {}

    return NextResponse.json(db.prepare("SELECT * FROM work_reports WHERE id = ?").get(id));
  }

  // 员工重新提交（退回后编辑再提交）
  if (report.employee_name !== auth.name) return NextResponse.json({ error: "只能改自己的工作记录" }, { status: 403 });
  if (report.status !== "退回") return NextResponse.json({ error: "只有退回的记录能修改" }, { status: 400 });

  const { completed_items, summary, tomorrow_plan, problems, related_objects } = body;
  const items = normalizeCompletedItems(completed_items);
  if (items.length === 0) return NextResponse.json({ error: "请至少填写一条今日已完成" }, { status: 400 });

  const relatedJson = parseRelatedObjects(related_objects);
  const summaryText = String(summary || "").trim();
  const planText = String(tomorrow_plan || "").trim();
  const problemsText = String(problems || "").trim();
  const now = new Date().toISOString();
  const submitted = db.transaction(() => {
    const saved = db.prepare(
    "UPDATE work_reports SET completed_items = ?, summary = ?, tomorrow_plan = ?, problems = ?, related_objects = ?, completed_items_zh = '', summary_zh = '', tomorrow_plan_zh = '', problems_zh = '', status = '已提交', submitted_at = ?, updated_at = datetime('now') WHERE id = ? AND status = '退回'"
  ).run(JSON.stringify(items), summaryText, planText, problemsText, relatedJson, now, id);
    if (saved.changes) {
      publishBossSubmission(db, "report", Number(id), auth.name, `重新提交了 ${report.report_date} 的日报`);
      completeWorkReportTodos(db, auth.name, report.report_date, now);
    }
    return saved.changes;
  })();
  if (!submitted) return NextResponse.json({ error: "记录状态已变化，请刷新后重试" }, { status: 409 });
  logOperation(auth.name, "重新提交工作记录", "work_report", String(id), String(report.report_date));

  // 重新提交后重新用 AI 评估质量 + 判断风险（失败不阻断）
  try {
    const analysis = await analyzeWorkReport({ completedItems: items.map(completedItemText), summary: summaryText, tomorrowPlan: planText, problems: problemsText });
    if (analysis.risk) {
      const wasRisk = report.risk_flag === 1;
      db.prepare("UPDATE work_reports SET ai_label = ?, ai_comment = ?, risk_flag = 1, risk_desc = ? WHERE id = ?").run(analysis.label, analysis.comment, analysis.riskDesc, id);
      // 只有从「无风险」变成「有风险」时才通知老板，避免重交时重复轰炸
      if (!wasRisk) notifyRisk(db, Number(id), report.employee_name, report.report_date, analysis.riskDesc);
    } else {
      db.prepare("UPDATE work_reports SET ai_label = ?, ai_comment = ?, risk_flag = 0, risk_desc = '' WHERE id = ?").run(analysis.label, analysis.comment, id);
    }
  } catch (e) {
    console.error("[日报AI评估] 失败:", e);
  }

  return NextResponse.json(db.prepare("SELECT * FROM work_reports WHERE id = ?").get(id));
}
