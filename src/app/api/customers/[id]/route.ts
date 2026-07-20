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
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
  if (!customer) return NextResponse.json({ error: "客户不存在" }, { status: 404 });

  const follow_ups = db.prepare("SELECT * FROM customer_follow_ups WHERE customer_id = ? ORDER BY created_at DESC").all(id);
  const points = db.prepare("SELECT * FROM customer_points WHERE customer_id = ? ORDER BY created_at DESC").all(id);

  return NextResponse.json({ ...customer as any, follow_ups, points });
}
