import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/customers/[id] — get single customer with follow-ups and points
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  // Apply auto-flow before reading
  db.exec("UPDATE customers SET status = '已合作', updated_at = datetime('now') WHERE status = '跟进中' AND company_name IN (SELECT DISTINCT customer_name FROM orders)");
  db.exec("UPDATE customers SET status = '沉睡', updated_at = datetime('now') WHERE status = '跟进中' AND id NOT IN (SELECT DISTINCT customer_id FROM customer_follow_ups WHERE created_at >= datetime('now', '-1 month'))");
  db.exec("UPDATE customers SET status = '沉睡', updated_at = datetime('now') WHERE status = '已合作' AND company_name NOT IN (SELECT DISTINCT customer_name FROM orders WHERE created_at >= datetime('now', '-3 months'))");

  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
  if (!customer) return NextResponse.json({ error: "客户不存在" }, { status: 404 });

  const follow_ups = db.prepare("SELECT * FROM customer_follow_ups WHERE customer_id = ? ORDER BY created_at DESC").all(id);
  const points = db.prepare("SELECT * FROM customer_points WHERE customer_id = ? ORDER BY created_at DESC").all(id);

  return NextResponse.json({ ...customer as any, follow_ups, points });
}
