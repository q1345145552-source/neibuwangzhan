import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/vat/summary?year=2026
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const year = url.searchParams.get("year") || String(new Date().getFullYear());
  const db = getDb();

  // Get all enabled customers
  const customers = db.prepare("SELECT id, company_name, tax_id FROM vat_customers ORDER BY company_name").all() as { id: number; company_name: string; tax_id: string }[];

  const summary: {
    customerId: number; companyName: string; taxId: string;
    totalRecords: number; archivedRecords: number; overdueRecords: number;
    totalVat: number; totalPaid: number; totalUnpaid: number; totalFines: number;
  }[] = [];

  for (const cust of customers) {
    const records = db.prepare(`
      SELECT r.*,
        (SELECT s.payment_status FROM vat_record_steps s WHERE s.record_id = r.id AND s.step_order = 5) as step5_payment
      FROM vat_records r
      WHERE r.customer_id = ? AND r.year_month LIKE ?
      ORDER BY r.year_month
    `).all(cust.id, `${year}-%`) as any[];

    if (records.length === 0) continue;

    const archived = records.filter((r: any) => r.progress === "归档完成").length;
    const overdue = records.filter((r: any) => r.progress !== "归档完成").length;
    const totalVat = records.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);

    // Use default tax = 7% of declared amount as payable if no reconciliation data
    const taxPaid = records.filter((r: any) => r.step5_payment === "已付款").length * (totalVat > 0 ? totalVat / Math.max(records.length, 1) : 0);
    const taxUnpaid = records.filter((r: any) => r.step5_payment === "逾期未付").length * (totalVat > 0 ? totalVat / Math.max(records.length, 1) : 0);

    // Estimate fines: overdue records * 500 THB/day rough estimate
    let totalFines = 0;
    for (const r of records) {
      if (r.progress !== "归档完成") {
        const [ry, rm] = r.year_month.split("-").map(Number);
        const now = new Date();
        if (now.getFullYear() > ry || (now.getFullYear() === ry && now.getMonth() + 1 > rm)) {
          totalFines += 500; // minimum fine per overdue record
        }
      }
    }

    summary.push({
      customerId: cust.id, companyName: cust.company_name, taxId: cust.tax_id,
      totalRecords: records.length, archivedRecords: archived, overdueRecords: overdue,
      totalVat, totalPaid: Math.round(taxPaid), totalUnpaid: Math.round(taxUnpaid), totalFines,
    });
  }

  // Grand totals
  const grand = {
    totalRecords: summary.reduce((s, c) => s + c.totalRecords, 0),
    archivedRecords: summary.reduce((s, c) => s + c.archivedRecords, 0),
    overdueRecords: summary.reduce((s, c) => s + c.overdueRecords, 0),
    totalVat: summary.reduce((s, c) => s + c.totalVat, 0),
    totalPaid: summary.reduce((s, c) => s + c.totalPaid, 0),
    totalUnpaid: summary.reduce((s, c) => s + c.totalUnpaid, 0),
    totalFines: summary.reduce((s, c) => s + c.totalFines, 0),
  };

  return NextResponse.json({ year, customers: summary, grand });
}
