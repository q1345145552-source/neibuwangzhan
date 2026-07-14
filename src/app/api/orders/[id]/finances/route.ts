import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb, logOperation } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const rows = db.prepare("SELECT * FROM finances WHERE order_id = ? ORDER BY created_at DESC").all(id);
  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { type, amount, description, payment_method, slip_number, slip_file, status, currency } = body;
  if (!type || !amount) return NextResponse.json({ error: "请提供类型和金额" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO finances (order_id, type, amount, status, description, payment_method, slip_number, slip_file, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, type, amount, status || "pending", description || "", payment_method || "", slip_number || "", slip_file || "", currency || "CNY");
  const fin = db.prepare("SELECT * FROM finances WHERE id = ?").get(result.lastInsertRowid) as { id: number };
  logOperation(auth.name, "添加费用", "finance", String(fin.id), `订单:${id} 类型:${type}`);
  return NextResponse.json(fin, { status: 201 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { finance_id, type, amount, description, payment_method, slip_number, slip_file, status, currency } = body;

  if (!finance_id) return NextResponse.json({ error: "缺少 finance_id" }, { status: 400 });

  const existing = db.prepare("SELECT * FROM finances WHERE id = ? AND order_id = ?").get(finance_id, id);
  if (!existing) return NextResponse.json({ error: "费用记录不存在" }, { status: 404 });

  const fields: string[] = [];
  const values: unknown[] = [];
  if (type !== undefined) { fields.push("type = ?"); values.push(type); }
  if (amount !== undefined) { fields.push("amount = ?"); values.push(Number(amount)); }
  if (description !== undefined) { fields.push("description = ?"); values.push(description); }
  if (payment_method !== undefined) { fields.push("payment_method = ?"); values.push(payment_method); }
  if (slip_number !== undefined) { fields.push("slip_number = ?"); values.push(slip_number); }
  if (slip_file !== undefined) { fields.push("slip_file = ?"); values.push(slip_file); }
  if (status !== undefined) { fields.push("status = ?"); values.push(status); }
  if (currency !== undefined) { fields.push("currency = ?"); values.push(currency || "CNY"); }

  if (fields.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });

  values.push(finance_id);
  db.prepare(`UPDATE finances SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  const updated = db.prepare("SELECT * FROM finances WHERE id = ?").get(finance_id);
  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { finance_id } = body;

  if (!finance_id) return NextResponse.json({ error: "缺少 finance_id" }, { status: 400 });

  const existing = db.prepare("SELECT * FROM finances WHERE id = ? AND order_id = ?").get(finance_id, id);
  if (!existing) return NextResponse.json({ error: "费用记录不存在" }, { status: 404 });

  db.prepare("DELETE FROM finances WHERE id = ?").run(finance_id);
  logOperation(auth.name, "删除费用", "finance", String(finance_id), `订单:${id}`);
  return NextResponse.json({ success: true });
}
