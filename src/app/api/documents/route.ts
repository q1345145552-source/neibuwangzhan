import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const business = searchParams.get("business");

  let sql = "SELECT d.*, o.customer_name, bt.name AS business_line FROM documents d LEFT JOIN orders o ON d.order_id = o.id LEFT JOIN business_types bt ON o.business_type_id = bt.id";
  const params: string[] = [];
  if (business) {
    sql += " WHERE bt.name = ?";
    params.push(business);
  }
  sql += " ORDER BY d.created_at DESC";
  const rows = db.prepare(sql).all(...params);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const db = getDb();
  const body = await req.json();
  const { name, file_type, file_url, order_id } = body;
  if (!name) return NextResponse.json({ error: "请提供文档名称" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO documents (order_id, name, file_type, status, direction, uploaded_by, file_url) VALUES (?, ?, ?, '已审核', 'client_to_us', ?, ?)"
  ).run(order_id || "", name, file_type || "", auth.name, file_url || "");
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(doc, { status: 201 });
}

