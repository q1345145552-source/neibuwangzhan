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

  // 收入一律「待核对」，到没到账只走老板核对（verify 接口，会记核对人）；不收前端传来的状态，免得员工直接录成「已到账」。
  // 支出只认「已付 / 待付」，默认待付。
  const finalStatus = type === "income" ? "待核对" : status === "paid" ? "paid" : "pending";
  const result = db.prepare(
    "INSERT INTO finances (order_id, type, amount, status, description, payment_method, slip_number, slip_file, currency, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, type, Number(amount), finalStatus, description || "", payment_method || "", slip_number || "", slip_file || "", currency || "CNY", auth.name);
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

  // 收入到没到账只走老板核对（verify 接口）：这里不改收入状态。已到账/未到账的收入（含 10-13 核对上线前直接记成已付的老记录），
  // 金额、币种、类型只有管理员能改，员工只能补描述、付款方式、流水号和截图。2026-10-15
  const before = existing as { type: string; amount: number; status: string; currency: string | null; description: string | null; slip_file: string | null; slip_number: string | null; payment_method: string | null };
  const isAdmin = auth.role === "admin";
  const nextType = type !== undefined ? String(type) : before.type;
  if (nextType !== "income" && nextType !== "expense") return NextResponse.json({ error: "type 必须是 income 或 expense" }, { status: 400 });
  if (amount !== undefined && (amount === "" || isNaN(Number(amount)) || Number(amount) < 0)) return NextResponse.json({ error: "金额必须是非负数字" }, { status: 400 });
  const settledIncome = before.type === "income" && (before.status === "paid" || before.status === "未到账");
  const moneyChanged = (amount !== undefined && Number(amount) !== Number(before.amount)) ||
    (currency !== undefined && String(currency || "CNY") !== String(before.currency || "CNY")) || nextType !== before.type;
  if (settledIncome && moneyChanged && !isAdmin) {
    return NextResponse.json({ error: "这笔收入已经核对过，金额、币种和类型只有管理员能改" }, { status: 403 });
  }
  let nextStatus: string | undefined;
  if (nextType === "income") {
    if (before.type !== "income") nextStatus = "待核对"; // 支出改成收入：重新等老板核对
    else if (status !== undefined && status !== before.status) {
      return NextResponse.json({ error: "收入到没到账请在「费用管理」→「待核对」里核对，这里不能改" }, { status: 400 });
    }
  } else if (status !== undefined) {
    if (!["paid", "pending", "cancelled"].includes(String(status))) return NextResponse.json({ error: "支出状态只能是已付、待付或已取消" }, { status: 400 });
    nextStatus = String(status);
  } else if (before.type === "income") nextStatus = "pending"; // 收入改成支出：不带着收入的状态走

  const fields: string[] = [];
  const values: unknown[] = [];
  if (type !== undefined) { fields.push("type = ?"); values.push(type); }
  if (amount !== undefined) { fields.push("amount = ?"); values.push(Number(amount)); }
  if (description !== undefined) { fields.push("description = ?"); values.push(description); }
  if (payment_method !== undefined) { fields.push("payment_method = ?"); values.push(payment_method); }
  if (slip_number !== undefined) { fields.push("slip_number = ?"); values.push(slip_number); }
  if (slip_file !== undefined) { fields.push("slip_file = ?"); values.push(slip_file); }
  if (nextStatus !== undefined && nextStatus !== before.status) { fields.push("status = ?"); values.push(nextStatus); }
  if (nextType === "income" && before.type !== "income") fields.push("verify_by = ''", "verify_at = ''", "verify_note = ''");
  if (currency !== undefined) { fields.push("currency = ?"); values.push(currency || "CNY"); }

  if (fields.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });

  values.push(finance_id);
  db.prepare(`UPDATE finances SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  const updated = db.prepare("SELECT * FROM finances WHERE id = ?").get(finance_id) as typeof before;
  const label = (t: string) => t === "income" ? "收入" : "支出";
  const cur = (c: string | null) => (c || "CNY") === "THB" ? "泰铢" : "人民币";
  const changes: string[] = [];
  if (updated.type !== before.type) changes.push(`类型 ${label(before.type)} → ${label(updated.type)}`);
  if (Number(updated.amount) !== Number(before.amount) || (updated.currency || "CNY") !== (before.currency || "CNY")) {
    changes.push(`金额 ${before.amount} ${cur(before.currency)} → ${updated.amount} ${cur(updated.currency)}`);
  }
  if (updated.status !== before.status) changes.push(`状态 ${before.status} → ${updated.status}`);
  if ((updated.description || "") !== (before.description || "")) changes.push("描述已改");
  if ((updated.slip_file || "") !== (before.slip_file || "")) changes.push(`截图 ${before.slip_file || "无"} → ${updated.slip_file || "无"}`);
  if ((updated.slip_number || "") !== (before.slip_number || "")) changes.push(`流水号 ${before.slip_number || "无"} → ${updated.slip_number || "无"}`);
  if ((updated.payment_method || "") !== (before.payment_method || "")) changes.push(`付款方式 ${before.payment_method || "无"} → ${updated.payment_method || "无"}`);
  logOperation(auth.name, "修改费用", "finance", String(finance_id), `订单:${id} ${changes.join("；") || "没有实际改动"}`);
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

  const gone = existing as { type: string; status: string; amount: number; currency: string | null };
  if (gone.type === "income" && (gone.status === "paid" || gone.status === "未到账") && auth.role !== "admin") {
    return NextResponse.json({ error: "这笔收入已经核对过，只有管理员能删" }, { status: 403 });
  }
  db.prepare("DELETE FROM finances WHERE id = ?").run(finance_id);
  logOperation(auth.name, "删除费用", "finance", String(finance_id), `订单:${id} ${gone.type === "income" ? "收入" : "支出"} ${gone.amount} ${(gone.currency || "CNY") === "THB" ? "泰铢" : "人民币"}（${gone.status}）`);
  return NextResponse.json({ success: true });
}
