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

  if (type === "order_steps") {
    data = db.prepare(`
      SELECT os.id, os.step_name, os.step_order, os.status, os.deadline,
             o.id as order_id, o.customer_name, o.status as order_status, o.phase
      FROM order_steps os
      JOIN orders o ON os.order_id = o.id
      WHERE os.assignee = ? AND os.status NOT IN ('已完成','已停止')
      ORDER BY os.deadline ASC, os.step_order ASC
    `).all(employee);
  } else if (type === "influencer_steps") {
    data = db.prepare(`
      SELECT ist.id, ist.step_name, ist.step_order, ist.phase, ist.status,
             i.id as influencer_id, i.name as influencer_name, i.code, i.status as influencer_status
      FROM influencer_steps ist
      JOIN influencers i ON ist.influencer_id = i.id
      WHERE ist.assignee = ? AND ist.status NOT IN ('已完成','已停止')
      ORDER BY ist.step_order ASC
    `).all(employee);
  } else if (type === "contract_infs") {
    data = db.prepare(`
      SELECT DISTINCT i.id, i.name, i.code, i.phase, i.status,
             c.id as contract_id, c.base_salary, c.commission, c.live_sessions,
             c.live_duration, c.video_count, c.payment_status
      FROM influencers i
      LEFT JOIN contracts c ON c.influencer_id = i.id
      WHERE i.phase = 'contract'
        AND i.status NOT IN ('已完成','已停止')
        AND i.id IN (
          SELECT influencer_id FROM influencer_steps
          WHERE assignee = ? AND status NOT IN ('已完成','已停止')
        )
      ORDER BY i.name ASC
    `).all(employee);
  }

  return NextResponse.json({ type, employee, data });
}
