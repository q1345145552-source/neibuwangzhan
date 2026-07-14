import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { verifyToken } from "@/lib/auth";
import { corsResponse, handleOptions } from "@/lib/cors";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req.headers.get("origin"));
}

export async function GET(req: NextRequest) {
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

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  let sql = `SELECT o.id, o.customer_name, o.business_type_id, o.sub_service_type,
    o.address_type, o.monthly_rent, o.status, o.responsible_person,
    o.description, o.total_amount, o.currency, o.trademark_name,
    o.created_at, o.updated_at,
    bt.name as business_type_name
    FROM orders o
    LEFT JOIN business_types bt ON o.business_type_id = bt.id
    WHERE o.customer_name = ?`;
  const params: unknown[] = [payload.name];

  if (status) {
    sql += " AND o.status = ?";
    params.push(status);
  }
  sql += " ORDER BY o.created_at DESC";

  const rows = db.prepare(sql).all(...params);
  return corsResponse(rows, 200, origin);
}
