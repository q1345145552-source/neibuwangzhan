import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/customers — list all customers, with optional search & status filter
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const status = url.searchParams.get("status") || "";

  const db = getDb();
  let sql = "SELECT * FROM customers";
  const conditions: string[] = [];
  const params: string[] = [];

  if (search) {
    conditions.push("(company_name LIKE ? OR owner_name LIKE ? OR handler_name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }

  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY updated_at DESC";

  const rows = db.prepare(sql).all(...params);
  return NextResponse.json(rows);
}

// POST /api/customers
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json();
  const { company_name } = body;
  if (!company_name?.trim()) return NextResponse.json({ error: "请输入公司名称" }, { status: 400 });

  const db = getDb();
  // Check duplicate
  const existing = db.prepare("SELECT id FROM customers WHERE company_name = ?").get(company_name.trim());
  if (existing) return NextResponse.json({ error: "该公司已存在" }, { status: 409 });

  const result = db.prepare(`
    INSERT INTO customers (company_name, industry, company_type, founded_at, source_channel, owner_name, owner_wechat, handler_name, handler_wechat, willingness, demand_tags, status, total_deal_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    company_name.trim(),
    body.industry || "",
    body.company_type || "",
    body.founded_at || "",
    body.source_channel || "",
    body.owner_name || "",
    body.owner_wechat || "",
    body.handler_name || "",
    body.handler_wechat || "",
    body.willingness || "",
    body.demand_tags || "",
    body.status || "潜在",
    body.total_deal_amount || 0
  );
  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

// PATCH /api/customers
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });

  const db = getDb();
  const fields = ["company_name","industry","company_type","founded_at","source_channel","owner_name","owner_wechat","handler_name","handler_wechat","willingness","demand_tags","status","total_deal_amount"];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) { sets.push(`${f}=?`); vals.push(body[f]); }
  }
  if (!sets.length) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_at=datetime('now')");

  db.prepare(`UPDATE customers SET ${sets.join(",")} WHERE id=?`).run(...vals, id);
  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
  return NextResponse.json(row);
}

// DELETE /api/customers?id=xxx
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });

  const db = getDb();
  db.prepare("DELETE FROM customer_follow_ups WHERE customer_id = ?").run(id);
  db.prepare("DELETE FROM customer_points WHERE customer_id = ?").run(id);
  db.prepare("DELETE FROM customers WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
