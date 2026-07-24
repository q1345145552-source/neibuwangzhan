import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/wht/summary?year=2026
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const year = url.searchParams.get("year") || String(new Date().getFullYear());
  const db = getDb();

  const customers = db.prepare(
    "SELECT id, company_name, tax_id FROM wht_customers WHERE status = '启用' ORDER BY company_name"
  ).all() as { id: number; company_name: string; tax_id: string }[];

  const summary: {
    customerId: number; companyName: string; taxId: string;
    totalRecords: number; archivedRecords: number; overdueRecords: number;
    totalAmount: number; totalPaid: number; totalUnpaid: number;
    wht1Count: number; wht53Count: number;
  }[] = [];

  for (const cust of customers) {
    // All records for this customer in the given year
    const records = db.prepare(
      "SELECT id, year_month, progress, subtype FROM wht_records WHERE customer_id = ? AND year_month LIKE ? ORDER BY year_month"
    ).all(cust.id, `${year}-%`) as { id: number; year_month: string; progress: string; subtype: string }[];

    if (records.length === 0) continue;

    const totalRecords = records.length;
    const archivedRecords = records.filter(r => r.progress === "归档").length;
    const overdueRecords = records.filter(r => r.progress !== "归档").length;
    const wht1Count = records.filter(r => r.subtype === "ภ.ง.ด.1").length;
    const wht53Count = records.filter(r => r.subtype === "ภ.ง.ด.53").length;

    const reconRows = db.prepare(
      "SELECT tax_payable, tax_paid, tax_unpaid FROM wht_reconciliation WHERE customer_id = ? AND year_month LIKE ?"
    ).all(cust.id, `${year}-%`) as { tax_payable: number; tax_paid: number; tax_unpaid: number }[];

    const totalAmount = reconRows.reduce((s, r) => s + (r.tax_payable || 0), 0);
    const totalPaid = reconRows.reduce((s, r) => s + (r.tax_paid || 0), 0);
    const totalUnpaid = reconRows.reduce((s, r) => s + (r.tax_unpaid || 0), 0);

    summary.push({
      customerId: cust.id, companyName: cust.company_name, taxId: cust.tax_id,
      totalRecords, archivedRecords, overdueRecords,
      totalAmount, totalPaid, totalUnpaid,
      wht1Count, wht53Count,
    });
  }

  const grand = {
    totalRecords: summary.reduce((s, c) => s + c.totalRecords, 0),
    archivedRecords: summary.reduce((s, c) => s + c.archivedRecords, 0),
    overdueRecords: summary.reduce((s, c) => s + c.overdueRecords, 0),
    totalAmount: summary.reduce((s, c) => s + c.totalAmount, 0),
    totalPaid: summary.reduce((s, c) => s + c.totalPaid, 0),
    totalUnpaid: summary.reduce((s, c) => s + c.totalUnpaid, 0),
  };

  return NextResponse.json({ year, customers: summary, grand });
}
