import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  const record = db.prepare(`
    SELECT r.*, c.company_name, c.tax_id, c.contact
    FROM wht_records r
    JOIN wht_customers c ON r.customer_id = c.id
    WHERE r.id = ?
  `).get(id);

  if (!record) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  const steps = db.prepare("SELECT * FROM wht_record_steps WHERE record_id = ? ORDER BY step_order").all(id);

  return NextResponse.json({ ...(record as object), steps });
}

// PATCH /api/wht/records/[id] — 更新金额/税率/负责人
// amount = 应扣税额；income_amount = 收入额（开 50ทวิ 用）；tax_rate = 税率百分比
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

  const existing = db.prepare("SELECT id FROM wht_records WHERE id = ?").get(id);
  if (!existing) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.amount !== undefined) {
    if (isNaN(Number(body.amount)) || Number(body.amount) < 0) {
      return NextResponse.json({ error: "税额必须是非负数字" }, { status: 400 });
    }
    updates.push("amount = ?"); values.push(Number(body.amount));
  }
  if (body.income_amount !== undefined) {
    if (isNaN(Number(body.income_amount)) || Number(body.income_amount) < 0) {
      return NextResponse.json({ error: "收入额必须是非负数字" }, { status: 400 });
    }
    updates.push("income_amount = ?"); values.push(Number(body.income_amount));
  }
  if (body.tax_rate !== undefined) {
    const r = Number(body.tax_rate);
    if (isNaN(r) || r < 0 || r > 100) {
      return NextResponse.json({ error: "税率应在 0–100 之间" }, { status: 400 });
    }
    updates.push("tax_rate = ?"); values.push(r);
  }
  if (body.assignee !== undefined) { updates.push("assignee = ?"); values.push(body.assignee); }

  if (updates.length === 0) return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });

  updates.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE wht_records SET ${updates.join(", ")} WHERE id = ?`).run(...values);

  // 金额变了要同步对账表，否则报表和申报记录对不上
  if (body.amount !== undefined) {
    const rec = db.prepare("SELECT customer_id, year_month, amount FROM wht_records WHERE id = ?").get(id) as
      { customer_id: number; year_month: string; amount: number };
    syncWhtReconciliation(db, rec.customer_id, rec.year_month);
  }

  const updated = db.prepare(`
    SELECT r.*, c.company_name, c.tax_id FROM wht_records r
    JOIN wht_customers c ON r.customer_id = c.id WHERE r.id = ?
  `).get(id);
  return NextResponse.json(updated);
}

/** 按该客户该月所有申报记录的税额合计，重算对账表的应付/未付 */
function syncWhtReconciliation(db: ReturnType<typeof getDb>, customerId: number, yearMonth: string) {
  const total = (db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as t FROM wht_records WHERE customer_id = ? AND year_month = ?"
  ).get(customerId, yearMonth) as { t: number }).t;

  const exists = db.prepare(
    "SELECT tax_paid FROM wht_reconciliation WHERE customer_id = ? AND year_month = ?"
  ).get(customerId, yearMonth) as { tax_paid: number } | undefined;

  if (!exists) {
    db.prepare(
      "INSERT INTO wht_reconciliation (customer_id, year_month, tax_payable, tax_paid, tax_unpaid) VALUES (?, ?, ?, 0, ?)"
    ).run(customerId, yearMonth, total, total);
  } else {
    db.prepare(`
      UPDATE wht_reconciliation
      SET tax_payable = ?, tax_unpaid = MAX(0, ? - COALESCE(tax_paid, 0)), updated_at = datetime('now')
      WHERE customer_id = ? AND year_month = ?
    `).run(total, total, customerId, yearMonth);
  }
}
