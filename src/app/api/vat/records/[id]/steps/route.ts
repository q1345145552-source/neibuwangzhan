import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// PATCH /api/vat/records/[id]/steps
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { step_id, status, notes, assignee, payment_status } = body;

  if (!step_id) {
    return NextResponse.json({ error: "请提供 step_id" }, { status: 400 });
  }

  const validStatuses = ["待处理", "进行中", "已完成"];
  if (status !== undefined && !validStatuses.includes(status)) {
    return NextResponse.json({ error: "无效的状态值" }, { status: 400 });
  }

  const step = db.prepare("SELECT * FROM vat_record_steps WHERE id = ? AND record_id = ?").get(step_id, id);
  if (!step) return NextResponse.json({ error: "步骤不存在" }, { status: 404 });

  const updates: string[] = [];
  const values: unknown[] = [];

  if (status !== undefined) { updates.push("status = ?"); values.push(status); }
  if (notes !== undefined) { updates.push("notes = ?"); values.push(notes); }
  if (assignee !== undefined) { updates.push("assignee = ?"); values.push(assignee); }
  if (payment_status !== undefined) { updates.push("payment_status = ?"); values.push(payment_status); }

  if (status !== undefined) {
    if (status === "已完成") {
      updates.push("completed_at = datetime('now')");
    } else if (status === "进行中") {
      updates.push("started_at = COALESCE(started_at, datetime('now'))");
      updates.push("completed_at = NULL");
    } else {
      updates.push("completed_at = NULL");
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });
  }

  values.push(step_id, id);
  db.prepare(`UPDATE vat_record_steps SET ${updates.join(", ")} WHERE id = ? AND record_id = ?`).run(...values);

  // Sync record progress
  const steps = db.prepare("SELECT status FROM vat_record_steps WHERE record_id = ? ORDER BY step_order").all(id) as { status: string }[];
  const allDone = steps.every(s => s.status === "已完成");
  if (steps.length > 0 && allDone) {
    db.prepare("UPDATE vat_records SET progress = '归档完成', updated_at = datetime('now') WHERE id = ?").run(id);
  } else if (steps.length > 0) {
    // Find current active step
    const activeStep = steps.find(s => s.status !== "已完成");
    if (activeStep) {
      db.prepare("UPDATE vat_records SET progress = ?, updated_at = datetime('now') WHERE id = ?").run(activeStep.status, id);
    }
  }

  const updated = db.prepare("SELECT * FROM vat_record_steps WHERE id = ?").get(step_id);
  return NextResponse.json(updated);
}
