import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { summarizeWorkReportStory } from "@/lib/deepseek";

function parseRelated(s: string): { type: string; id: string }[] {
  try {
    const a = JSON.parse(s || "[]");
    if (!Array.isArray(a)) return [];
    return a
      .map((o: Record<string, unknown>) => ({ type: String(o?.type || ""), id: String(o?.id ?? "") }))
      .filter((o) => o.type && o.id);
  } catch { return []; }
}

function parseItems(s: string): string[] {
  try { const a = JSON.parse(s || "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
}

function typeLabel(type: string): string {
  return type === "project" ? "项目" : type === "customer" ? "客户" : "订单";
}

// POST /api/work-reports/story/summary — 把围绕某业务对象的时间线串成一段脉络总结
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const body = await readJson(req);
  const type = String(body?.type || "").trim();
  const id = String(body?.id || "").trim();
  const name = String(body?.name || "").trim();
  if (!["project", "customer", "order"].includes(type) || !id) {
    return NextResponse.json({ error: "参数不对" }, { status: 400 });
  }

  const db = getDb();
  const isAdmin = auth.role === "admin";
  const rows = (isAdmin
    ? db.prepare("SELECT * FROM work_reports ORDER BY report_date ASC, id ASC").all()
    : db.prepare("SELECT * FROM work_reports WHERE employee_name = ? ORDER BY report_date ASC, id ASC").all(auth.name)) as any[];

  const filtered = rows.filter((r) => parseRelated(r.related_objects).some((o) => o.type === type && o.id === id));
  if (filtered.length === 0) return NextResponse.json({ error: "该对象下暂无相关日报" }, { status: 400 });

  const timeline = filtered
    .map((r) => {
      const parts = [parseItems(r.completed_items).join("、"), r.summary, r.problems].filter((s) => String(s).trim());
      return `${r.report_date} ${r.employee_name}：${parts.join("；")}`;
    })
    .join("\n");

  try {
    const summary = await summarizeWorkReportStory({ objectLabel: `${typeLabel(type)} ${name || id}`, timeline });
    return NextResponse.json({ summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI 总结失败";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
