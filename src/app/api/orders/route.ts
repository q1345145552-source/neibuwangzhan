import { publicOrder } from "@/lib/client-view";
import { getClientCustomerNames, customerNameFilter } from "@/lib/client-scope";
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";
import { getDb, getOrderStepsWithDocs, logOperation } from "@/lib/db";
import { subServices } from "@/lib/constants";
import { isStepClosed } from "@/lib/step-status";

// GET /api/orders?business_type_id=&status=
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const businessTypeId = searchParams.get("business_type_id");
  const status = searchParams.get("status");

  let sql = "SELECT o.* FROM orders o";
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (auth.role === "client") {
    const { names } = getClientCustomerNames(auth.id, auth.name);
    const scope = customerNameFilter(names);
    conditions.push(scope.clause);
    params.push(...scope.params);
  }

  if (businessTypeId) {
    conditions.push("business_type_id = ?");
    params.push(Number(businessTypeId));
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params);
  if (auth.role === "client") return NextResponse.json(rows.map(publicOrder));
  return NextResponse.json(withListSummary(db, rows as ListOrder[]));
}

type ListOrder = { id: string; business_type_id: number; total_amount: number; currency: string | null; status: string; responsible_person: string | null };
/**
 * 订单列表给员工看的摘要（2026-10-16）：做到第几步、当前步骤和经办人、有没有卡住；
 * 收款（只算老板核对过「已到账」的收入，同币种跟订单金额比）；客户站单号（客户报 ORD… 也能搜到）。
 * 一次把步骤、费用、来源单号按单分组，不逐单查库。
 */
function withListSummary(db: ReturnType<typeof getDb>, rows: ListOrder[]) {
  if (!rows.length) return rows;
  const steps = db.prepare("SELECT order_id, step_order, step_name, status, assignee FROM order_steps ORDER BY order_id, step_order, id").all() as
    { order_id: string; step_order: number; step_name: string; status: string; assignee: string | null }[];
  const stepsBy = new Map<string, typeof steps>();
  for (const st of steps) { const l = stepsBy.get(st.order_id); if (l) l.push(st); else stepsBy.set(st.order_id, [st]); }
  const money = db.prepare(`SELECT order_id, COALESCE(currency,'CNY') AS currency,
      SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS arrived,
      SUM(CASE WHEN status IN ('待核对','pending') THEN 1 ELSE 0 END) AS waiting
    FROM finances WHERE type = 'income' GROUP BY order_id, COALESCE(currency,'CNY')`).all() as { order_id: string; currency: string; arrived: number; waiting: number }[];
  const moneyBy = new Map<string, typeof money>();
  for (const m of money) { const l = moneyBy.get(m.order_id); if (l) l.push(m); else moneyBy.set(m.order_id, [m]); }
  const sources = new Map<string, string>();
  for (const r of db.prepare("SELECT internal_order_id, source_order_no FROM sync_inbox WHERE internal_order_id IS NOT NULL AND internal_order_id <> '' ORDER BY line_no, copy_no").all() as { internal_order_id: string; source_order_no: string }[]) {
    if (!sources.has(r.internal_order_id)) sources.set(r.internal_order_id, r.source_order_no);
  }
  return rows.map((o) => {
    const list = stepsBy.get(o.id) || [];
    const closed = list.filter((x) => isStepClosed(x.status));
    // 公司注册各步互不阻塞：当前步骤取正在办/卡住的；其他业务取第一个没办完的
    const open = list.filter((x) => !isStepClosed(x.status));
    const active = o.business_type_id === 1 ? open.filter((x) => x.status === "进行中" || x.status === "阻塞") : [];
    const current = active[0] || open[0] || null;
    const cur = o.currency || "CNY";
    const m = moneyBy.get(o.id) || [];
    return {
      ...o,
      source_order_no: sources.get(o.id) || "",
      progress: {
        total: list.length,
        closed: closed.length,
        current_step: current?.step_name || "",
        current_assignee: current ? ((current.assignee || "").trim() || "") : "",
        more_active: Math.max(active.length - 1, 0),
        blocked: list.filter((x) => x.status === "阻塞").map((x) => x.step_name),
      },
      payment: {
        arrived: m.filter((x) => x.currency === cur).reduce((n, x) => n + Number(x.arrived || 0), 0),
        arrived_other: m.filter((x) => x.currency !== cur).reduce((n, x) => n + Number(x.arrived || 0), 0),
        waiting: m.reduce((n, x) => n + Number(x.waiting || 0), 0),
        has_income: m.length > 0,
        // 有没有老板核对过「已到账」的收入（不分币种）：金额没填的单靠它判断收没收到钱
        has_arrived: m.some((x) => Number(x.arrived || 0) > 0),
      },
    };
  });
}

// POST /api/orders
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const db = getDb();

  const body = await readJson(req);
  const { customer_name, business_type_id, description, responsible_person, total_amount, sub_service_type, address_type, monthly_rent, currency, trademark_name } = body;

  const _e = validateEnums({ "orders.currency": currency });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });
  if (!customer_name || !business_type_id) {
    return NextResponse.json({ error: "请填写客户名和业务线" }, { status: 400 });
  }

  const id = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const now = new Date().toISOString();
  const ssType = sub_service_type || "";
  // 负责人只能是员工：客户账号的名字不收（2026-10-16）
  const rp = String(responsible_person || "").trim();
  if (rp && db.prepare("SELECT 1 FROM employees WHERE name = ? AND role = 'client'").get(rp)
    && !db.prepare("SELECT 1 FROM employees WHERE name = ? AND role IN ('admin','employee')").get(rp)) {
    return NextResponse.json({ error: "负责人只能选员工" }, { status: 400 });
  }
  // 有具体服务的业务线必须选一个：不选会套成通用流程，建完改不了（2026-10-15）
  const options = subServices[Number(business_type_id)] || [];
  if (options.length && !options.some((o) => o.key === ssType)) {
    return NextResponse.json({ error: "请选择子类型" }, { status: 400 });
  }

  try {
    const insertAll = db.transaction(() => {
      const insParams = [id, customer_name, business_type_id, ssType, address_type || "client", monthly_rent || 0, responsible_person || "", description || "", total_amount || 0, currency || "CNY", trademark_name || "", now, now];
      db.prepare(
        "INSERT INTO orders (id, customer_name, business_type_id, sub_service_type, address_type, monthly_rent, status, responsible_person, description, total_amount, currency, trademark_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '待处理', ?, ?, ?, ?, ?, ?, ?)"
      ).run(...insParams);

      const steps = getOrderStepsWithDocs(Number(business_type_id), ssType, address_type);
      const insertStep = db.prepare(
        "INSERT INTO order_steps (order_id, step_name, step_order, status, assignee, notes) VALUES (?, ?, ?, '待处理', ?, ?)"
      );
      const insertStepDoc = db.prepare(
        "INSERT INTO step_documents (step_id, order_id, document_name, status) VALUES (?, ?, ?, 'pending')"
      );
      steps.forEach((step, i) => {
        const res = insertStep.run(id, step.name, i + 1, step.assignee, step.notes || "");
        // 按步骤模板同步生成"所需文件"清单，供订单详情页跟踪上传状态
        for (const docName of step.docs) {
          insertStepDoc.run(res.lastInsertRowid, id, docName);
        }
      });
    });

    insertAll();
    logOperation(auth.name, "创建订单", "order", id, `客户:${customer_name} 业务线:${business_type_id}`);

    // 查找客户池中匹配的客户
    const poolCustomer = db.prepare("SELECT * FROM customers WHERE company_name = ?").get(customer_name) as any;

    // 自动升级客户状态：跟进中 → 已合作，并给升级加分
    if (poolCustomer && poolCustomer.status === '跟进中') {
      db.prepare("UPDATE customers SET status = '已合作', updated_at = datetime('now') WHERE id = ?").run(poolCustomer.id);
      if (poolCustomer.claimed_by) {
        const reason = `客户「${customer_name}」升级为已合作`;
        db.prepare("INSERT INTO points_records (employee_name, points, reason, rule_key, ref_type, ref_id, created_by) VALUES (?, 10, ?, 'customer_upgrade', 'customer', ?, 'system')").run(poolCustomer.claimed_by, reason, String(poolCustomer.id));
      }
    }

    // 成交奖励：给认领员工加 10 分
    if (poolCustomer && poolCustomer.claimed_by) {
      const reason = `成交订单 ORD-关联客户「${customer_name}」`;
      db.prepare("INSERT INTO points_records (employee_name, points, reason, rule_key, ref_type, ref_id, created_by) VALUES (?, 10, ?, 'customer_deal', 'customer', ?, 'system')").run(poolCustomer.claimed_by, reason, String(poolCustomer.id));
    }

    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "服务器内部错误";
    console.error("[POST /api/orders] 错误:", msg, err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
