import { publishBossSubmission } from "@/lib/boss-submissions";
import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { bangkokToday } from "@/lib/time";
import { syncWorkReportReminders } from "@/lib/work-report-sync";
import { analyzeWorkReport } from "@/lib/deepseek";
import { normalizeCompletedItems, completedItemText } from "@/lib/work-report-items";

// 曼谷日期往前推 n 天（纯日历运算）
function bangkokDaysAgo(n: number): string {
  const d = new Date(bangkokToday() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0];
}

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

// GET /api/work-reports — 管理员看全部，员工看自己
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const isAdmin = auth.role === "admin";

  // 顺带触发提醒同步：昨天没交的生成补交待办，当天下午没交的发通知
  try { syncWorkReportReminders(); } catch {}

  const rows = isAdmin
    ? db.prepare("SELECT * FROM work_reports ORDER BY report_date DESC, id DESC").all()
    : db.prepare("SELECT * FROM work_reports WHERE employee_name = ? ORDER BY report_date DESC, id DESC").all(auth.name);
  return NextResponse.json(rows);
}

// POST /api/work-reports — 员工提交今日 / 补交昨日工作记录
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const { report_date, completed_items, summary, tomorrow_plan, problems, related_objects } = body;

  const today = bangkokToday();
  const yesterday = bangkokDaysAgo(1);

  if (!report_date || !String(report_date).trim()) return NextResponse.json({ error: "缺少日报日期" }, { status: 400 });
  const date = String(report_date).trim();
  if (date !== today && date !== yesterday) {
    return NextResponse.json({ error: "只能填今天或补交昨天" }, { status: 400 });
  }

  const existing = db.prepare("SELECT id FROM work_reports WHERE employee_name = ? AND report_date = ?").get(auth.name, date);
  if (existing) {
    return NextResponse.json({ error: date === today ? "今天已经提交过了" : "昨天已经提交过了" }, { status: 400 });
  }

  // 今日已完成：手动文本 + 勾选带出的结构化条目（至少一条）
  const items = normalizeCompletedItems(completed_items);
  if (items.length === 0) return NextResponse.json({ error: "请至少填写一条今日已完成" }, { status: 400 });

  const isBackfill = date === yesterday ? 1 : 0;
  const relatedJson = parseRelatedObjects(related_objects);
  const summaryText = String(summary || "").trim();
  const planText = String(tomorrow_plan || "").trim();
  const problemsText = String(problems || "").trim();
  const now = new Date().toISOString();
  const result = db.transaction(() => {
    const saved = db.prepare(
    "INSERT INTO work_reports (employee_name, report_date, completed_items, summary, tomorrow_plan, problems, related_objects, status, is_backfill, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, '已提交', ?, ?)"
  ).run(auth.name, date, JSON.stringify(items), summaryText, planText, problemsText, relatedJson, isBackfill, now);
    publishBossSubmission(db, "report", Number(saved.lastInsertRowid), auth.name, `提交了 ${date} 的日报`);
    return saved;
  })();
  logOperation(auth.name, "提交工作记录", "work_report", String(result.lastInsertRowid), date);

  // 提交后自动用 AI 评估质量 + 判断风险（失败不阻断提交，标签/风险留空）
  const reportId = Number(result.lastInsertRowid);
  try {
    const analysis = await analyzeWorkReport({ completedItems: items.map(completedItemText), summary: summaryText, tomorrowPlan: planText, problems: problemsText });
    if (analysis.risk) {
      db.prepare("UPDATE work_reports SET ai_label = ?, ai_comment = ?, risk_flag = 1, risk_desc = ? WHERE id = ?").run(analysis.label, analysis.comment, analysis.riskDesc, reportId);
      notifyRisk(db, reportId, auth.name, date, analysis.riskDesc);
    } else {
      db.prepare("UPDATE work_reports SET ai_label = ?, ai_comment = ?, risk_flag = 0, risk_desc = '' WHERE id = ?").run(analysis.label, analysis.comment, reportId);
    }
  } catch (e) {
    console.error("[日报AI评估] 失败:", e);
  }

  return NextResponse.json(db.prepare("SELECT * FROM work_reports WHERE id = ?").get(reportId), { status: 201 });
}
