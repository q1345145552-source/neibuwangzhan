import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/vat/dashboard?month=YYYY-MM
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const db = getDb();

  // 本月应申报 = 当月有申报记录的启用客户数量
  const totalEnabled = (db.prepare(
    "SELECT COUNT(DISTINCT r.id) as c FROM vat_records r JOIN vat_customers c ON r.customer_id = c.id WHERE r.year_month = ? AND c.status = '启用'"
  ).get(month) as { c: number }).c;

  // 本月申报记录总数（仅启用客户）
  const totalRecords = (db.prepare(
    "SELECT COUNT(r.id) as c FROM vat_records r JOIN vat_customers c ON r.customer_id = c.id WHERE r.year_month = ? AND c.status = '启用'"
  ).get(month) as { c: number }).c;

  // 已交资料 = 第一步完成后
  const docsSubmitted = (db.prepare(`
    SELECT COUNT(DISTINCT r.id) as c
    FROM vat_records r
    JOIN vat_customers cust ON r.customer_id = cust.id AND cust.status = '启用'
    JOIN vat_record_steps s ON s.record_id = r.id AND s.step_order = 1
    WHERE r.year_month = ? AND s.status = '已完成'
  `).get(month) as { c: number }).c;

  // 审核完毕 = 步骤 1-3 全部完成
  const reviewed = (db.prepare(`
    SELECT COUNT(DISTINCT r.id) as c
    FROM vat_records r
    JOIN vat_customers cust ON r.customer_id = cust.id AND cust.status = '启用'
    WHERE r.year_month = ?
    AND (SELECT COUNT(*) FROM vat_record_steps WHERE record_id = r.id AND step_order <= 3 AND status = '已完成') = 3
  `).get(month) as { c: number }).c;

  // 已提交申报 = 第四步完成
  const filedSubmitted = (db.prepare(`
    SELECT COUNT(DISTINCT r.id) as c
    FROM vat_records r
    JOIN vat_customers cust ON r.customer_id = cust.id AND cust.status = '启用'
    JOIN vat_record_steps s ON s.record_id = r.id AND s.step_order = 4
    WHERE r.year_month = ? AND s.status = '已完成'
  `).get(month) as { c: number }).c;

  // 已归档 = 全部步骤完成
  const archived = (db.prepare(`
    SELECT COUNT(DISTINCT r.id) as c
    FROM vat_records r
    JOIN vat_customers cust ON r.customer_id = cust.id AND cust.status = '启用'
    WHERE r.year_month = ? AND r.progress = '归档完成'
  `).get(month) as { c: number }).c;

  return NextResponse.json({
    totalEnabled,
    totalRecords,
    docsSubmitted,
    reviewed,
    filedSubmitted,
    archived,
    month,
  });
}
