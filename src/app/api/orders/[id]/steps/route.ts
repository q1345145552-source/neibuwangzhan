import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";
import { queueProgressEventsForOrder, requestProgressFlush } from "@/lib/progress-sync";

// PATCH /api/orders/:id/steps
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const body = await readJson(req);
  const { step_id, status, notes, assignee, approval_status, submission_count } = body;

  if (!step_id) {
    return NextResponse.json({ error: "请提供 step_id" }, { status: 400 });
  }

  // status 可选：只改负责人/备注等字段时不必传，避免误触完成时间的重算逻辑
  const validStatuses = ["待处理", "进行中", "已完成", "阻塞"];
  if (status !== undefined && !validStatuses.includes(status)) {
    return NextResponse.json({ error: "无效的状态值" }, { status: 400 });
  }

  const step = db.prepare("SELECT * FROM order_steps WHERE id = ? AND order_id = ?").get(step_id, id);
  if (!step) {
    return NextResponse.json({ error: "步骤不存在" }, { status: 404 });
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  if (status !== undefined) {
    updates.push("status = ?");
    values.push(status);
  }

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
  if (status !== undefined) {
    if (status === "已完成") {
      updates.push("completed_at = datetime('now')");
    } else if (status === "进行中") {
      // 点"开始"：记录开始时间（首次点开始才记，避免撤回后重新开始覆盖）
      updates.push("started_at = COALESCE(started_at, datetime('now'))");
      updates.push("completed_at = NULL");
    } else {
      // 撤回：清空完成时间
      updates.push("completed_at = NULL");
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });
  }

  values.push(step_id, id);
  let result: { queued: number; step: unknown; cancelled?: boolean };
  try {
    result = db.transaction(() => {
      // Serialize against admin cancellation: check before the first step write.
      // Historical manual orders keep their existing restore/workflow behavior.
      const currentOrder = db.prepare("SELECT source_system, status FROM orders WHERE id = ?").get(id) as { source_system: string | null; status: string } | undefined;
      if (status !== undefined && currentOrder?.source_system === "commerce" && currentOrder.status === "客户取消") {
        return { queued: 0, step: null, cancelled: true };
      }
      db.prepare(`UPDATE order_steps SET ${updates.join(", ")} WHERE id = ? AND order_id = ?`).run(...values);

      // 取消状态粘住；恢复动作仍由订单接口按真实步骤状态计算。
      const orderStatusRow = db.prepare("SELECT status FROM orders WHERE id = ?").get(id) as { status: string } | undefined;
      if (!orderStatusRow || orderStatusRow.status !== "客户取消") {
        const steps = db.prepare("SELECT status FROM order_steps WHERE order_id = ?").all(id) as { status: string }[];
        const allDone = steps.every((s) => s.status === "已完成");
        const anyActivity = steps.some((s) => s.status === "进行中" || s.status === "已完成" || s.status === "阻塞");
        if (steps.length > 0) {
          const orderStatus = allDone ? "已完成" : anyActivity ? "进行中" : "待处理";
          db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(orderStatus, id);
        }
      }

      const queued = queueProgressEventsForOrder(id, db);
      return { queued, step: db.prepare("SELECT * FROM order_steps WHERE id = ?").get(step_id) };
    }).immediate();
  } catch (error) {
    console.error("[orders/steps] 保存步骤/进度事务失败:", error);
    return NextResponse.json({ error: "保存失败，步骤、订单与进度均未提交，请重试" }, { status: 500 });
  }

  if (result.cancelled) return NextResponse.json({ error: "本服务已批准取消，保留原步骤；仍可补充资料与备注" }, { status: 409 });
  if (result.queued > 0) requestProgressFlush();
  const oldAssignee = (step as { assignee: string }).assignee || "";
  if (assignee !== undefined && oldAssignee !== assignee) {
    logOperation(auth.name, "修改负责人", "step", String(step_id), `${(step as { step_name: string }).step_name}: ${oldAssignee} → ${assignee}`, oldAssignee, assignee, "assignee");
  }
  logOperation(auth.name || "系统", `更新步骤:${status || "已撤回"}`, "step", String(step_id), `订单:${id}`);
  return NextResponse.json(result.step);
}
