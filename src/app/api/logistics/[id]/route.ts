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
  const orderFiles: { id: number; name: string; url: string; created_by: string; created_at: string }[] = [];
  const allNotes = db.prepare(
    "SELECT * FROM shipping_step_notes WHERE order_id = ? ORDER BY created_at"
  ).all(id) as any[];
  for (const n of allNotes) {
    if (n.step_id === 0) {
      // 格式: [文件] filename | url
      const m = (n.content as string).match(/^\[文件\]\s*(.+?)\s*\|\s*(.+)$/);
      if (m) {
        orderFiles.push({ id: n.id, name: m[1].trim(), url: m[2].trim(), created_by: n.created_by, created_at: n.created_at });
      }
    } else {
      if (!stepNotes[n.step_id]) stepNotes[n.step_id] = [];
      stepNotes[n.step_id].push(n);
    }
  }

  return NextResponse.json({ ...(order as object), steps, stepNotes, orderFiles });
}
