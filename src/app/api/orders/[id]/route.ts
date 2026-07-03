import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/orders/:id
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!order) {
    return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  }

  const steps = db.prepare(
    "SELECT * FROM order_steps WHERE order_id = ? ORDER BY step_order"
  ).all(id);

  return NextResponse.json({ ...order as object, steps });
}

// PATCH /api/orders/:id
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  const db = getDb();

  const existing = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!existing) return NextResponse.json({ error: "订单不存在" }, { status: 404 });

  const body = await req.json();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (body.customer_name !== undefined) { fields.push("customer_name = ?"); values.push(body.customer_name); }
  if (body.business_type_id !== undefined) { fields.push("business_type_id = ?"); values.push(Number(body.business_type_id)); }
  if (body.responsible_person !== undefined) { fields.push("responsible_person = ?"); values.push(body.responsible_person); }
  if (body.description !== undefined) { fields.push("description = ?"); values.push(body.description); }
  if (body.total_amount !== undefined) { fields.push("total_amount = ?"); values.push(Number(body.total_amount)); }
  if (body.sub_service_type !== undefined) { fields.push("sub_service_type = ?"); values.push(body.sub_service_type); }
  if (body.address_type !== undefined) { fields.push("address_type = ?"); values.push(body.address_type); }
  if (body.monthly_rent !== undefined) { fields.push("monthly_rent = ?"); values.push(Number(body.monthly_rent)); }
  if (body.currency !== undefined) { fields.push("currency = ?"); values.push(body.currency); }

  if (fields.length === 0) return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });

  fields.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE orders SET ${fields.join(", ")} WHERE id = ?`).run(...values);

  const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  return NextResponse.json(updated);
}

// DELETE /api/orders/:id
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  const db = getDb();

  const existing = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!existing) return NextResponse.json({ error: "订单不存在" }, { status: 404 });

  db.transaction(() => {
    db.prepare("DELETE FROM step_notes WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM step_documents WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM order_steps WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM documents WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM finances WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM certificates WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM tasks WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM orders WHERE id = ?").run(id);
  })();

  return NextResponse.json({ success: true });
}
