import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// 泰国 VAT 逾期罚款：申报逾期 7 天以上罚款 ฿1,000，之后每天加 ฿200，上限 ฿41,000
function calcLateFine(deadline: Date, taxAmount: number): number {
  const now = new Date();
  if (now <= deadline) return 0;
  const daysLate = Math.floor((now.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLate <= 7) return 200; // initial penalty
  let fine = 1000 + (daysLate - 7) * 200;
  return Math.min(fine, 41000);
}

// GET /api/vat/summary?year=2026
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const year = url.searchParams.get("year") || String(new Date().getFullYear());
  const db = getDb();

  // 只统计启用客户
  const customers = db.prepare(
    "SELECT id, company_name, tax_id FROM vat_customers WHERE status = '启用' ORDER BY company_name"
  ).all() as { id: number; company_name: string; tax_id: string }[];

  const summary: {
    customerId: number; companyName: string; taxId: string;
    totalRecords: number; archivedRecords: number; overdueRecords: number;
    totalVat: number; totalPaid: number; totalUnpaid: number; totalFines: number;
  }[] = [];

  for (const cust of customers) {
    // 该客户全年申报记录
    const records = db.prepare(
      "SELECT id, year_month, progress FROM vat_records WHERE customer_id = ? AND year_month LIKE ? ORDER BY year_month"
    ).all(cust.id, `${year}-%`) as { id: number; year_month: string; progress: string }[];

    if (records.length === 0) continue;

    const totalRecords = records.length;
    const archivedRecords = records.filter(r => r.progress === "归档完成").length;
    const overdueRecords = records.filter(r => r.progress !== "归档完成").length;

    // 从对账表取真实税金数据
    const reconRows = db.prepare(
      "SELECT tax_payable, tax_paid, tax_unpaid FROM vat_reconciliation WHERE customer_id = ? AND year_month LIKE ?"
    ).all(cust.id, `${year}-%`) as { tax_payable: number; tax_paid: number; tax_unpaid: number }[];

    const totalVat = reconRows.reduce((s, r) => s + (r.tax_payable || 0), 0);
    const totalPaid = reconRows.reduce((s, r) => s + (r.tax_paid || 0), 0);
    const totalUnpaid = reconRows.reduce((s, r) => s + (r.tax_unpaid || 0), 0);

    // 罚款：未完成的记录，按月计算逾期天数
    let totalFines = 0;
    for (const r of records) {
      if (r.progress === "归档完成") continue;
      const [ry, rm] = r.year_month.split("-").map(Number);
      // 当月申报截止日为次月 15 日
      const deadline = new Date(ry, rm, 15);
      // 该月的应付税金
      const recon = db.prepare(
        "SELECT tax_payable FROM vat_reconciliation WHERE customer_id = ? AND year_month = ?"
      ).get(cust.id, r.year_month) as { tax_payable: number } | undefined;
      const payable = recon?.tax_payable || 0;
      totalFines += calcLateFine(deadline, payable);
    }

    summary.push({
      customerId: cust.id, companyName: cust.company_name, taxId: cust.tax_id,
      totalRecords, archivedRecords, overdueRecords,
      totalVat, totalPaid, totalUnpaid, totalFines,
    });
  }

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
