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

  // Total enabled customers
  const totalEnabled = (db.prepare("SELECT COUNT(*) as c FROM vat_customers WHERE status = '启用'").get() as { c: number }).c;

  // Total records for this month
  const totalRecords = (db.prepare("SELECT COUNT(*) as c FROM vat_records WHERE year_month = ?").get(month) as { c: number }).c;

  // Records by progress
  const byProgress = (name: string) => {
    const r = db.prepare("SELECT COUNT(*) as c FROM vat_records WHERE year_month = ? AND progress = ?").get(month, name) as { c: number };
    return r.c;
  };

  // Count records that have at least step 1 completed (资料已交)
  const docsSubmitted = db.prepare(`
    SELECT COUNT(DISTINCT r.id) as c
    FROM vat_records r
    JOIN vat_record_steps s ON s.record_id = r.id AND s.step_order = 1
    WHERE r.year_month = ? AND s.status = '已完成'
  `).get(month) as { c: number };

  // Count records where steps 1-3 are done (已审核)
  const reviewed = db.prepare(`
    SELECT COUNT(DISTINCT r.id) as c
    FROM vat_records r
    WHERE r.year_month = ?
    AND (SELECT COUNT(*) FROM vat_record_steps WHERE record_id = r.id AND step_order <= 3 AND status = '已完成') = 3
  `).get(month) as { c: number };

  // Count records where e-Filing submitted (step 4 done)
  const filedSubmitted = db.prepare(`
    SELECT COUNT(DISTINCT r.id) as c
    FROM vat_records r
    JOIN vat_record_steps s ON s.record_id = r.id AND s.step_order = 4
    WHERE r.year_month = ? AND s.status = '已完成'
  `).get(month) as { c: number };

  // Archived = all steps done
  const archived = db.prepare(`
    SELECT COUNT(DISTINCT r.id) as c
    FROM vat_records r
    WHERE r.year_month = ? AND r.progress = '归档完成'
  `).get(month) as { c: number };

  return NextResponse.json({
    totalEnabled,
    totalRecords,
    docsSubmitted: docsSubmitted.c,
    reviewed: reviewed.c,
    filedSubmitted: filedSubmitted.c,
    archived: archived.c,
    month,
  });
}
