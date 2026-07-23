import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// Step templates per subtype
const WHT_STEPS: Record<string, { name: string; assignee: string; optional?: boolean }[]> = {
  "ภ.ง.ด.1": [
    { name: "收集员工名单和工资信息", assignee: "Eve" },
    { name: "登录客户系统填表申报", assignee: "Eve" },
    { name: "员工工资超过26000需缴税", assignee: "Pop", optional: true },
    { name: "等待回执", assignee: "" },
    { name: "开具发票", assignee: "Pop" },
    { name: "归档", assignee: "Eve" },
  ],
  "ภ.ง.ด.53": [
    { name: "收集发票和收款方公司信息", assignee: "Eve" },
    { name: "登录客户系统填表申报", assignee: "Eve" },
    { name: "客户缴税", assignee: "Pop" },
    { name: "开具50ทวิ证明给收款方", assignee: "Eve" },
    { name: "等待回执", assignee: "" },
    { name: "开具发票", assignee: "Pop" },
    { name: "归档", assignee: "Eve" },
  ],
};

function seedRecordSteps(db: any, recordId: number, subtype: string) {
  const steps = WHT_STEPS[subtype] || [];
  const insert = db.prepare(
    "INSERT INTO wht_record_steps (record_id, step_order, step_name, assignee, status) VALUES (?, ?, ?, ?, ?)"
  );
  steps.forEach((s, i) => {
    insert.run(recordId, i + 1, s.name, s.assignee || "Eve", s.optional ? "已跳过" : "待处理");
  });
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const month = url.searchParams.get("month") || "";
  const subtype = url.searchParams.get("subtype") || "";

  const db = getDb();
  let where = "";
  const params: unknown[] = [];

  if (month) { where += " AND r.year_month = ?"; params.push(month); }
  if (subtype) { where += " AND r.subtype = ?"; params.push(subtype); }

  const rows = db.prepare(
    `SELECT r.*, c.company_name, c.tax_id, c.status as customer_status
     FROM wht_records r
     JOIN wht_customers c ON r.customer_id = c.id
     WHERE c.status = '启用'${where}
     ORDER BY r.year_month DESC, c.company_name`
  ).all(...params);

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json();
  const { action } = body;

  const db = getDb();

  // Generate monthly records for all enabled customers
  if (action === "generate") {
    const { month, subtype: genSubtype } = body;
    if (!month) return NextResponse.json({ error: "请指定月份" }, { status: 400 });
    if (!genSubtype) return NextResponse.json({ error: "请选择申报类型" }, { status: 400 });

    const customers = db.prepare(
      "SELECT id FROM wht_customers WHERE status = '启用'"
    ).all() as { id: number }[];

    let created = 0;
    for (const c of customers) {
      const exists = db.prepare(
        "SELECT id FROM wht_records WHERE customer_id = ? AND year_month = ? AND subtype = ?"
      ).get(c.id, month, genSubtype);
      if (exists) continue;

      const result = db.prepare(
        "INSERT INTO wht_records (customer_id, year_month, subtype) VALUES (?, ?, ?)"
      ).run(c.id, month, genSubtype);
      seedRecordSteps(db, Number(result.lastInsertRowid), genSubtype);
      created++;
    }
    return NextResponse.json({ created });
  }

  // Single record generate
  const { customer_id, year_month, subtype: createSubtype } = body;
  if (!customer_id || !year_month || !createSubtype)
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });

  const exists = db.prepare(
    "SELECT id FROM wht_records WHERE customer_id = ? AND year_month = ? AND subtype = ?"
  ).get(customer_id, year_month, createSubtype);
  if (exists) return NextResponse.json({ error: "本月已有申报记录" }, { status: 409 });

  const result = db.prepare(
    "INSERT INTO wht_records (customer_id, year_month, subtype) VALUES (?, ?, ?)"
  ).run(customer_id, year_month, createSubtype);
  seedRecordSteps(db, Number(result.lastInsertRowid), createSubtype);
  const row = db.prepare("SELECT * FROM wht_records WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}
