import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

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

// PATCH /api/work-reports/[id] — 老板退回 / 员工退回后重新提交
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const report = db.prepare("SELECT * FROM work_reports WHERE id = ?").get(id) as any;
  if (!report) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  const body = await readJson(req);
  const { action } = body;

  // 老板退回
  if (action === "reject") {
    if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可退回" }, { status: 403 });
    if (report.status !== "已提交") return NextResponse.json({ error: "该记录不是已提交状态" }, { status: 400 });
    db.prepare("UPDATE work_reports SET status = '退回', updated_at = datetime('now') WHERE id = ?").run(id);
    logOperation(auth.name, "退回工作记录", "work_report", String(id), String(report.employee_name));
    return NextResponse.json(db.prepare("SELECT * FROM work_reports WHERE id = ?").get(id));
  }

  // 员工重新提交（退回后编辑再提交）
  if (report.employee_name !== auth.name) return NextResponse.json({ error: "只能改自己的工作记录" }, { status: 403 });
  if (report.status !== "退回") return NextResponse.json({ error: "只有退回的记录能修改" }, { status: 400 });

  const { completed_items, summary, tomorrow_plan, problems, related_objects } = body;
  let items: string[] = [];
  if (Array.isArray(completed_items)) {
    items = completed_items.map((s: unknown) => String(s).trim()).filter(Boolean);
  } else if (typeof completed_items === "string") {
    try {
      const p = JSON.parse(completed_items);
      if (Array.isArray(p)) items = p.map((s: unknown) => String(s).trim()).filter(Boolean);
    } catch {}
  }
  if (items.length === 0) return NextResponse.json({ error: "请至少填写一条今日已完成" }, { status: 400 });

  const relatedJson = parseRelatedObjects(related_objects);
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE work_reports SET completed_items = ?, summary = ?, tomorrow_plan = ?, problems = ?, related_objects = ?, status = '已提交', submitted_at = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(items), String(summary || "").trim(), String(tomorrow_plan || "").trim(), String(problems || "").trim(), relatedJson, now, id);
  logOperation(auth.name, "重新提交工作记录", "work_report", String(id), String(report.report_date));
  return NextResponse.json(db.prepare("SELECT * FROM work_reports WHERE id = ?").get(id));
}
