import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/logistics/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  const order = db.prepare("SELECT * FROM shipping_orders WHERE id = ?").get(id);
  if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 404 });

  const steps = db.prepare("SELECT * FROM shipping_steps WHERE order_id = ? ORDER BY step_order").all(id);

  const stepNotes: Record<number, any[]> = {};
  const allNotes = db.prepare(
    "SELECT * FROM shipping_step_notes WHERE order_id = ? ORDER BY created_at"
  ).all(id) as any[];
  for (const n of allNotes) {
    if (!stepNotes[n.step_id]) stepNotes[n.step_id] = [];
    stepNotes[n.step_id].push(n);
  }

  return NextResponse.json({ ...(order as object), steps, stepNotes });
}
