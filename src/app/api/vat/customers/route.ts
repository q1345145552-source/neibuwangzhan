import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/vat/customers
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const rows = db.prepare("SELECT * FROM vat_customers ORDER BY status, company_name").all();
  return NextResponse.json(rows);
}

// POST /api/vat/customers
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const body = await req.json();
  const { company_name, tax_id, contact, status } = body;
  if (!company_name?.trim()) return NextResponse.json({ error: "请输入公司名称" }, { status: 400 });

  const db = getDb();
  const result = db.prepare(
    "INSERT INTO vat_customers (company_name, tax_id, contact, status) VALUES (?, ?, ?, ?)"
  ).run(company_name.trim(), tax_id || "", contact || "", status || "启用");
  const row = db.prepare("SELECT * FROM vat_customers WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

// PATCH /api/vat/customers
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const body = await req.json();
  const { id, company_name, tax_id, contact, status } = body;
  if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });
  if (!company_name?.trim()) return NextResponse.json({ error: "请输入公司名称" }, { status: 400 });

  const db = getDb();
  db.prepare(
    "UPDATE vat_customers SET company_name=?, tax_id=?, contact=?, status=?, updated_at=datetime('now') WHERE id=?"
  ).run(company_name.trim(), tax_id || "", contact || "", status || "启用", id);
  const row = db.prepare("SELECT * FROM vat_customers WHERE id = ?").get(id);
  return NextResponse.json(row);
}

// DELETE /api/vat/customers?id=xxx
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });

  const db = getDb();
  db.prepare("DELETE FROM vat_customers WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
