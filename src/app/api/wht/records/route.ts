import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { isCronRequest } from "@/lib/cron-auth";
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

export const WHT_SUBTYPES = Object.keys(WHT_STEPS);

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
  const search = url.searchParams.get("search") || "";
  const month = url.searchParams.get("month") || "";
  const monthFrom = url.searchParams.get("month_from") || "";
  const monthTo = url.searchParams.get("month_to") || "";
  const subtype = url.searchParams.get("subtype") || "";
  const progress = url.searchParams.get("progress") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  const db = getDb();
  // 之前这里硬编码 c.status = '启用'，客户一停用，他过去所有申报记录就从列表里消失、无法查历史。
  // 改成可选筛选：默认排除已软删除的客户，customer_status=启用 时才按状态过滤。
  const customerStatus = url.searchParams.get("customer_status") || "";
  const where: string[] = ["COALESCE(c.deleted, 0) = 0"];
  const params: unknown[] = [];
  if (customerStatus) { where.push("c.status = ?"); params.push(customerStatus); }

  if (search) {
    where.push("c.company_name LIKE ?");
    params.push(`%${search}%`);
  }

  // single month takes priority over range
  if (month) {
    where.push("r.year_month = ?");
    params.push(month);
  } else {
    if (monthFrom) { where.push("r.year_month >= ?"); params.push(monthFrom); }
    if (monthTo) { where.push("r.year_month <= ?"); params.push(monthTo); }
  }

  if (subtype) { where.push("r.subtype = ?"); params.push(subtype); }

  if (progress) {
    if (progress === "未归档") {
      where.push("r.progress != '归档'");
    } else {
      where.push("r.progress = ?");
      params.push(progress);
    }
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // Count total
  const countRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM wht_records r
     JOIN wht_customers c ON r.customer_id = c.id
     ${whereClause}`
  ).get(...params) as { cnt: number };
  const total = countRow.cnt;

  // Fetch page
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(
    `SELECT r.*, c.company_name, c.tax_id, c.status as customer_status
     FROM wht_records r
     JOIN wht_customers c ON r.customer_id = c.id
     ${whereClause}
     ORDER BY r.year_month DESC, c.company_name
     LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset);

  return NextResponse.json({ rows, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  // 定时任务内部调用：密钥来自环境变量 CRON_SECRET，未配置则此分支不可用
  const isCron = isCronRequest(req);

  const body = await readJson(req);

  if (!isCron) {
    const auth = await verifyAuth(req);
    if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const { action } = body;

  const db = getDb();

  // Generate monthly records for all enabled customers
  if (action === "generate") {
    const { month, subtype: genSubtype } = body;
    if (!month) return NextResponse.json({ error: "请指定月份" }, { status: 400 });
    if (!genSubtype) return NextResponse.json({ error: "请选择申报类型" }, { status: 400 });
    // 不校验的话，未知类型会生成 0 个步骤的"僵尸记录"——永远推进不了，也没有任何报错
    if (!WHT_SUBTYPES.includes(genSubtype)) {
      return NextResponse.json({ error: `不支持的申报类型: ${genSubtype}（可选: ${WHT_SUBTYPES.join(" / ")}）` }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "月份格式应为 YYYY-MM" }, { status: 400 });
    }

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
      // Sync reconciliation
      const existingRecon = db.prepare(
        "SELECT id FROM wht_reconciliation WHERE customer_id = ? AND year_month = ?"
      ).get(c.id, month);
      if (!existingRecon) {
        db.prepare(
          "INSERT INTO wht_reconciliation (customer_id, year_month, tax_payable, tax_paid, tax_unpaid) VALUES (?, ?, 0, 0, 0)"
        ).run(c.id, month);
      }
      created++;
    }
    return NextResponse.json({ created });
  }

  // Single record generate
  const { customer_id, year_month, subtype: createSubtype } = body;
  if (!customer_id || !year_month || !createSubtype)
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  if (!WHT_SUBTYPES.includes(createSubtype)) {
    return NextResponse.json({ error: `不支持的申报类型: ${createSubtype}（可选: ${WHT_SUBTYPES.join(" / ")}）` }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}$/.test(year_month)) {
    return NextResponse.json({ error: "月份格式应为 YYYY-MM" }, { status: 400 });
  }
  const cust = db.prepare("SELECT id FROM wht_customers WHERE id = ? AND COALESCE(deleted, 0) = 0").get(customer_id);
  if (!cust) return NextResponse.json({ error: "客户不存在" }, { status: 404 });

  const exists = db.prepare(
    "SELECT id FROM wht_records WHERE customer_id = ? AND year_month = ? AND subtype = ?"
  ).get(customer_id, year_month, createSubtype);
  if (exists) return NextResponse.json({ error: "本月已有申报记录" }, { status: 409 });

  const result = db.prepare(
    "INSERT INTO wht_records (customer_id, year_month, subtype) VALUES (?, ?, ?)"
  ).run(customer_id, year_month, createSubtype);
  seedRecordSteps(db, Number(result.lastInsertRowid), createSubtype);
  // Sync reconciliation
  const existingReconSingle = db.prepare(
    "SELECT id FROM wht_reconciliation WHERE customer_id = ? AND year_month = ?"
  ).get(customer_id, year_month);
  if (!existingReconSingle) {
    db.prepare(
      "INSERT INTO wht_reconciliation (customer_id, year_month, tax_payable, tax_paid, tax_unpaid) VALUES (?, ?, 0, 0, 0)"
    ).run(customer_id, year_month);
  }
  const row = db.prepare("SELECT * FROM wht_records WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}
