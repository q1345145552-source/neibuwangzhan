import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb, logOperation } from "@/lib/db";

// PATCH /api/orders/:id/steps
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { step_id, status, notes, assignee, approval_status, submission_count } = body;

  if (!step_id || !status) {
    return NextResponse.json({ error: "请提供 step_id 和 status" }, { status: 400 });
  }

  const validStatuses = ["待处理", "进行中", "已完成", "阻塞"];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: "无效的状态值" }, { status: 400 });
  }

  const step = db.prepare("SELECT * FROM order_steps WHERE id = ? AND order_id = ?").get(step_id, id);
  if (!step) {
    return NextResponse.json({ error: "步骤不存在" }, { status: 404 });
  }

  const updates: string[] = ["status = ?"];
  const values: unknown[] = [status];

  if (notes !== undefined) {
    updates.push("notes = ?");
    values.push(notes);
  }
  if (assignee !== undefined) {
    updates.push("assignee = ?");
    values.push(assignee);
  }
  if (approval_status !== undefined) {
    updates.push("approval_status = ?");
    values.push(approval_status);
  }
  if (submission_count !== undefined) {
    updates.push("submission_count = ?");
    values.push(submission_count);
  }
  if (status === "已完成") {
    updates.push("completed_at = datetime('now')");
  } else {
    // 撤回：清空完成时间
    updates.push("completed_at = NULL");
  }

  values.push(step_id, id);
  db.prepare(`UPDATE order_steps SET ${updates.join(", ")} WHERE id = ? AND order_id = ?`).run(...values);

  const updated = db.prepare("SELECT * FROM order_steps WHERE id = ?").get(step_id);

  // 同步订单状态
  const steps = db.prepare("SELECT status FROM order_steps WHERE order_id = ?").all(id) as { status: string }[];
  const allDone = steps.every((s) => s.status === "已完成" || s.status === "阻塞");
  const anyProgress = steps.some((s) => s.status === "进行中");
  if (steps.length > 0) {
    let orderStatus = "待处理";
    if (allDone) orderStatus = "已完成";
    else if (anyProgress) orderStatus = "进行中";
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(orderStatus, id);
  }

  logOperation(auth.name || "系统", `更新步骤:${status || "已撤回"}`, "step", String(step_id), `订单:${id}`);
  return NextResponse.json(updated);
}
