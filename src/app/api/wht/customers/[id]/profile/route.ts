import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/wht/customers/:id/profile
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  const customer = db.prepare("SELECT * FROM wht_customers WHERE id = ?").get(id);
  if (!customer) return NextResponse.json({ error: "客户不存在" }, { status: 404 });

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Current month records (both subtypes)
  const currentRecords = db.prepare(`
    SELECT r.*, 
      (SELECT COUNT(*) FROM wht_record_steps WHERE record_id = r.id AND status IN ('已完成','已跳过')) as completed_steps,
      (SELECT COUNT(*) FROM wht_record_steps WHERE record_id = r.id) as total_steps
    FROM wht_records r
    WHERE r.customer_id = ? AND r.year_month = ?
    ORDER BY r.subtype
  `).all(id, thisMonth) as any[];

  // Get current steps for first record if exists
  let currentSteps: any[] = [];
  if (currentRecords.length > 0) {
    currentSteps = db.prepare(
      "SELECT * FROM wht_record_steps WHERE record_id = ? ORDER BY step_order"
    ).all(currentRecords[0].id) as any[];
  }

  // Get all records for this customer (all subtypes), last 24 months
  const allRecords = db.prepare(`
    SELECT year_month, subtype, progress, amount
    FROM wht_records
    WHERE customer_id = ?
    ORDER BY year_month DESC, subtype
    LIMIT 24
  `).all(id) as any[];

  // History by month (aggregated, both subtypes)
  const history = db.prepare(`
    SELECT year_month,
      SUM(CASE WHEN progress = '归档' THEN 1 ELSE 0 END) as archived,
      COUNT(*) as total,
      SUM(amount) as total_amount
    FROM wht_records
    WHERE customer_id = ?
    GROUP BY year_month
    ORDER BY year_month DESC
    LIMIT 12
  `).all(id) as any[];

  // Last 3 months amount trend
  const last3Amounts = db.prepare(`
    SELECT year_month, SUM(amount) as amount
    FROM wht_records
    WHERE customer_id = ?
    GROUP BY year_month
    ORDER BY year_month DESC
    LIMIT 3
  `).all(id) as any[];

  // Overdue check — not archived and past deadline month
  const overdueCount = (db.prepare(`
    SELECT COUNT(*) as cnt FROM wht_records
    WHERE customer_id = ? AND progress != '归档'
  `).get(id) as any).cnt || 0;

  const archivedCount = (db.prepare(`
    SELECT COUNT(*) as cnt FROM wht_records
    WHERE customer_id = ? AND progress = '归档'
  `).get(id) as any).cnt || 0;

  return NextResponse.json({
    customer,
    currentMonth: thisMonth,
    currentRecords,
    currentSteps: currentRecords.length > 0 ? currentSteps : [],
    history,
    allRecords,
    last3Amounts: last3Amounts.map(r => ({ month: r.year_month, amount: r.amount || 0 })),
    overdueCount,
    archivedCount,
    totalRecords: allRecords.length,
  });
}
