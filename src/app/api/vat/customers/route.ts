import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";

// GET /api/vat/customers
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  // deleted = 1 为软删除（见 DELETE），列表里不展示，但历史归档记录仍能 JOIN 出公司名
  const rows = db.prepare("SELECT * FROM vat_customers WHERE deleted = 0 ORDER BY status, company_name").all();
  return NextResponse.json(rows);
}

// POST /api/vat/customers
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const body = await readJson(req);
  const { company_name, tax_id, contact, status } = body;
  const _e = validateEnums({ "vat_customers.status": status });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });
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
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const body = await readJson(req);
  const { id, company_name, tax_id, contact, status } = body;
  const _ep = validateEnums({ "vat_customers.status": status });
  if (_ep) return NextResponse.json({ error: _ep }, { status: 400 });
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
// 软删除：清掉未归档的申报记录，客户主记录保留并标记 deleted=1。
// 之前是物理删除 + 全局 `pragma foreign_keys = OFF`，有两个问题：
//   1. pragma 是连接级的，而 db 是全局单例，关闭期间所有并发请求都失去外键保护；
//      DELETE 一旦抛异常，外键会一直关着直到进程重启。
//   2. 归档记录的 customer_id 会悬空，而列表用 INNER JOIN vat_customers，
//      号称"保留历史"实际上再也查不出来。
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可删除客户" }, { status: 403 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });

  const db = getDb();
  const customer = db.prepare("SELECT id FROM vat_customers WHERE id = ?").get(id);
  if (!customer) return NextResponse.json({ error: "客户不存在" }, { status: 404 });

  let archivedKept = 0;
  db.transaction(() => {
    // 按从子到父的顺序清理，仅删未归档记录（归档记录保留用于历史查询）
    const nonArchivedIds = db.prepare(
      "SELECT id FROM vat_records WHERE customer_id = ? AND progress != '归档完成'"
    ).all(id) as { id: number }[];

    if (nonArchivedIds.length > 0) {
      const placeholders = nonArchivedIds.map(() => "?").join(",");
      const recordIds = nonArchivedIds.map(r => r.id);

      // 步骤级子表
      db.prepare(`DELETE FROM vat_step_notes WHERE record_id IN (${placeholders})`).run(...recordIds);
      db.prepare(`DELETE FROM vat_step_documents WHERE record_id IN (${placeholders})`).run(...recordIds);
      // 记录级子表
      db.prepare(`DELETE FROM vat_record_documents WHERE record_id IN (${placeholders})`).run(...recordIds);
      db.prepare(`DELETE FROM vat_record_finances WHERE record_id IN (${placeholders})`).run(...recordIds);
      db.prepare(`DELETE FROM vat_record_steps WHERE record_id IN (${placeholders})`).run(...recordIds);
      db.prepare(`DELETE FROM vat_records WHERE id IN (${placeholders})`).run(...recordIds);
    }

    db.prepare("DELETE FROM vat_reconciliation WHERE customer_id = ?").run(id);

    archivedKept = (db.prepare(
      "SELECT COUNT(*) as c FROM vat_records WHERE customer_id = ?"
    ).get(id) as { c: number }).c;

    // 软删除客户：状态一并置为已终止，这样按 status='启用' 过滤的生成/通知逻辑自动跳过
    db.prepare(
      "UPDATE vat_customers SET deleted = 1, status = '已终止', updated_at = datetime('now') WHERE id = ?"
    ).run(id);
  })();

  logOperation(auth.name, "删除VAT客户", "vat_customer", String(id), `保留归档记录 ${archivedKept} 条`);
  return NextResponse.json({ success: true, archived_kept: archivedKept });
}
