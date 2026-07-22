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

  const body = await req.json();
  const { id, company_name, tax_id, contact, status } = body;
  if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });
  if (!company_name?.trim()) return NextResponse.json({ error: "请输入公司名称" }, { status: 400 });

  const db = getDb();
  db.prepare(
    "UPDATE vat_customers SET company_name=?, tax_id=?, contact=?, status=?, updated_at=datetime('now') WHERE id=?"
  ).run(company_name.trim(), tax_id || "", contact || "", status || "启用", id);

  // 改为已终止时，自动停止该客户当月未完成的申报记录，从本月申报列表消失
  if (status === "已终止") {
    db.prepare(
      "UPDATE vat_records SET progress = '已停止', updated_at = datetime('now') WHERE customer_id = ? AND progress != '归档完成'"
    ).run(id);
  }

  const row = db.prepare("SELECT * FROM vat_customers WHERE id = ?").get(id);
  return NextResponse.json(row);
}

// DELETE /api/vat/customers?id=xxx
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });

  const db = getDb();

  // 按从子到父的顺序清理，仅删未归档记录（归档记录保留用于历史查询）
  const nonArchivedIds = db.prepare(
    "SELECT id FROM vat_records WHERE customer_id = ? AND progress != '归档完成'"
  ).all(id) as { id: number }[];

  if (nonArchivedIds.length > 0) {
    const placeholders = nonArchivedIds.map(() => "?").join(",");
    const recordIds = nonArchivedIds.map(r => r.id);

    // 删除步骤级子表
    db.prepare(`DELETE FROM vat_step_notes WHERE record_id IN (${placeholders})`).run(...recordIds);
    db.prepare(`DELETE FROM vat_step_documents WHERE record_id IN (${placeholders})`).run(...recordIds);

    // 删除记录级子表
    db.prepare(`DELETE FROM vat_record_documents WHERE record_id IN (${placeholders})`).run(...recordIds);
    db.prepare(`DELETE FROM vat_record_finances WHERE record_id IN (${placeholders})`).run(...recordIds);
    db.prepare(`DELETE FROM vat_record_steps WHERE record_id IN (${placeholders})`).run(...recordIds);

    // 删除未归档的申报记录
    db.prepare(`DELETE FROM vat_records WHERE id IN (${placeholders})`).run(...recordIds);
  }

  // 删除对账记录
  db.prepare("DELETE FROM vat_reconciliation WHERE customer_id = ?").run(id);

  // 临时关闭外键约束，删除客户主记录；归档的历史记录保留（customer_id 悬空，可查）
  db.pragma("foreign_keys = OFF");
  db.prepare("DELETE FROM vat_customers WHERE id = ?").run(id);
  db.pragma("foreign_keys = ON");

  return NextResponse.json({ success: true });
}
