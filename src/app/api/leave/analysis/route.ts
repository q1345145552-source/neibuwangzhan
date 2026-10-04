import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// GET /api/leave/analysis — 请假 + AI 分析结果列表（仅管理员，供分析看板）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const rows = db.prepare(
    `SELECT l.id, l.employee_name, l.leave_type, l.start_date, l.end_date, l.reason, l.status, l.created_at,
            a.judgment, a.reason AS ai_reason, a.detail AS ai_detail, a.analyzed_at
     FROM leave_requests l
     LEFT JOIN leave_ai_analyses a ON a.leave_id = l.id
     ORDER BY l.start_date DESC, l.id DESC`
  ).all() as any[];

  return NextResponse.json({ leaves: rows });
}
