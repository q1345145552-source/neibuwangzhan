import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const user = searchParams.get("user");
  if (!user) return NextResponse.json({ error: "缺少 user 参数" }, { status: 400 });

  const db = getDb();
  const rows = db.prepare(`
    SELECT os.id as step_id, os.order_id, os.step_name, os.status, os.step_order,
           o.customer_name, o.business_type_id, bt.name as business_type_name
    FROM order_steps os
    JOIN orders o ON os.order_id = o.id
    JOIN business_types bt ON o.business_type_id = bt.id
    WHERE os.assignee = ? AND os.status != '已完成'
    ORDER BY os.step_order
  `).all(user);

  return NextResponse.json(rows);
}
