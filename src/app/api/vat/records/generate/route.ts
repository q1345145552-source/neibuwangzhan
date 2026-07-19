import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

const PROGRESS_STEPS = ["收资料", "Excel 计算", "发客户确认", "e-Filing 提交", "付款纳税", "归档完成"];

// POST /api/vat/records/generate
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const body = await req.json();
  const month = body.month;
  if (!month) return NextResponse.json({ error: "请指定月份" }, { status: 400 });

  const db = getDb();

  const customers = db.prepare("SELECT id FROM vat_customers WHERE status = '启用'").all() as { id: number }[];
  if (customers.length === 0) return NextResponse.json({ error: "没有启用的客户" }, { status: 400 });

  let created = 0;
  const insertRecord = db.prepare("INSERT INTO vat_records (customer_id, year_month, progress, assignee) VALUES (?, ?, '收资料', '')");
  const insertStep = db.prepare("INSERT INTO vat_record_steps (record_id, step_name, step_order) VALUES (?, ?, ?)");

  const txn = db.transaction(() => {
    for (const c of customers) {
      const existing = db.prepare("SELECT id FROM vat_records WHERE customer_id = ? AND year_month = ?").get(c.id, month);
      if (existing) continue;

      const result = insertRecord.run(c.id, month);
      const recordId = result.lastInsertRowid;
      for (let i = 0; i < PROGRESS_STEPS.length; i++) {
        insertStep.run(recordId, PROGRESS_STEPS[i], i + 1);
      }
      created++;
    }
  });
  txn();

  return NextResponse.json({ created, message: `已为 ${created} 个客户生成 ${month} 申报记录` });
}
