import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";
import { queueProgressEventsForOrder, requestProgressFlush } from "@/lib/progress-sync";
import { STEP_STATUSES, STEP_SKIPPED, isStepClosed, isParallelFlow, orderStatusFromSteps } from "@/lib/step-status";
import { notifyNextStep } from "@/lib/order-alerts";
import { AWAITING_CONFIRMATION_ERROR, isAwaitingConfirmation } from "@/lib/order-confirm";

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
  // 跳过、标阻塞时写的原因：记进这一步的备注（2026-10-16）
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";

  if (!step_id) {
    return NextResponse.json({ error: "请提供 step_id" }, { status: 400 });
  }

  // status 可选：只改负责人/备注等字段时不必传，避免误触完成时间的重算逻辑
  if (status !== undefined && !(STEP_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "无效的状态值" }, { status: 400 });
  }

  const step = db.prepare("SELECT * FROM order_steps WHERE id = ? AND order_id = ?").get(step_id, id) as { status: string; step_order: number; step_name: string; assignee: string } | undefined;
  if (!step) {
    return NextResponse.json({ error: "步骤不存在" }, { status: 404 });
  }
  // 客户网站来的单没确认前不能开始办理（2026-10-19）；只改经办人、备注不拦
  if (status !== undefined && status !== step.status && isAwaitingConfirmation(db, id)) {
    return NextResponse.json({ error: AWAITING_CONFIRMATION_ERROR }, { status: 409 });
  }
  if (status === STEP_SKIPPED && step.status !== STEP_SKIPPED) {
    if (!reason) return NextResponse.json({ error: "跳过要写原因" }, { status: 400 });
    if (step.status === "已完成") return NextResponse.json({ error: "已完成的步骤不能跳过，先撤回" }, { status: 400 });
    const range = db.prepare("SELECT MIN(step_order) AS lo, MAX(step_order) AS hi FROM order_steps WHERE order_id = ?").get(id) as { lo: number; hi: number };
    if (step.step_order === range.lo || step.step_order === range.hi) {
      return NextResponse.json({ error: "第一步和最后一步不能跳过" }, { status: 400 });
    }
    // 只能跳「当前这一步」：前面都办完（或跳过）了才能跳，免得提前把后面的人叫起来。公司注册各步互不阻塞，不限
    const ord = db.prepare("SELECT business_type_id, sub_service_type FROM orders WHERE id = ?").get(id) as { business_type_id: number; sub_service_type: string | null } | undefined;
    const openBefore = db.prepare("SELECT 1 FROM order_steps WHERE order_id = ? AND step_order < ? AND status NOT IN ('已完成','已跳过') LIMIT 1").get(id, step.step_order);
    if (!(ord && isParallelFlow(ord.business_type_id, ord.sub_service_type)) && openBefore) {
      return NextResponse.json({ error: "前面还有步骤没办完，等轮到这一步再跳过" }, { status: 400 });
    }
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
    // 经办人只能是员工：客户账号的名字不收（合作方等非账号名字照旧可以填）
    if (assignee && db.prepare("SELECT 1 FROM employees WHERE name = ? AND role = 'client'").get(assignee)
      && !db.prepare("SELECT 1 FROM employees WHERE name = ? AND role IN ('admin','employee')").get(assignee)) {
      return NextResponse.json({ error: "经办人只能选员工" }, { status: 400 });
    }
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
    if (status === "已完成" || status === STEP_SKIPPED) {
      // 跳过也记下时刻：下一步「从什么时候开始等」、计时器都按它算（耗时统计只认已完成，不会把跳过算进去）
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
      if (reason && (status === STEP_SKIPPED || status === "阻塞") && status !== step.status) {
        db.prepare("INSERT INTO step_notes (step_id, order_id, content, created_by) VALUES (?, ?, ?, ?)")
          .run(step_id, id, `${status === STEP_SKIPPED ? "跳过原因" : "卡住原因"}：${reason}`, auth.name || "");
      }

      // 取消状态粘住；恢复动作仍由订单接口按真实步骤状态计算。
      const orderStatusRow = db.prepare("SELECT status FROM orders WHERE id = ?").get(id) as { status: string } | undefined;
      if (!orderStatusRow || orderStatusRow.status !== "客户取消") {
        const steps = db.prepare("SELECT status FROM order_steps WHERE order_id = ?").all(id) as { status: string }[];
        const orderStatus = orderStatusFromSteps(steps.map((s) => s.status));
        if (orderStatus) {
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
  // 这一步刚做完（或跳过）：提醒下一步的经办人「轮到你了」（2026-10-16）
  if (status !== undefined && isStepClosed(status) && !isStepClosed(step.status)) {
    try { notifyNextStep(db, id, step.step_order, auth.name || "", status === STEP_SKIPPED ? "已跳过" : "已办完"); } catch (error) { console.error("[orders/steps] 下一步提醒失败:", error); }
  }
  const oldAssignee = (step as { assignee: string }).assignee || "";
  if (assignee !== undefined && oldAssignee !== assignee) {
    logOperation(auth.name, "修改负责人", "step", String(step_id), `${(step as { step_name: string }).step_name}: ${oldAssignee} → ${assignee}`, oldAssignee, assignee, "assignee");
  }
  // 没改状态时原来写成「更新步骤:已撤回」，员工动态和自动日报会误读成撤回：只改经办人的已有「修改负责人」那条，不再重复记
  if (status !== undefined) logOperation(auth.name || "系统", `更新步骤:${status}`, "step", String(step_id), `订单:${id}`);
  else if (notes !== undefined || approval_status !== undefined || submission_count !== undefined) logOperation(auth.name || "系统", "更新步骤:修改内容", "step", String(step_id), `订单:${id}`);
  return NextResponse.json(result.step);
}
