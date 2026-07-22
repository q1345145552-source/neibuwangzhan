import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/vat/records?month=YYYY-MM&month_from=YYYY-MM&month_to=YYYY-MM&search=xxx&status=进行中|已完成&page=1&limit=20
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const month = url.searchParams.get("month") || "";
  const monthFrom = url.searchParams.get("month_from") || "";
  const monthTo = url.searchParams.get("month_to") || "";
  const search = url.searchParams.get("search") || "";
  const status = url.searchParams.get("status") || ""; // "进行中" | "已归档"
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));

  const db = getDb();

  let where: string[] = [];
  let params: unknown[] = [];

  if (month) {
    where.push("r.year_month = ?");
    params.push(month);
  } else {
    if (monthFrom) { where.push("r.year_month >= ?"); params.push(monthFrom); }
    if (monthTo) { where.push("r.year_month <= ?"); params.push(monthTo); }
  }

  if (search) {
    where.push("c.company_name LIKE ?");
    params.push(`%${search}%`);
  }

  if (status === "已归档") {
    where.push("r.progress = '归档完成'");
  } else if (status === "进行中") {
    where.push("r.progress != '归档完成'");
    where.push("r.progress != '已停止'");
  }

  const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

  // Count
  const countRow = db.prepare(`
    SELECT COUNT(*) as c
    FROM vat_records r
    JOIN vat_customers c ON r.customer_id = c.id
    ${whereClause}
  `).get(...params) as { c: number };
  const total = countRow.c;

  // Rows
  const offset = (page - 1) * limit;
  const rows = db.prepare(`
    SELECT r.*, c.company_name, c.tax_id
    FROM vat_records r
    JOIN vat_customers c ON r.customer_id = c.id
    ${whereClause}
    ORDER BY r.year_month DESC, c.company_name
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return NextResponse.json({
    records: rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}
