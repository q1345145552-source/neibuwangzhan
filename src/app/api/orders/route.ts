import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb, getOrderStepsWithDocs, logOperation } from "@/lib/db";

// GET /api/orders?business_type_id=&status=
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const businessTypeId = searchParams.get("business_type_id");
  const status = searchParams.get("status");

  let sql = "SELECT * FROM orders";
  const conditions: string[] = [];
  const params: unknown[] = [];

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
  return NextResponse.json(rows);
}

// POST /api/orders
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();

  const body = await req.json();
  const { customer_name, business_type_id, description, responsible_person, total_amount, sub_service_type, address_type, monthly_rent, currency, trademark_name } = body;

  if (!customer_name || !business_type_id) {
    return NextResponse.json({ error: "请填写客户名和业务线" }, { status: 400 });
  }

  const id = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const now = new Date().toISOString();
  const ssType = sub_service_type || "";

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
        db.prepare("INSERT INTO points_records (employee_name, points, reason, rule_key, ref_type, created_by) VALUES (?, 10, ?, 'customer_upgrade', 'customer', 'system')").run(poolCustomer.claimed_by, reason);
      }
    }

    // 成交奖励：给认领员工加 10 分
    if (poolCustomer && poolCustomer.claimed_by) {
      const reason = `成交订单 ORD-关联客户「${customer_name}」`;
      db.prepare("INSERT INTO points_records (employee_name, points, reason, rule_key, ref_type, created_by) VALUES (?, 10, ?, 'customer_deal', 'customer', 'system')").run(poolCustomer.claimed_by, reason);
    }

    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "服务器内部错误";
    console.error("[POST /api/orders] 错误:", msg, err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
