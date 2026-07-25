import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb } from "@/lib/db";

// GET /api/vat/records/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  const record = db.prepare(`
    SELECT r.*, c.company_name, c.tax_id
    FROM vat_records r
    JOIN vat_customers c ON r.customer_id = c.id
    WHERE r.id = ?
  `).get(id);

  if (!record) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  const steps = db.prepare("SELECT * FROM vat_record_steps WHERE record_id = ? ORDER BY step_order").all(id);

  return NextResponse.json({ ...(record as object), steps });
}

// PATCH /api/vat/records/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });
  const { id } = await params;
  const db = getDb();
  const body = await readJson(req);
  const { amount, assignee } = body;

  const existing = db.prepare("SELECT customer_id, year_month FROM vat_records WHERE id = ?").get(id) as
    { customer_id: number; year_month: string } | undefined;
  if (!existing) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  const updates: string[] = [];
  const values: unknown[] = [];

  if (amount !== undefined) {
    if (isNaN(Number(amount)) || Number(amount) < 0) {
      return NextResponse.json({ error: "金额必须是非负数字" }, { status: 400 });
    }
    updates.push("amount = ?"); values.push(Number(amount));
  }
  if (assignee !== undefined) { updates.push("assignee = ?"); values.push(assignee); }

  if (updates.length === 0) return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });

  updates.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE vat_records SET ${updates.join(", ")} WHERE id = ?`).run(...values);

  // 金额改了要同步对账表。之前只在「步骤2 标记完成」那一刻同步一次，
  // 完成之后再改金额，对账表会一直停留在旧值，报表和申报记录对不上。
  if (amount !== undefined) {
    syncVatReconciliation(db, existing.customer_id, existing.year_month);
  }

  const updated = db.prepare(`
    SELECT r.*, c.company_name, c.tax_id
    FROM vat_records r
    JOIN vat_customers c ON r.customer_id = c.id
    WHERE r.id = ?
  `).get(id);

  return NextResponse.json(updated);
}

/**
 * 按该客户该月所有申报记录的税额合计，重算对账表的应付/未付。
 * 已付金额（tax_paid）保持不变，只重算应付和差额。
 */
export function syncVatReconciliation(db: ReturnType<typeof getDb>, customerId: number, yearMonth: string) {
  const total = (db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as t FROM vat_records WHERE customer_id = ? AND year_month = ?"
  ).get(customerId, yearMonth) as { t: number }).t;

  const exists = db.prepare(
    "SELECT id FROM vat_reconciliation WHERE customer_id = ? AND year_month = ?"
  ).get(customerId, yearMonth);

  if (!exists) {
    db.prepare(
      "INSERT INTO vat_reconciliation (customer_id, year_month, tax_payable, tax_paid, tax_unpaid) VALUES (?, ?, ?, 0, ?)"
    ).run(customerId, yearMonth, total, total);
  } else {
    db.prepare(`
      UPDATE vat_reconciliation
      SET tax_payable = ?, tax_unpaid = MAX(0, ? - COALESCE(tax_paid, 0)), updated_at = datetime('now')
      WHERE customer_id = ? AND year_month = ?
    `).run(total, total, customerId, yearMonth);
  }
}
