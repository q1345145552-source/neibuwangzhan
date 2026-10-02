import { readOrderPurchase } from "@/lib/commerce-terms";
import { publicOrder, publicSteps } from "@/lib/client-view";
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, getOrderStepsWithDocs, logOperation } from "@/lib/db";
import { subServices } from "@/lib/constants";
import { queueProgressEventsForOrder, requestProgressFlush } from "@/lib/progress-sync";
import { isClientOrderVisible } from "@/lib/client-scope";

// 待分类改派（2026-10-03 老板选 A）：客户站同步的待分类单改到正式业务线时，换成那条线的整套流程。
const UNCLASSIFIED_SUB = "storefront-unclassified";
const DELIVER_STEP = "办理并交付";
class ReassignConflict extends Error {}

// GET /api/orders/:id
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  // 此通用详情接口也是客户可达入口；与 external 接口共用范围，禁止绕过同步单隔离。
  if (auth.role === "client" && !isClientOrderVisible(auth.id, auth.name, id)) {
    return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  }
  const db = getDb();

  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!order) {
    return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  }

  const steps = db.prepare(
    "SELECT * FROM order_steps WHERE order_id = ? ORDER BY step_order"
  ).all(id);

  return NextResponse.json(auth.role === "client"
    ? { ...publicOrder(order), steps: publicSteps(steps) }
    : { ...order as object, steps, commerce_purchase: readOrderPurchase(db,id) });
}

// PATCH /api/orders/:id
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

  const existing = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!existing) return NextResponse.json({ error: "订单不存在" }, { status: 404 });

  const body = await readJson(req);
  // Native sales have immutable purchased scope and a separate invoice. A generic
  // fulfillment edit must not become a second pricing/cancellation/assignment writer.
  const commerce = (existing as { source_system?: string }).source_system === "commerce";
  if (commerce) {
    const row = existing as Record<string, unknown>;
    const fixed = ["customer_name","business_type_id","sub_service_type","address_type","monthly_rent","total_amount","currency","trademark_name"];
    if (body.cancel === true || body.restore === true || body.status !== undefined ||
        fixed.some(key => body[key] !== undefined && String(body[key]) !== String(row[key] ?? ""))) {
      return NextResponse.json({ error: "商城成交资料和账单保持原值；取消、改派及调账尚未接入本批入口" }, { status: 409 });
    }
  }
  const current = existing as { source_system?: string; total_amount: number; currency: string; monthly_rent: number };
  const synchronized = Boolean(current.source_system) || Boolean(db.prepare(
    "SELECT 1 FROM sync_inbox WHERE internal_order_id = ? LIMIT 1"
  ).get(id));
  if (synchronized && (body.cancel === true || body.restore === true) && auth.role !== 'admin') {
    return NextResponse.json({ error: '同步订单取消和恢复仅管理员可操作' }, { status: 403 });
  }
  if (body.cancel === true && body.restore === true) return NextResponse.json({error:'取消和恢复不能同时提交'}, {status:400});
  // 过渡期客户账单是金额唯一写方；同值字段随编辑表单提交仍可保存备注/流程。
  const financialChange =
    (body.total_amount !== undefined && Number(body.total_amount) !== Number(current.total_amount)) ||
    (body.currency !== undefined && String(body.currency || "CNY") !== String(current.currency || "CNY")) ||
    (body.monthly_rent !== undefined && Number(body.monthly_rent) !== Number(current.monthly_rent));
  if (synchronized && financialChange) {
    return NextResponse.json({ error: "同步订单金额由客户站账单维护，请在客户站调整" }, { status: 403 });
  }
  // 待分类改派：只认子服务还是 storefront-unclassified 的单，换到别的业务线（或给旧单补选具体服务）时触发；
  // 有具体服务可选的业务线必须选一个，地址认证可选湘泰地址。换完子服务就不再是待分类，所以只会换一次。
  const row = existing as { business_type_id: number; sub_service_type?: string };
  let reassign: { businessTypeId: number; subServiceType: string; addressType: string } | null = null;
  if (row.sub_service_type === UNCLASSIFIED_SUB && body.business_type_id !== undefined &&
      (Number(body.business_type_id) !== Number(row.business_type_id) || (body.sub_service_type !== undefined && body.sub_service_type !== UNCLASSIFIED_SUB))) {
    const target = db.prepare("SELECT id, name FROM business_types WHERE id = ?").get(Number(body.business_type_id)) as { id: number; name: string } | undefined;
    if (!target) return NextResponse.json({ error: "业务线不存在" }, { status: 400 });
    if (target.name !== "待分类") {
      const options = subServices[target.id] || [];
      const sub = body.sub_service_type === undefined || body.sub_service_type === UNCLASSIFIED_SUB ? "" : String(body.sub_service_type);
      if (options.length ? !options.some(option => option.key === sub) : sub !== "") {
        return NextResponse.json({ error: options.length ? `改派到「${target.name}」要先选具体服务` : `「${target.name}」没有具体服务可选` }, { status: 400 });
      }
      reassign = { businessTypeId: target.id, subServiceType: sub, addressType: target.name === "地址认证" && body.address_type === "xiangtai" ? "xiangtai" : "client" };
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (body.customer_name !== undefined) { fields.push("customer_name = ?"); values.push(body.customer_name); }
  if (reassign) {
    fields.push("business_type_id = ?", "sub_service_type = ?", "address_type = ?", "status = ?");
    values.push(reassign.businessTypeId, reassign.subServiceType, reassign.addressType, "进行中");
  } else if (body.business_type_id !== undefined) { fields.push("business_type_id = ?"); values.push(Number(body.business_type_id)); }
  if (body.responsible_person !== undefined) { fields.push("responsible_person = ?"); values.push(body.responsible_person); }
  if (body.description !== undefined) { fields.push("description = ?"); values.push(body.description); }
  if (body.total_amount !== undefined) { fields.push("total_amount = ?"); values.push(Number(body.total_amount)); }
  if (!reassign && body.sub_service_type !== undefined) { fields.push("sub_service_type = ?"); values.push(body.sub_service_type); }
  if (!reassign && body.address_type !== undefined) { fields.push("address_type = ?"); values.push(body.address_type); }
  if (body.monthly_rent !== undefined) { fields.push("monthly_rent = ?"); values.push(Number(body.monthly_rent)); }
  if (body.currency !== undefined) { fields.push("currency = ?"); values.push(body.currency || "CNY"); }
  if (body.trademark_name !== undefined) { fields.push("trademark_name = ?"); values.push(body.trademark_name); }

  // 取消订单：必须填取消原因
  if (body.cancel === true) {
    const reason = String(body.cancel_reason || "").trim();
    if (!reason) return NextResponse.json({ error: "请填写取消原因" }, { status: 400 });
    fields.push("status = ?"); values.push("客户取消");
    fields.push("cancel_reason = ?"); values.push(reason);
  }
  // 恢复订单：按步骤重新计算状态（回到跟着步骤走）
  if (body.restore === true) {
    const steps = db.prepare("SELECT status FROM order_steps WHERE order_id = ?").all(id) as { status: string }[];
    const allDone = steps.length > 0 && steps.every((s) => s.status === "已完成");
    const anyActivity = steps.some((s) => s.status === "进行中" || s.status === "已完成" || s.status === "阻塞");
    const newStatus = allDone ? "已完成" : anyActivity ? "进行中" : "待处理";
    fields.push("status = ?"); values.push(newStatus);
    fields.push("cancel_reason = ?"); values.push("");
  }

  if (fields.length === 0) return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });

  fields.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  const sql = `UPDATE orders SET ${fields.join(", ")} WHERE id = ?`;
  let result: { queued: number; order: unknown };
  try {
    result = db.transaction(() => {
      if (reassign) {
        const fresh = db.prepare("SELECT sub_service_type, status FROM orders WHERE id = ?").get(id) as { sub_service_type: string; status: string };
        if (fresh.sub_service_type !== UNCLASSIFIED_SUB) throw new ReassignConflict("这张单已经改派过了，请刷新页面");
        if (fresh.status === "客户取消") throw new ReassignConflict("已取消的单不能改派");
        const steps = db.prepare("SELECT id, step_order, step_name, status FROM order_steps WHERE order_id = ? ORDER BY step_order").all(id) as { id: number; step_order: number; step_name: string; status: string }[];
        const claimName = getOrderStepsWithDocs(0, UNCLASSIFIED_SUB)[1]?.name;
        const claim = steps.find(step => step.step_name === claimName);
        if (!claim) throw new ReassignConflict("找不到「确认归属」这一步，请联系管理员核对");
        const deliver = steps.find(step => step.step_name === DELIVER_STEP && step.step_order > claim.step_order);
        if (deliver) {
          if (deliver.status !== "待处理") throw new ReassignConflict("「办理并交付」已经开始办了，不能再改派；要改派，先把这一步撤回未开始");
          // 占位步骤还没开始：上面的备注挪到「确认归属」，再去掉这一步，由新业务线的流程接上
          db.prepare("UPDATE step_notes SET step_id = ? WHERE step_id = ?").run(claim.id, deliver.id);
          db.prepare("DELETE FROM step_documents WHERE step_id = ?").run(deliver.id);
          db.prepare("DELETE FROM order_steps WHERE id = ?").run(deliver.id);
        }
        db.prepare("UPDATE order_steps SET status = '已完成', completed_at = COALESCE(completed_at, datetime('now')) WHERE id = ?").run(claim.id);
        const last = (db.prepare("SELECT MAX(step_order) AS n FROM order_steps WHERE order_id = ?").get(id) as { n: number }).n;
        const insertStep = db.prepare("INSERT INTO order_steps(order_id,step_name,step_order,status,assignee,notes) VALUES (?,?,?,'待处理',?,?)");
        const insertDoc = db.prepare("INSERT INTO step_documents(step_id,order_id,document_name,status) VALUES (?,?,?,'pending')");
        // 新业务线模板第一步也是「方案确认」，已保留原来那步，不重复加
        getOrderStepsWithDocs(reassign.businessTypeId, reassign.subServiceType, reassign.addressType).slice(1).forEach((step, i) => {
          const inserted = insertStep.run(id, step.name, last + 1 + i, step.assignee, step.notes || "");
          for (const name of step.docs) insertDoc.run(inserted.lastInsertRowid, id, name);
        });
      }
      db.prepare(sql).run(...values);
      const queued = queueProgressEventsForOrder(id, db);
      return { queued, order: db.prepare("SELECT * FROM orders WHERE id = ?").get(id) };
    }).immediate();
  } catch (error) {
    if (error instanceof ReassignConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("[orders] 保存订单/进度事务失败:", error);
    return NextResponse.json({ error: "保存失败，订单与进度均未提交，请重试" }, { status: 500 });
  }

  // HTTP 发送与事务分离；离线只影响传输，入队失败则整笔保存回滚。
  if (result.queued > 0) requestProgressFlush();
  logOperation(auth.name, reassign ? "待分类改派" : "修改订单", "order", id, reassign ? JSON.stringify(reassign) : `${fields.join(",")}`);
  return NextResponse.json(result.order);
}

// DELETE /api/orders/:id
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

  const existing = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!existing) return NextResponse.json({ error: "订单不存在" }, { status: 404 });

  const synchronized = Boolean((existing as { source_system?: string }).source_system) || Boolean(db.prepare(
    "SELECT 1 FROM sync_inbox WHERE internal_order_id = ? LIMIT 1"
  ).get(id));
  if (synchronized) {
    return NextResponse.json({ error: "同步订单请使用取消操作，保留来源台账与账单关联" }, { status: 409 });
  }

  db.transaction(() => {
    db.prepare("DELETE FROM step_notes WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM step_documents WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM order_steps WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM documents WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM finances WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM certificates WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM tasks WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM orders WHERE id = ?").run(id);
  })();

  logOperation(auth.name, "删除订单", "order", id);
  return NextResponse.json({ success: true });
}
