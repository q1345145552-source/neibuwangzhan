import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { verifyToken } from "@/lib/auth";
import { corsResponse, handleOptions } from "@/lib/cors";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req.headers.get("origin"));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get("origin");
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return corsResponse({ error: "未登录" }, 401, origin);
  }
  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (!payload || payload.role !== "client") {
    return corsResponse({ error: "无权限" }, 401, origin);
  }

  const { id } = await params;
  const db = getDb();

  const order = db.prepare(`
    SELECT o.*, bt.name as business_type_name
    FROM orders o
    LEFT JOIN business_types bt ON o.business_type_id = bt.id
    WHERE o.id = ? AND o.customer_name = ?
  `).get(id, payload.name) as any;

  if (!order) {
    return corsResponse({ error: "订单不存在" }, 404, origin);
  }

  const steps = db.prepare(
    "SELECT * FROM order_steps WHERE order_id = ? ORDER BY step_order"
  ).all(id);

  const documents = db.prepare(
    "SELECT * FROM documents WHERE order_id = ? ORDER BY created_at DESC"
  ).all(id);

  const finances = db.prepare(
    "SELECT * FROM finances WHERE order_id = ? ORDER BY created_at DESC"
  ).all(id);

  const certificates = db.prepare(
    "SELECT * FROM certificates WHERE order_id = ? ORDER BY created_at DESC"
  ).all(id);

  return corsResponse({
    ...order,
    steps,
    documents,
    finances,
    certificates,
  }, 200, origin);
}
