import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const user = searchParams.get("user");
  const type = searchParams.get("type"); // "influencer" 查达人步骤，否则查订单步骤
  if (!user) return NextResponse.json({ error: "缺少 user 参数" }, { status: 400 });

  const db = getDb();
  const likeUser = `%${user}%`;

  if (type === "influencer") {
    // 达人步骤：支持多负责人格式如 "Prae / Namcha"
    const rows = db.prepare(`
      SELECT is2.id as step_id, is2.influencer_id, is2.step_name, is2.status, is2.step_order,
             is2.phase, i.name as influencer_name, i.code as influencer_number, i.category
      FROM influencer_steps is2
      JOIN influencers i ON is2.influencer_id = i.id
      WHERE is2.assignee LIKE ? AND is2.status != '已完成'
      ORDER BY is2.influencer_id, is2.step_order
    `).all(likeUser);
    return NextResponse.json(rows);
  }

  // 订单步骤
  const rows = db.prepare(`
    SELECT os.id as step_id, os.order_id, os.step_name, os.status, os.step_order,
           o.customer_name, o.business_type_id, bt.name as business_type_name
    FROM order_steps os
    JOIN orders o ON os.order_id = o.id
    JOIN business_types bt ON o.business_type_id = bt.id
    WHERE os.assignee LIKE ? AND os.status != '已完成'
    ORDER BY os.step_order
  `).all(likeUser);

  return NextResponse.json(rows);
}
