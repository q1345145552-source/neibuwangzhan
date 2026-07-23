import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  const record = db.prepare(`
    SELECT r.*, c.company_name, c.tax_id, c.contact
    FROM wht_records r
    JOIN wht_customers c ON r.customer_id = c.id
    WHERE r.id = ?
  `).get(id);

  if (!record) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  const steps = db.prepare("SELECT * FROM wht_record_steps WHERE record_id = ? ORDER BY step_order").all(id);

  return NextResponse.json({ ...(record as object), steps });
}
