import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
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
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { amount, assignee } = body;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (amount !== undefined) { updates.push("amount = ?"); values.push(Number(amount)); }
  if (assignee !== undefined) { updates.push("assignee = ?"); values.push(assignee); }

  if (updates.length === 0) return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });

  updates.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE vat_records SET ${updates.join(", ")} WHERE id = ?`).run(...values);

  const updated = db.prepare(`
    SELECT r.*, c.company_name, c.tax_id
    FROM vat_records r
    JOIN vat_customers c ON r.customer_id = c.id
    WHERE r.id = ?
  `).get(id);

  return NextResponse.json(updated);
}
