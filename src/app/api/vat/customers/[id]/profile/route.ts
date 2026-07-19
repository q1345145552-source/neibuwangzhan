import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/vat/customers/:id/profile
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  // Customer info
  const customer = db.prepare("SELECT * FROM vat_customers WHERE id = ?").get(id);
  if (!customer) return NextResponse.json({ error: "客户不存在" }, { status: 404 });

  // Current month record with all steps
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  
  const currentRecord = db.prepare(`
    SELECT * FROM vat_records WHERE customer_id = ? AND year_month = ?
  `).get(id, thisMonth) as any;

  let currentSteps: any[] = [];
  if (currentRecord) {
    currentSteps = db.prepare("SELECT * FROM vat_record_steps WHERE record_id = ? ORDER BY step_order").all(currentRecord.id) as any[];
  }

  // Last 12 months records
  const records = db.prepare(`
    SELECT year_month, progress, amount
    FROM vat_records WHERE customer_id = ?
    ORDER BY year_month DESC LIMIT 12
  `).all(id) as any[];

  // Last 3 months amounts for trend
  const last3Amounts = records
    .slice(0, 3)
    .map(r => ({ month: r.year_month, amount: r.amount || 0 }));

  // Check consecutive non-compliance (逾期 for 3+ months)
  const overdueCount = db.prepare(`
    SELECT year_month, progress FROM vat_records
    WHERE customer_id = ? AND progress != '归档完成'
    ORDER BY year_month DESC
  `).all(id) as any[];

  // Count consecutive overdue months (backward from current month)
  let consecutiveOverdue = 0;
  const sortedOverdue = [...overdueCount].sort((a, b) => b.year_month.localeCompare(a.year_month));
  let expectedMonth = thisMonth;
  for (const r of sortedOverdue) {
    if (r.year_month === expectedMonth) {
      consecutiveOverdue++;
      // Move to previous month
      const [y, m] = expectedMonth.split("-").map(Number);
      expectedMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
    } else {
      break;
    }
  }

  // Filter out records where this month isn't due yet
  const actualOverdue = overdueCount.filter(r => r.year_month < thisMonth).length;

  // Average completion time (steps 1→6 for archived records)
  const completedRecords = db.prepare(`
    SELECT r.year_month, s1.created_at as started, s6.completed_at as finished
    FROM vat_records r
    JOIN vat_record_steps s1 ON s1.record_id = r.id AND s1.step_order = 1
    JOIN vat_record_steps s6 ON s6.record_id = r.id AND s6.step_order = 6
    WHERE r.customer_id = ? AND r.progress = '归档完成'
    ORDER BY r.year_month DESC LIMIT 6
  `).all(id) as any[];

  return NextResponse.json({
    customer,
    currentRecord: currentRecord ? { ...currentRecord, steps: currentSteps } : null,
    history: records,
    last3Amounts,
    consecutiveOverdue,
    overdueCount: actualOverdue,
    isRedFlagged: consecutiveOverdue >= 3,
    avgCompletionDays: completedRecords.length,
    completedHistory: completedRecords,
  });
}
