import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb } from "@/lib/db";

const VALID_STATUSES = ["待处理", "进行中", "已完成", "阻塞"] as const;

// PATCH /api/logistics/[id]/steps
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const body = await readJson(req);
  const { step_id, status, assignee } = body;

  if (step_id === undefined || !status) {
    return NextResponse.json({ error: "缺少 step_id 或 status" }, { status: 400 });
  }

  const safeStatus = VALID_STATUSES.includes(status) ? status : "待处理";

  const step = db.prepare("SELECT * FROM shipping_steps WHERE id = ? AND order_id = ?").get(step_id, id) as any;
  if (!step) return NextResponse.json({ error: "步骤不存在" }, { status: 404 });

  const now = "datetime('now')";

  if (safeStatus === "进行中" && step.status !== "进行中") {
    db.prepare("UPDATE shipping_steps SET status = ?, started_at = " + now + " WHERE id = ?").run(safeStatus, step_id);
  } else if (safeStatus === "已完成") {
    db.prepare("UPDATE shipping_steps SET status = ?, completed_at = " + now + " WHERE id = ?").run(safeStatus, step_id);
  } else if (safeStatus === "阻塞") {
    db.prepare("UPDATE shipping_steps SET status = ? WHERE id = ?").run(safeStatus, step_id);
  } else if (safeStatus === "待处理") {
    db.prepare("UPDATE shipping_steps SET status = ?, started_at = NULL, completed_at = NULL WHERE id = ?").run(safeStatus, step_id);
  } else if (assignee !== undefined) {
    db.prepare("UPDATE shipping_steps SET assignee = ? WHERE id = ?").run(assignee, step_id);
  } else {
    // already in same status, just update assignee if provided
    if (assignee !== undefined) {
      db.prepare("UPDATE shipping_steps SET assignee = ? WHERE id = ?").run(assignee, step_id);
    }
  }

  // Update order progress
  const allSteps = db.prepare("SELECT status FROM shipping_steps WHERE order_id = ?").all(id) as { status: string }[];
  const done = allSteps.filter(s => s.status === "已完成").length;
  const progress = done === allSteps.length ? "已完成" : done > 0 ? "进行中" : "待处理";
  db.prepare("UPDATE shipping_orders SET progress = ?, updated_at = " + now + " WHERE id = ?").run(progress, id);

  const updated = db.prepare("SELECT * FROM shipping_steps WHERE id = ?").get(step_id);
  return NextResponse.json(updated);
}
