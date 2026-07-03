import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const status = searchParams.get("status");

  let sql = "SELECT f.*, o.customer_name FROM finances f JOIN orders o ON f.order_id = o.id";
  const conditions: string[] = [];
  const params: string[] = [];
  if (type) { conditions.push("f.type = ?"); params.push(type); }
  if (status) { conditions.push("f.status = ?"); params.push(status); }
  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY f.created_at DESC";
  const rows = db.prepare(sql).all(...params);
  return NextResponse.json(rows);
}
