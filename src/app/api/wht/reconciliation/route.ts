import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/wht/reconciliation?month=YYYY-MM
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const month = url.searchParams.get("month") || "";
  const db = getDb();

  let rows;
  if (month) {
    rows = db.prepare(`
      SELECT r.*, c.company_name
      FROM wht_reconciliation r
      JOIN wht_customers c ON r.customer_id = c.id
      WHERE r.year_month = ?
      ORDER BY c.company_name
    `).all(month);
  } else {
    rows = db.prepare(`
      SELECT r.*, c.company_name
      FROM wht_reconciliation r
      JOIN wht_customers c ON r.customer_id = c.id
      ORDER BY r.year_month DESC, c.company_name
    `).all();
  }
  return NextResponse.json(rows);
}

// PATCH /api/wht/reconciliation — update amounts
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json();
  const { id, tax_payable, tax_paid, tax_unpaid, notes } = body;
  if (!id) return NextResponse.json({ error: "缺少对账 ID" }, { status: 400 });

  const db = getDb();
  const updates: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (tax_payable !== undefined) { updates.push("tax_payable = ?"); values.push(tax_payable); }
  if (tax_paid !== undefined) { updates.push("tax_paid = ?"); values.push(tax_paid); }
  if (tax_unpaid !== undefined) { updates.push("tax_unpaid = ?"); values.push(tax_unpaid); }
  if (notes !== undefined) { updates.push("notes = ?"); values.push(notes); }

  values.push(id);
  db.prepare(`UPDATE wht_reconciliation SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  const row = db.prepare("SELECT * FROM wht_reconciliation WHERE id = ?").get(id);
  return NextResponse.json(row);
}

// POST /api/vat/reconciliation — migrate: create reconciliation records for existing records
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const db = getDb();

  const missing = db.prepare(`
    SELECT r.customer_id, r.year_month, r.amount
    FROM wht_records r
    WHERE NOT EXISTS (
      SELECT 1 FROM wht_reconciliation rc
      WHERE rc.customer_id = r.customer_id AND rc.year_month = r.year_month
    )
  `).all() as { customer_id: number; year_month: string; amount: number }[];

  if (missing.length === 0) {
    return NextResponse.json({ created: 0, message: "所有记录已有对账数据" });
  }

  const txn = db.transaction(() => {
    for (const m of missing) {
      db.prepare(
        "INSERT INTO wht_reconciliation (customer_id, year_month, tax_payable, tax_paid, tax_unpaid) VALUES (?, ?, ?, 0, ?)"
      ).run(m.customer_id, m.year_month, m.amount || 0, m.amount || 0);
    }
  });
  txn();

  return NextResponse.json({ created: missing.length, message: `已为 ${missing.length} 条记录补建对账数据` });
}
