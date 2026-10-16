import { readOrderPurchase } from "@/lib/commerce-terms";
import { publicOrder, publicSteps } from "@/lib/client-view";
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, getLegacyOrderStepsWithDocs, getOrderStepsWithDocs, logOperation } from "@/lib/db";
import { checkOrderCustomer, createOrderCustomer } from "@/lib/order-customer";
import { subServices } from "@/lib/constants";
import { orderStatusFromSteps } from "@/lib/step-status";
import { notifyNextStep } from "@/lib/order-alerts";
import { queueProgressEventsForOrder, requestProgressFlush } from "@/lib/progress-sync";
import { approvePending } from "@/lib/cancel-sync";
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

  // 非改派的普通编辑：改业务线、具体服务或地址类型时步骤不会跟着换，单子会跑到别的业务线列表里、步骤却还是原来那套。
  // 只在新组合的流程步骤和这张单现有步骤完全一样时放行（比如给没选具体服务的老单补选同一套流程的服务），否则拦下（2026-10-15）
  if (!reassign) {
    const cur = existing as { business_type_id: number; sub_service_type?: string | null; address_type?: string | null };
    const nextBt = body.business_type_id !== undefined ? Number(body.business_type_id) : Number(cur.business_type_id);
    const nextSub = body.sub_service_type !== undefined ? String(body.sub_service_type || "") : String(cur.sub_service_type || "");
    const nextAddr = body.address_type !== undefined ? String(body.address_type || "client") : String(cur.address_type || "client");
    const changed = nextBt !== Number(cur.business_type_id) || nextSub !== String(cur.sub_service_type || "") || nextAddr !== String(cur.address_type || "client");
    if (changed) {
      const stepNames = (db.prepare("SELECT step_name FROM order_steps WHERE order_id = ? ORDER BY step_order, id").all(id) as { step_name: string }[]).map(r => r.step_name);
      // 流程设置里改过名的，老单还是原来的步骤名：跟现在的流程或程序里的原样流程一样都算同一套；
      // 这张单是按系统里某套流程（任何一版）建的、新组合现在用的也是那一套，同样算（几种服务共用一套流程时换服务）
      const target = getOrderStepsWithDocs(nextBt, nextSub || undefined, nextAddr);
      const templateOf = (vid: number | null | undefined) => vid ? (db.prepare("SELECT template_id AS t FROM workflow_template_versions WHERE id = ?").get(vid) as { t: number } | undefined)?.t ?? null : null;
      const orderTemplates = (db.prepare("SELECT DISTINCT v.template_id AS t FROM order_steps s JOIN workflow_template_versions v ON v.id = s.template_version_id WHERE s.order_id = ?").all(id) as { t: number }[]).map(r => r.t);
      const targetTemplate = templateOf(target[0]?.template_version_id);
      const sameTemplate = targetTemplate != null && orderTemplates.length === 1 && orderTemplates[0] === targetTemplate;
      const sameFlow = stepNames.length > 0 && (sameTemplate || [target, getLegacyOrderStepsWithDocs(nextBt, nextSub || undefined, nextAddr)]
        .some(tpl => JSON.stringify(tpl.map(st => st.name)) === JSON.stringify(stepNames)));
      if (stepNames.length > 0 && !sameFlow) {
        return NextResponse.json({ error: "建单后不能改业务线、子类型或地址类型（步骤不会跟着换）。建错了请取消这张单，重新建一张。" }, { status: 409 });
      }
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  // 员工建的单改客户：跟新建订单一样要从客户管理里选、没有的当场新建（2026-10-16，2A）；没改、或客户站/商城来的单照旧
  let newCustomer: string | null = null;
  if (body.customer_name !== undefined) {
    const original = (existing as { customer_name?: string | null }).customer_name ?? "";
    const before = String(original).trim();
    let next: unknown = body.customer_name;
    // 员工建的单只多打了前后空格：算没改，照存原名（不然跟客户管理就对不上了）
    if (!synchronized && String(body.customer_name ?? "").trim() === before) next = original;
    if (!synchronized && String(body.customer_name ?? "").trim() !== before) {
      const customer = checkOrderCustomer(db, body.customer_name, body.new_customer, auth.role);
      if (!customer.ok) return NextResponse.json({ error: customer.error }, { status: customer.status });
      next = customer.name;
      if (customer.create) newCustomer = customer.name;
    }
    fields.push("customer_name = ?"); values.push(next);
  }
  if (reassign) {
    fields.push("business_type_id = ?", "sub_service_type = ?", "address_type = ?", "status = ?");
    values.push(reassign.businessTypeId, reassign.subServiceType, reassign.addressType, "进行中");
  } else if (body.business_type_id !== undefined) { fields.push("business_type_id = ?"); values.push(Number(body.business_type_id)); }
  if (body.responsible_person !== undefined) {
    // 负责人只能是员工：客户账号的名字不收（同步骤经办人的规矩，2026-10-16）；只在真改了的时候查，老单原样保存不受影响
    const rp = String(body.responsible_person || "").trim();
    const unchanged = rp === String((existing as { responsible_person?: string | null }).responsible_person || "").trim();
    if (rp && !unchanged && db.prepare("SELECT 1 FROM employees WHERE name = ? AND role = 'client'").get(rp)
      && !db.prepare("SELECT 1 FROM employees WHERE name = ? AND role IN ('admin','employee')").get(rp)) {
      return NextResponse.json({ error: "负责人只能选员工" }, { status: 400 });
    }
    fields.push("responsible_person = ?"); values.push(body.responsible_person);
  }
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
    const newStatus = orderStatusFromSteps(steps.map((s) => s.status)) || "待处理";
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
      if (newCustomer) createOrderCustomer(db, newCustomer, auth.name || "", id);
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
        const insertStep = db.prepare("INSERT INTO order_steps(order_id,step_name,step_order,status,assignee,notes,expected_days,template_version_id,public_name) VALUES (?,?,?,'待处理',?,?,?,?,?)");
        const insertDoc = db.prepare("INSERT INTO step_documents(step_id,order_id,document_name,status) VALUES (?,?,?,'pending')");
        // 新业务线模板第一步也是「方案确认」，已保留原来那步，不重复加
        getOrderStepsWithDocs(reassign.businessTypeId, reassign.subServiceType, reassign.addressType).slice(1).forEach((step, i) => {
          const inserted = insertStep.run(id, step.name, last + 1 + i, step.assignee, step.notes || "", step.expected_days ?? null, step.template_version_id ?? null, step.public_name ?? null);
          for (const name of step.docs) insertDoc.run(inserted.lastInsertRowid, id, name);
        });
      }
      db.prepare(sql).run(...values);
      const progressQueued = queueProgressEventsForOrder(id, db);
      // 管理员直接取消：这张单上客户待处理的取消申请一并记同意并回传（2026-10-03，规则 19）；
      // 放在进度入队之后，结果里带的才是这次取消对应的进度版本
      const approvedRequests = body.cancel === true ? approvePending(db, id, auth.name) : 0;
      const queued = progressQueued + approvedRequests;
      return { queued, order: db.prepare("SELECT * FROM orders WHERE id = ?").get(id) };
    }).immediate();
  } catch (error) {
    if (error instanceof ReassignConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("[orders] 保存订单/进度事务失败:", error);
    return NextResponse.json({ error: "保存失败，订单与进度均未提交，请重试" }, { status: 500 });
  }

  // HTTP 发送与事务分离；离线只影响传输，入队失败则整笔保存回滚。
  if (result.queued > 0) requestProgressFlush();
  // 改派时「确认归属」被标成已完成：跟正常点完成一样提醒接上来的那一步（2026-10-16）
  if (reassign) {
    try {
      const claimName = getOrderStepsWithDocs(0, UNCLASSIFIED_SUB)[1]?.name;
      const claim = db.prepare("SELECT step_order FROM order_steps WHERE order_id = ? AND step_name = ? ORDER BY step_order LIMIT 1").get(id, claimName) as { step_order: number } | undefined;
      if (claim) notifyNextStep(db, id, claim.step_order, auth.name || "");
    } catch (error) { console.error("[orders] 改派后下一步提醒失败:", error); }
  }
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

  // 10-16 老板定：只有管理员能删订单，员工只能「取消订单」（删了步骤、文件、费用一起没，恢复不了）
  if (auth.role !== "admin") return NextResponse.json({ error: "只有管理员能删订单，员工请用「取消订单」" }, { status: 403 });

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
  // 删单时记下带走的收入（2026-10-15）
  const incomeNote = (db.prepare("SELECT type, amount, currency, status FROM finances WHERE order_id = ? AND type = 'income'").all(id) as { amount: number; currency: string | null; status: string }[])
    .map(f => `${f.amount} ${(f.currency || "CNY") === "THB" ? "泰铢" : "人民币"}（${f.status}）`).join("、");

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

  logOperation(auth.name, "删除订单", "order", id, incomeNote ? `带走收入：${incomeNote}` : undefined);
  return NextResponse.json({ success: true });
}
