import { isClientOrderVisible } from "@/lib/client-scope";
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";
import { isCommerceRefund } from "@/lib/commerce-ledger";
import { isCommerceOrder } from "@/lib/commerce-schema";
import { moneyToCents } from "@/lib/sync-money";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id } = await params;
  if (auth.role === "client" && !isClientOrderVisible(auth.id, auth.name, id)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const db = getDb();
  const rows = db.prepare("SELECT * FROM finances WHERE order_id = ? ORDER BY created_at DESC").all(id);
  return NextResponse.json((rows as {id:number}[]).map(row=>({...row,commerce_refund:isCommerceRefund(db,row.id)})));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  if (auth.role === "client" && !isClientOrderVisible(auth.id, auth.name, id)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const db = getDb();
  const body = await readJson(req);
  const { type, amount, description, payment_method, slip_number, slip_file, status, currency } = body;
  if (isCommerceOrder(db,id) && type !== "expense") {
    return NextResponse.json({ error: "商城收款统一由管理员在商城账单确认；此处仅录成本" }, { status: 409 });
  }
  if (isCommerceOrder(db,id)) {
    try { moneyToCents(amount,"成本金额"); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "成本金额有误" },{ status: 400 }); }
  }
  // amount 用 == null 判断而不是取反，否则金额 0 会被误拒
  if (!type || amount == null || amount === "") return NextResponse.json({ error: "请提供类型和金额" }, { status: 400 });
  if (type !== "income" && type !== "expense") return NextResponse.json({ error: "type 必须是 income 或 expense" }, { status: 400 });
  if (isNaN(Number(amount)) || Number(amount) < 0) return NextResponse.json({ error: "金额必须是非负数字" }, { status: 400 });
  const order = db.prepare("SELECT id FROM orders WHERE id = ?").get(id);
  if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 404 });

  const result = db.prepare(
    "INSERT INTO finances (order_id, type, amount, status, description, payment_method, slip_number, slip_file, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, type, Number(amount), status || "pending", description || "", payment_method || "", slip_number || "", slip_file || "", currency || "CNY");
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
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  if (auth.role === "client" && !isClientOrderVisible(auth.id, auth.name, id)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const db = getDb();
  const body = await readJson(req);
  const { finance_id, type, amount, description, payment_method, slip_number, slip_file, status, currency } = body;

  if (!finance_id) return NextResponse.json({ error: "缺少 finance_id" }, { status: 400 });

  const existing = db.prepare("SELECT * FROM finances WHERE id = ? AND order_id = ?").get(finance_id, id);
  if (!existing) return NextResponse.json({ error: "费用记录不存在" }, { status: 404 });

  if (isCommerceRefund(db,Number(finance_id))) return NextResponse.json({error:"商城退款记录请保留凭证，不从成本入口修改"},{status:409});
  if (isCommerceOrder(db,id) && ((existing as { type: string }).type !== "expense" || (type !== undefined && type !== "expense"))) {
    return NextResponse.json({ error: "商城收入记录关联账单，请保留原收款记录" }, { status: 409 });
  }
  if (isCommerceOrder(db,id) && amount !== undefined) {
    try { moneyToCents(amount,"成本金额"); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "成本金额有误" },{ status: 400 }); }
  }

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
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  if (auth.role === "client" && !isClientOrderVisible(auth.id, auth.name, id)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const db = getDb();
  const body = await readJson(req);
  const { finance_id } = body;

  if (!finance_id) return NextResponse.json({ error: "缺少 finance_id" }, { status: 400 });

  const existing = db.prepare("SELECT * FROM finances WHERE id = ? AND order_id = ?").get(finance_id, id);
  if (!existing) return NextResponse.json({ error: "费用记录不存在" }, { status: 404 });

  if (isCommerceRefund(db,Number(finance_id))) return NextResponse.json({error:"商城退款记录请保留凭证，不从成本入口删除"},{status:409});
  if (isCommerceOrder(db,id) && (existing as { type: string }).type !== "expense") {
    return NextResponse.json({ error: "商城收入记录关联账单，请保留原收款记录" }, { status: 409 });
  }

  db.prepare("DELETE FROM finances WHERE id = ?").run(finance_id);
  logOperation(auth.name, "删除费用", "finance", String(finance_id), `订单:${id}`);
  return NextResponse.json({ success: true });
}
