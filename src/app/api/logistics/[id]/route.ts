import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb, logOperation } from "@/lib/db";

// GET /api/logistics/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

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
    // step_id=0 是旧的订单级文件备注，已迁移到 shipping_order_files，这里跳过（备注仍保留，但不再作为文件读取）
    if (n.step_id === 0) continue;
    if (!stepNotes[n.step_id]) stepNotes[n.step_id] = [];
    stepNotes[n.step_id].push(n);
  }

  // 订单级文件直接从独立文件表查
  const orderFiles = db.prepare(
    "SELECT id, name, url, uploaded_by as created_by, created_at FROM shipping_order_files WHERE order_id = ? ORDER BY created_at"
  ).all(id) as { id: number; name: string; url: string; created_by: string; created_at: string }[];

  return NextResponse.json({ ...(order as object), steps, stepNotes, orderFiles });
}


// DELETE /api/logistics/[id] — 删除整个柜号订单（含步骤、备注、文件）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  const db = getDb();

  const order = db.prepare("SELECT * FROM shipping_orders WHERE id = ?").get(id) as any;
  if (!order) return NextResponse.json({ error: "柜号订单不存在" }, { status: 404 });

  // 权限：管理员可删所有人，员工只能删自己创建的
  if (auth.role !== "admin" && order.creator !== auth.name) {
    return NextResponse.json({ error: "没有权限删除别人的柜号订单" }, { status: 403 });
  }

  // Only remove database references; shared physical files await verified garbage collection.
  // 事务删除：文件表 → 备注 → 步骤 → 订单
  db.transaction(() => {
    db.prepare("DELETE FROM shipping_order_files WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM shipping_step_notes WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM shipping_steps WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM shipping_orders WHERE id = ?").run(id);
  })();

  logOperation(auth.name, "删除柜号", "logistics", String(id), (order as { cabinet_number?: string }).cabinet_number || "");
  return NextResponse.json({ success: true, deletedFiles: 0, filesRetained: true });
}
