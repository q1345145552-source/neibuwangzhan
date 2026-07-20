import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// Helper: apply status auto-flow rules
function insertPointsRecord(db: any, employeeName: string, points: number, reason: string, ruleKey: string) {
  db.prepare(
    "INSERT INTO points_records (employee_name, points, reason, rule_key, ref_type, created_by) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(employeeName, points, reason, ruleKey, "customer", "system");
}

function applyAutoFlow(db: any) {
  // 跟进中 + 有成交订单 → 已合作
  db.exec(`
    UPDATE customers SET status = '已合作', updated_at = datetime('now')
    WHERE status = '跟进中'
    AND company_name IN (SELECT DISTINCT customer_name FROM orders)
  `);

  // 跟进中 + 1个月没写跟进日志 → 沉睡
  db.exec(`
    UPDATE customers SET status = '沉睡', updated_at = datetime('now')
    WHERE status = '跟进中'
    AND id NOT IN (
      SELECT DISTINCT customer_id FROM customer_follow_ups
      WHERE created_at >= datetime('now', '-1 month')
    )
  `);

  // 已合作 + 3个月没新订单 → 沉睡
  db.exec(`
    UPDATE customers SET status = '沉睡', updated_at = datetime('now')
    WHERE status = '已合作'
    AND company_name NOT IN (
      SELECT DISTINCT customer_name FROM orders
      WHERE created_at >= datetime('now', '-3 months')
    )
  `);
}

// GET /api/customers — list all customers, with optional search & status filter
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const status = url.searchParams.get("status") || "";
  const action = url.searchParams.get("action") || "";

  const db = getDb();

  // Template download
  if (action === "template") {
    const csvHeaders = "公司名称,行业,联系人,联系方式,合作意愿度,需求标签,合作状态,成交总额";
    const csvExample = "示例科技有限公司,电商,张三,zhangsan888,高,\"VAT,商标\",潜在,0";
    const BOM = "\ufeff";
    const NL = "\n";
    const csv = BOM + csvHeaders + NL + csvExample + NL;
    const encoded = new TextEncoder().encode(csv);
    return new NextResponse(encoded, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename*=UTF-8''%E5%AE%A2%E6%88%B7%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.csv",
      },
    });
  }

  // Dashboard stats
  if (action === "dashboard") {
    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM customers WHERE status = '潜在') as potential,
        (SELECT COUNT(*) FROM customers WHERE status = '跟进中') as following,
        (SELECT COUNT(*) FROM customers WHERE status = '已合作') as cooperated,
        (SELECT COUNT(*) FROM customers WHERE status = '沉睡') as dormant,
        (SELECT COUNT(*) FROM customers WHERE created_at >= datetime('now','-1 month')) as new_this_month
    `).get() as any;

    // Follow-up alerts: 跟进中 customers with stale follow-ups
    const alerts = db.prepare(`
      SELECT c.id, c.company_name, c.claimed_by,
        (SELECT MAX(created_at) FROM customer_follow_ups WHERE customer_id = c.id) as last_follow_up
      FROM customers c
      WHERE c.status = '跟进中'
        AND c.id NOT IN (SELECT DISTINCT customer_id FROM customer_follow_ups WHERE created_at >= datetime('now','-7 days'))
      ORDER BY last_follow_up ASC NULLS FIRST
    `).all() as any[];

    // Add color coding in the API response
    const now = new Date();
    const alertsWithLevel = alerts.map((a: any) => {
      const lastDate = a.last_follow_up ? new Date(a.last_follow_up) : null;
      let level = 'yellow'; // 7-14 days
      if (!lastDate || (now.getTime() - lastDate.getTime()) > 14 * 86400000) level = 'red';
      return { ...a, level, last_follow_up: a.last_follow_up || null };
    });

    // Dormant analysis: split by deal history
    const dormantWithDeals = db.prepare(`
      SELECT COUNT(*) as count FROM customers c
      WHERE c.status = '沉睡' AND c.company_name IN (SELECT DISTINCT customer_name FROM orders)
    `).get() as any;
    const dormantNoDeals = db.prepare(`
      SELECT COUNT(*) as count FROM customers c
      WHERE c.status = '沉睡' AND c.company_name NOT IN (SELECT DISTINCT customer_name FROM orders)
    `).get() as any;

    return NextResponse.json({
      ...stats,
      alerts: alertsWithLevel,
      dormant_with_deals: dormantWithDeals.count,
      dormant_no_deals: dormantNoDeals.count,
    });
  }

  // My customer points
  if (action === "my_points") {
    const name = auth.name || "";
    const total = db.prepare("SELECT COALESCE(SUM(points), 0) as total FROM points_records WHERE employee_name = ? AND rule_key IN ('customer_followup','customer_claim','customer_activate','customer_upgrade','customer_deal') AND status != '已撤销'").get(name) as { total: number };
    return NextResponse.json({ employee_name: name, total_customer_points: total.total });
  }

  // Admin: pending withdrawals
  if (auth.role === "admin" && action === "withdrawals") {
    const rows = db.prepare("SELECT * FROM point_withdrawals ORDER BY CASE WHEN status = '待审核' THEN 0 ELSE 1 END, created_at DESC").all();
    return NextResponse.json(rows);
  }

  // VAT import: get vat_customers not yet in customers pool
  if (action === "vat-importable") {
    const rows = db.prepare(`
      SELECT vc.* FROM vat_customers vc
      WHERE vc.company_name NOT IN (SELECT company_name FROM customers)
      ORDER BY vc.company_name
    `).all();
    return NextResponse.json(rows);
  }

  // Apply auto-flow before listing
  applyAutoFlow(db);

  let sql = "SELECT * FROM customers";
  const conditions: string[] = [];
  const params: string[] = [];

  if (search) {
    conditions.push("(company_name LIKE ? OR owner_name LIKE ? OR handler_name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }

  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY updated_at DESC";

  const rows = db.prepare(sql).all(...params);
  return NextResponse.json(rows);
}

// POST /api/customers
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json();

  // === Special actions ===

  // Batch import from CSV
  if (body.action === "batch_import") {
    const { csv_text } = body;
    if (!csv_text?.trim()) return NextResponse.json({ error: "请上传CSV文件内容" }, { status: 400 });

    const lines = csv_text.trim().split(/\r?\n/);
    if (lines.length < 2) return NextResponse.json({ error: "CSV文件为空或只有表头" }, { status: 400 });

    // Parse header
    const headerLine = lines[0].replace(/^\uFEFF/, "");
    const headers = headerLine.split(",").map((h: string) => h.trim());

    // Map header names to db fields
    const fieldMap: Record<string, string> = {
      "公司名称": "company_name",
      "行业": "industry",
      "联系人": "handler_name",
      "联系方式": "handler_wechat",
      "合作意愿度": "willingness",
      "需求标签": "demand_tags",
      "合作状态": "status",
      "成交总额": "total_deal_amount",
    };

    const db = getDb();
    const errors: string[] = [];
    let successCount = 0;

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO customers (company_name, industry, handler_name, handler_wechat, willingness, demand_tags, status, total_deal_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Parse CSV lines (handling quoted fields)
    const parseCsvLine = (line: string): string[] => {
      const result: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
        else { current += ch; }
      }
      result.push(current.trim());
      return result;
    };

    for (let i = 1; i < lines.length; i++) {
      const lineNum = i + 1; // 1-based row number for error messages
      const raw = lines[i].trim();
      if (!raw) continue;

      const values = parseCsvLine(raw);
      if (values.length !== headers.length) {
        errors.push(`第${lineNum}行: 列数不匹配（期望${headers.length}列，实际${values.length}列）`);
        continue;
      }

      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[j];
      }

      // Validate required: company_name
      if (!row["公司名称"]?.trim()) {
        errors.push(`第${lineNum}行: 公司名称为必填`);
        continue;
      }

      // Check duplicate
      const exists = db.prepare("SELECT id FROM customers WHERE company_name = ?").get(row["公司名称"].trim());
      if (exists) {
        errors.push(`第${lineNum}行: 公司「${row["公司名称"].trim()}」已存在`);
        continue;
      }

      // Insert
      const status = row["合作状态"]?.trim() || "潜在";
      const amount = parseFloat(row["成交总额"] || "0") || 0;

      const result = insertStmt.run(
        row["公司名称"].trim(),
        row["行业"] || "",
        row["联系人"] || "",
        row["联系方式"] || "",
        row["合作意愿度"] || "",
        row["需求标签"] || "",
        status,
        amount
      );

      if (result.changes > 0) {
        successCount++;
      } else {
        errors.push(`第${lineNum}行: 导入失败（可能公司名称重复）`);
      }
    }

    return NextResponse.json({ success: true, imported: successCount, errors });
  }

  // Batch reassign
  if (body.action === "batch_reassign") {
    if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });
    const { ids, new_claimed_by } = body;
    if (!ids || !Array.isArray(ids) || !ids.length) return NextResponse.json({ error: "请选择要转移的客户" }, { status: 400 });
    if (!new_claimed_by?.trim()) return NextResponse.json({ error: "请指定目标员工" }, { status: 400 });
    const db = getDb();
    const result = db.transaction(() => {
      let count = 0;
      for (const id of ids) {
        const r = db.prepare("UPDATE customers SET claimed_by = ?, updated_at = datetime('now') WHERE id = ?").run(new_claimed_by.trim(), id);
        count += r.changes;
      }
      return count;
    })() as number;
    return NextResponse.json({ success: true, count: result });
  }


  // Follow-up: add follow-up log + points
  if (body.action === "follow_up") {
    const { customer_id, content, next_contact_at } = body;
    if (!customer_id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });
    if (!content?.trim()) return NextResponse.json({ error: "请填写跟进内容" }, { status: 400 });
    const db = getDb();
    db.prepare("INSERT INTO customer_follow_ups (customer_id, employee_name, content, next_contact_at) VALUES (?, ?, ?, ?)").run(customer_id, auth.name!, content.trim(), next_contact_at || "");
    insertPointsRecord(db, auth.name!, 2, `跟进客户 #${customer_id}`, "customer_followup");
    return NextResponse.json({ success: true });
  }

  // Withdraw request
  if (body.action === "withdraw_request") {
    const { amount } = body;
    if (!amount || amount <= 0) return NextResponse.json({ error: "请输入有效积分" }, { status: 400 });
    const db = getDb();
    const total = db.prepare("SELECT COALESCE(SUM(points), 0) as total FROM points_records WHERE employee_name = ? AND rule_key IN ('customer_followup','customer_claim','customer_activate','customer_upgrade','customer_deal') AND status != '已撤销'").get(auth.name!) as { total: number };
    if (total.total < amount) return NextResponse.json({ error: `积分不足，当前销售积分: ${total.total}` }, { status: 400 });
    db.prepare("INSERT INTO point_withdrawals (employee_name, amount) VALUES (?, ?)").run(auth.name!, amount);
    return NextResponse.json({ success: true, message: "提现申请已提交，等待管理员审核" });
  }

  // Admin: review withdrawal
  if (body.action === "withdraw_review") {
    if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可审核" }, { status: 403 });
    const { withdrawal_id, approve, note } = body;
    if (!withdrawal_id) return NextResponse.json({ error: "缺少提现申请 ID" }, { status: 400 });
    const db = getDb();
    const w = db.prepare("SELECT * FROM point_withdrawals WHERE id = ?").get(withdrawal_id) as any;
    if (!w) return NextResponse.json({ error: "申请不存在" }, { status: 404 });
    if (w.status !== "待审核") return NextResponse.json({ error: "该申请已处理" }, { status: 400 });
    const status = approve ? "已通过" : "已驳回";
    db.prepare("UPDATE point_withdrawals SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = datetime('now') WHERE id = ?").run(status, auth.name!, note || "", withdrawal_id);
    if (approve) {
      // Deduct from points
      db.prepare("INSERT INTO points_records (employee_name, points, reason, rule_key, ref_type, created_by) VALUES (?, ?, ?, 'withdrawal', 'customer', 'system')").run(w.employee_name, -w.amount, `积分提现 -${w.amount} 分（管理员审核通过）`);
    }
    return NextResponse.json({ success: true });
  }

  // Claim: claim a 潜在 customer
  if (body.action === "claim") {
    const { id } = body;
    if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });
    const db = getDb();
    const c = db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as any;
    if (!c) return NextResponse.json({ error: "客户不存在" }, { status: 404 });
    if (c.status !== "潜在") return NextResponse.json({ error: "只能认领潜在客户" }, { status: 400 });
    if (c.claimed_by && c.claimed_by.trim()) return NextResponse.json({ error: "已被认领" }, { status: 409 });
    db.prepare("UPDATE customers SET claimed_by = ?, status = '跟进中', updated_at = datetime('now') WHERE id = ?").run(auth.name, id);
    insertPointsRecord(db, auth.name!, 5, `认领客户「${(c as any).company_name}」`, "customer_claim");
    const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
    return NextResponse.json(row);
  }

  // Activate: wake up a 沉睡 customer
  if (body.action === "activate") {
    const { id } = body;
    if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });
    const db = getDb();
    const c = db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as any;
    if (!c) return NextResponse.json({ error: "客户不存在" }, { status: 404 });
    if (c.status !== "沉睡") return NextResponse.json({ error: "只能激活沉睡客户" }, { status: 400 });
    db.prepare("UPDATE customers SET claimed_by = ?, status = '跟进中', updated_at = datetime('now') WHERE id = ?").run(auth.name, id);
    insertPointsRecord(db, auth.name!, 8, `激活沉睡客户「${(c as any).company_name}」`, "customer_activate");
    const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
    return NextResponse.json(row);
  }

  // VAT import: batch import selected vat customers
  if (body.action === "vat-import") {
    const { ids } = body;
    if (!ids || !Array.isArray(ids) || !ids.length) return NextResponse.json({ error: "请选择要导入的客户" }, { status: 400 });
    const db = getDb();
    let imported = 0;
    const insertStmt = db.prepare("INSERT OR IGNORE INTO customers (company_name, source_channel, status) VALUES (?, 'VAT白名单', '潜在')");
    const tx = db.transaction(() => {
      for (const vatId of ids) {
        const vc = db.prepare("SELECT company_name FROM vat_customers WHERE id = ?").get(vatId) as any;
        if (vc) {
          const r = insertStmt.run(vc.company_name);
          if (r.changes > 0) imported++;
        }
      }
    });
    tx();
    return NextResponse.json({ imported });
  }

  // === Standard create ===
  const { company_name } = body;
  if (!company_name?.trim()) return NextResponse.json({ error: "请输入公司名称" }, { status: 400 });

  const db = getDb();
  const existing = db.prepare("SELECT id FROM customers WHERE company_name = ?").get(company_name.trim());
  if (existing) return NextResponse.json({ error: "该公司已存在" }, { status: 409 });

  const result = db.prepare(`
    INSERT INTO customers (company_name, industry, company_type, founded_at, source_channel, owner_name, owner_wechat, handler_name, handler_wechat, willingness, demand_tags, status, total_deal_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    company_name.trim(), body.industry || "", body.company_type || "",
    body.founded_at || "", body.source_channel || "", body.owner_name || "",
    body.owner_wechat || "", body.handler_name || "", body.handler_wechat || "",
    body.willingness || "", body.demand_tags || "", body.status || "潜在",
    body.total_deal_amount || 0
  );
  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

// PATCH /api/customers
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });

  const db = getDb();
  const fields = ["company_name","industry","company_type","founded_at","source_channel","owner_name","owner_wechat","handler_name","handler_wechat","willingness","demand_tags","status","total_deal_amount","claimed_by"];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) { sets.push(`${f}=?`); vals.push(body[f]); }
  }
  if (!sets.length) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_at=datetime('now')");

  db.prepare(`UPDATE customers SET ${sets.join(",")} WHERE id=?`).run(...vals, id);
  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
  return NextResponse.json(row);
}

// DELETE /api/customers?id=xxx
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });

  const db = getDb();
  db.prepare("DELETE FROM customer_follow_ups WHERE customer_id = ?").run(id);
  db.prepare("DELETE FROM customer_points WHERE customer_id = ?").run(id);
  db.prepare("DELETE FROM customers WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
