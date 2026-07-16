import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const employee = req.nextUrl.searchParams.get("employee") || "";
  const type = req.nextUrl.searchParams.get("type") || "";

  if (!employee || !type) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }

  let data: any[] = [];

  if (type === "tasks") {
    data = db.prepare(`
      SELECT id, task_number, category, status, created_at
      FROM discovery_tasks
      WHERE creator = ?
      ORDER BY created_at DESC
    `).all(employee);
  } else if (type === "influencers") {
    data = db.prepare(`
      SELECT id, name, code, category, phase, created_at
      FROM influencers
      WHERE created_by = ?
      ORDER BY created_at DESC
    `).all(employee);
  } else if (type === "evaluations") {
    data = db.prepare(`
      SELECT ie.id, ie.final_rating, ie.rating, ie.total_score, ie.created_at,
             i.id as influencer_id, i.name as influencer_name
      FROM influencer_evaluations ie
      JOIN influencers i ON ie.influencer_id = i.id
      WHERE ie.evaluated_by = ?
      ORDER BY ie.created_at DESC
    `).all(employee);
  } else if (type === "contracts") {
    data = db.prepare(`
      SELECT c.id, c.base_salary, c.commission, c.live_sessions, c.live_duration,
             c.video_count, c.payment_status, c.created_at,
             c.influencer_id, i.name as influencer_name
      FROM contracts c
      JOIN influencers i ON c.influencer_id = i.id
      WHERE c.created_by = ?
      ORDER BY c.created_at DESC
    `).all(employee);
  }

  return NextResponse.json({ type, employee, data });
}
