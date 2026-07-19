import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/vat/records/[id]/finances
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const rows = db.prepare("SELECT * FROM vat_record_finances WHERE record_id = ? ORDER BY created_at DESC").all(id);
  return NextResponse.json(rows);
}

// POST /api/vat/records/[id]/finances
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { type, amount, description, payment_method, slip_number, slip_file, status, currency } = body;
  if (!description?.trim() || !amount) return NextResponse.json({ error: "请填写描述和金额" }, { status: 400 });
  
  const result = db.prepare(
    "INSERT INTO vat_record_finances (record_id, type, amount, description, payment_method, slip_number, slip_file, status, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, type || "income", Number(amount), description, payment_method || "", slip_number || "", slip_file || "", status || "paid", currency || "CNY");
  const finance = db.prepare("SELECT * FROM vat_record_finances WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(finance, { status: 201 });
}

// PUT /api/vat/records/[id]/finances
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { finance_id, type, amount, description, payment_method, slip_number, slip_file, status, currency } = body;
  if (!finance_id) return NextResponse.json({ error: "缺少 finance_id" }, { status: 400 });
  
  db.prepare(
    "UPDATE vat_record_finances SET type=?, amount=?, description=?, payment_method=?, slip_number=?, slip_file=?, status=?, currency=? WHERE id=? AND record_id=?"
  ).run(type, Number(amount), description, payment_method || "", slip_number || "", slip_file || "", status, currency, finance_id, id);
  return NextResponse.json({ success: true });
}

// DELETE /api/vat/records/[id]/finances
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });
  const url = new URL(req.url);
  const financeId = url.searchParams.get("id");
  if (!financeId) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  const db = getDb();
  db.prepare("DELETE FROM vat_record_finances WHERE id = ?").run(financeId);
  return NextResponse.json({ success: true });
}
