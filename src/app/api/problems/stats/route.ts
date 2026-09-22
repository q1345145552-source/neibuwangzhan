import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

// GET /api/problems/stats — 问题统计看板
// 返回：总问题数、已解决数、各类型计数、各负责人未解决计数
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) AS c FROM problems").get() as { c: number }).c;
  const resolved = (db.prepare("SELECT COUNT(*) AS c FROM problems WHERE status = '已解决'").get() as { c: number }).c;
  const byType = db.prepare(
    "SELECT problem_type AS type, COUNT(*) AS count FROM problems GROUP BY problem_type ORDER BY count DESC, problem_type ASC"
  ).all();
  const byAssignee = db.prepare(
    "SELECT assignee AS name, COUNT(*) AS count FROM problems WHERE status != '已解决' AND assignee != '' GROUP BY assignee ORDER BY count DESC, assignee ASC"
  ).all();

  return NextResponse.json({ total, resolved, by_type: byType, by_assignee_unresolved: byAssignee });
}
