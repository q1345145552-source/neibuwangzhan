import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/vat/records?month=YYYY-MM
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const month = url.searchParams.get("month") || "";
  const db = getDb();

  let rows;
  if (month) {
    rows = db.prepare(`
      SELECT r.*, c.company_name, c.tax_id
      FROM vat_records r
      JOIN vat_customers c ON r.customer_id = c.id
      WHERE r.year_month = ?
      ORDER BY c.company_name
    `).all(month);
  } else {
    rows = db.prepare(`
      SELECT r.*, c.company_name, c.tax_id
      FROM vat_records r
      JOIN vat_customers c ON r.customer_id = c.id
      ORDER BY r.year_month DESC, c.company_name
    `).all();
  }
  return NextResponse.json(rows);
}
