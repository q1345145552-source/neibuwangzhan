import { syncVatReconciliation } from "@/lib/vat-reconciliation";
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";

// GET /api/vat/records/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

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
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
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

  const changedFields: string[] = [];
  if (amount !== undefined) changedFields.push("金额");
  if (assignee !== undefined) changedFields.push("负责人");
  logOperation(auth.name, "修改VAT记录", "vat_record", String(id), `更新: ${changedFields.join("、")}`);

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

