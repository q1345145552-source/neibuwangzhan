import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// POST /api/wht/records/batch
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json();
  const { action, ids } = body;
  if (!action || !ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }

  const db = getDb();

  if (action === "remind") {
    // Batch mark as reminded
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`UPDATE wht_records SET reminded = 1, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(...ids);
    return NextResponse.json({ success: true, action: "remind", count: ids.length });
  }

  if (action === "notice") {
    // Batch send confirmation notice (mark as reminded + add note)
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`UPDATE wht_records SET reminded = 1, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(...ids);

    // Add a note to each record
    for (const id of ids) {
      db.prepare(
        "UPDATE wht_records SET notes = COALESCE(notes,'') || ? || '\n' || '— ' || ? || ' ' || datetime('now') || '\n\n' WHERE id = ?"
      ).run("已发送确认通知", auth.name || "系统", id);
    }
    return NextResponse.json({ success: true, action: "notice", count: ids.length });
  }

  if (action === "pause") {
    // Batch pause customers — find customer_ids from records and pause them
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT DISTINCT customer_id FROM wht_records WHERE id IN (${placeholders})`
    ).all(...ids) as { customer_id: number }[];

    const customerIds = rows.map(r => r.customer_id);
    if (customerIds.length > 0) {
      const cPlaceholders = customerIds.map(() => "?").join(",");
      db.prepare(
        `UPDATE wht_customers SET status = '暂停', updated_at = datetime('now') WHERE id IN (${cPlaceholders})`
      ).run(...customerIds);
    }
    return NextResponse.json({ success: true, action: "pause", count: customerIds.length });
  }

  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
