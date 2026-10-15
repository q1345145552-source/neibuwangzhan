import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

// GET /api/work-reports/reviews — 仅老板可查看所有已点评日报。
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看点评汇总" }, { status: 403 });

  const reviews = getDb().prepare(`
    SELECT id, employee_name, report_date, boss_rating, boss_comment
    FROM work_reports
    WHERE boss_rating > 0 OR length(trim(coalesce(boss_comment, ''))) > 0
    ORDER BY report_date DESC, id DESC
  `).all();
  return NextResponse.json(reviews);
}
