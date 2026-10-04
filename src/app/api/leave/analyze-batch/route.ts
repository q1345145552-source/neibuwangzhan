import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { analyzeLeave } from "@/lib/leave-ai";

// POST /api/leave/analyze-batch — 一键批量分析请假（仅管理员）
// body: { ids?: number[] } — 不给 ids 则分析所有尚未分析过的请假
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);

  let ids: number[];
  if (Array.isArray(body?.ids)) {
    ids = (body.ids as unknown[]).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  } else {
    // 分析所有尚未有分析结果的请假
    const rows = db.prepare(
      "SELECT l.id FROM leave_requests l LEFT JOIN leave_ai_analyses a ON a.leave_id = l.id WHERE a.judgment IS NULL OR a.judgment = '' ORDER BY l.start_date DESC, l.id DESC"
    ).all() as { id: number }[];
    ids = rows.map((r) => r.id);
  }

  if (ids.length === 0) return NextResponse.json({ results: [], total: 0, analyzed: 0 });

  const results: any[] = [];
  let analyzed = 0;
  for (const id of ids) {
    try {
      const r = await analyzeLeave(db, id);
      results.push(r);
      if (!r.cached) analyzed++;
    } catch (e) {
      results.push({ leave_id: id, error: e instanceof Error ? e.message : "分析失败" });
    }
  }

  return NextResponse.json({ results, total: ids.length, analyzed });
}
