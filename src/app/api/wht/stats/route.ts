import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const db = getDb();

  const subtypes = ["ภ.ง.ด.1", "ภ.ง.ด.53"];
  const stats: Record<string, { totalCustomers: number; completedSteps: number; archived: number; totalSteps: number }> = {};

  for (const subtype of subtypes) {
    // Count records for this month/subtype from enabled customers
    const customersRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM wht_records r
      JOIN wht_customers c ON r.customer_id = c.id
      WHERE c.status = '启用' AND r.year_month = ? AND r.subtype = ?
    `).get(month, subtype) as { cnt: number };

    // Count completed steps
    const stepsRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM wht_record_steps s
      JOIN wht_records r ON s.record_id = r.id
      JOIN wht_customers c ON r.customer_id = c.id
      WHERE c.status = '启用' AND r.year_month = ? AND r.subtype = ?
      AND s.status IN ('已完成', '已跳过')
    `).get(month, subtype) as { cnt: number };

    // Count total steps (for denominator)
    const totalStepsRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM wht_record_steps s
      JOIN wht_records r ON s.record_id = r.id
      JOIN wht_customers c ON r.customer_id = c.id
      WHERE c.status = '启用' AND r.year_month = ? AND r.subtype = ?
    `).get(month, subtype) as { cnt: number };

    // Count archived
    const archivedRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM wht_records r
      JOIN wht_customers c ON r.customer_id = c.id
      WHERE c.status = '启用' AND r.year_month = ? AND r.subtype = ? AND r.progress = '归档'
    `).get(month, subtype) as { cnt: number };

    stats[subtype] = {
      totalCustomers: customersRow.cnt,
      completedSteps: stepsRow.cnt,
      archived: archivedRow.cnt,
      totalSteps: totalStepsRow.cnt,
    };
  }

  return NextResponse.json({ month, stats });
}
