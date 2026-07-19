import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

const PROGRESS_STEPS = ["收资料", "Excel 计算", "发客户确认", "e-Filing 提交", "付款纳税", "归档完成"];
const DEFAULT_ASSIGNEES: Record<number, string> = { 1: "Eve", 2: "Eve", 3: "Eve", 4: "Pop", 5: "Pop", 6: "Pop" };

function generateForCustomer(db: ReturnType<typeof getDb>, customerId: number, month: string): "created" | "exists" {
  const existing = db.prepare("SELECT id FROM vat_records WHERE customer_id = ? AND year_month = ?").get(customerId, month);
  if (existing) return "exists";

  const result = db.prepare("INSERT INTO vat_records (customer_id, year_month, progress, assignee) VALUES (?, ?, '收资料', 'Eve')").run(customerId, month);
  const recordId = result.lastInsertRowid;
  for (let i = 0; i < PROGRESS_STEPS.length; i++) {
    const order = i + 1;
    db.prepare("INSERT INTO vat_record_steps (record_id, step_name, step_order, assignee) VALUES (?, ?, ?, ?)")
      .run(recordId, PROGRESS_STEPS[i], order, DEFAULT_ASSIGNEES[order] || "");
  }
  return "created";
}

// POST /api/vat/records/generate
// body: { month: "YYYY-MM" } — 批量生成全部启用客户
// body: { month: "YYYY-MM", customer_id: number } — 单个客户生成
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const body = await req.json();
  const month = body.month;
  if (!month) return NextResponse.json({ error: "请指定月份" }, { status: 400 });

  const db = getDb();

  // 单个客户生成
  if (body.customer_id) {
    const customerId = Number(body.customer_id);
    const customer = db.prepare("SELECT * FROM vat_customers WHERE id = ?").get(customerId) as any;
    if (!customer) return NextResponse.json({ error: "客户不存在" }, { status: 404 });
    if (customer.status !== "启用") return NextResponse.json({ error: "只能为启用状态的客户生成记录" }, { status: 400 });

    const result = generateForCustomer(db, customerId, month);
    if (result === "exists") return NextResponse.json({ error: "本月已有申报记录" }, { status: 409 });
    return NextResponse.json({ created: 1, message: `已为 ${customer.company_name} 生成 ${month} 申报记录` });
  }

  // 批量生成全部启用客户
  const customers = db.prepare("SELECT id FROM vat_customers WHERE status = '启用'").all() as { id: number }[];
  if (customers.length === 0) return NextResponse.json({ error: "没有启用的客户" }, { status: 400 });

  let created = 0;
  const txn = db.transaction(() => {
    for (const c of customers) {
      if (generateForCustomer(db, c.id, month) === "created") created++;
    }
  });
  txn();

  return NextResponse.json({ created, message: `已为 ${created} 个客户生成 ${month} 申报记录` });
}
