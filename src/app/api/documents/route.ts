import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const business = searchParams.get("business");

  let sql = "SELECT d.*, o.customer_name, o.business_type_id FROM documents d JOIN orders o ON d.order_id = o.id";
  const params: string[] = [];
  if (business) {
    const bt = db.prepare("SELECT id FROM business_types WHERE name = ?").get(business) as { id: number } | undefined;
    if (bt) {
      sql += " WHERE o.business_type_id = ?";
      params.push(String(bt.id));
    }
  }
  sql += " ORDER BY d.created_at DESC";
  const rows = db.prepare(sql).all(...params);
  return NextResponse.json(rows);
}
