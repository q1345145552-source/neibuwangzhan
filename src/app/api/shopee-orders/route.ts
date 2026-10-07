import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";

// Shopee 客户订单：记录每单下单日期、客户、购买店铺数量、订单状态。

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const q = searchParams.get("q");

  let sql = "SELECT * FROM shopee_orders";
  const conds: string[] = [];
  const params: any[] = [];
  if (status && status !== "all") { conds.push("status = ?"); params.push(status); }
  if (q && q.trim()) { conds.push("customer_name LIKE ?"); params.push(`%${q.trim()}%`); }
  if (conds.length) sql += " WHERE " + conds.join(" AND ");
  sql += " ORDER BY order_date DESC, id DESC";
  return NextResponse.json(db.prepare(sql).all(...params));
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { order_date, customer_name, store_qty, status } = body;

  const _e = validateEnums({ "shopee_orders.status": status });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });
  if (!order_date) return NextResponse.json({ error: "请选择下单日期" }, { status: 400 });
  if (!customer_name || !String(customer_name).trim()) return NextResponse.json({ error: "请填写客户名称" }, { status: 400 });
  const n = Number(store_qty);
  if (!Number.isInteger(n) || n < 1) return NextResponse.json({ error: "购买店铺数量必须是正整数" }, { status: 400 });

  const r = db.prepare(
    "INSERT INTO shopee_orders (order_date, customer_name, store_qty, status, created_by) VALUES (?, ?, ?, ?, ?)"
  ).run(order_date, String(customer_name).trim(), n, status || "有可售店铺", auth.name);
  logOperation(auth.name, "新增客户订单", "shopee_order", String(r.lastInsertRowid), String(customer_name));
  return NextResponse.json(db.prepare("SELECT * FROM shopee_orders WHERE id = ?").get(r.lastInsertRowid), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { id, order_date, customer_name, store_qty, status } = body;
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });

  const _e = validateEnums({ "shopee_orders.status": status });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });
  if (store_qty !== undefined && (!Number.isInteger(Number(store_qty)) || Number(store_qty) < 1)) {
    return NextResponse.json({ error: "购买店铺数量必须是正整数" }, { status: 400 });
  }

  const sets: string[] = [];
  const vals: any[] = [];
  if (order_date !== undefined) { sets.push("order_date = ?"); vals.push(order_date); }
  if (customer_name !== undefined) { sets.push("customer_name = ?"); vals.push(String(customer_name).trim()); }
  if (store_qty !== undefined) { sets.push("store_qty = ?"); vals.push(Number(store_qty)); }
  if (status !== undefined) { sets.push("status = ?"); vals.push(status); }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE shopee_orders SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  logOperation(auth.name, "修改客户订单", "shopee_order", String(id), String(customer_name ?? ""));
  return NextResponse.json(db.prepare("SELECT * FROM shopee_orders WHERE id = ?").get(id));
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  getDb().prepare("DELETE FROM shopee_orders WHERE id = ?").run(id);
  logOperation(auth.name, "删除客户订单", "shopee_order", String(id));
  return NextResponse.json({ success: true });
}
