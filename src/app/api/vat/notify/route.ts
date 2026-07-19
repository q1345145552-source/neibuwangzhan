import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// POST /api/vat/notify — 十号自动对账通知
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  // Allow both admin and system to call this (system via cron)

  const reqBody = await req.json().catch(() => ({}));
  const month = reqBody.month || new Date().toISOString().slice(0, 7);
  const db = getDb();

  const enabledCustomers = db.prepare("SELECT id, company_name FROM vat_customers WHERE status = '启用'").all() as { id: number; company_name: string }[];
  if (enabledCustomers.length === 0) {
    return NextResponse.json({ message: "没有启用客户，跳过通知" });
  }

  const issues: { company: string; issue: string; severity: string }[] = [];

  for (const c of enabledCustomers) {
    const record = db.prepare("SELECT * FROM vat_records WHERE customer_id = ? AND year_month = ?").get(c.id, month) as any;

    if (!record) {
      // No record generated — system issue
      issues.push({ company: c.company_name, issue: "本月未生成申报记录", severity: "critical" });
      continue;
    }

    // Check if still at step 1 (收资料) — no docs submitted
    if (record.progress === "收资料") {
      issues.push({ company: c.company_name, issue: "尚未提交申报资料", severity: "warning" });
    }

    // Check step 5 payment
    const step5 = db.prepare("SELECT payment_status FROM vat_record_steps WHERE record_id = ? AND step_order = 5").get(record.id) as any;
    if (step5?.payment_status === "逾期未付") {
      issues.push({ company: c.company_name, issue: "VAT税款逾期未付", severity: "warning" });
    }

    // Check overall overdue (past month records not archived)
    if (record.progress !== "归档完成") {
      const [y, m] = month.split("-").map(Number);
      const now = new Date();
      if (now.getFullYear() > y || (now.getFullYear() === y && now.getMonth() + 1 > m)) {
        issues.push({ company: c.company_name, issue: "上月申报未归档", severity: "critical" });
      }
    }
  }

  // Also scan previous months for stale overdue
  const prevMonths: string[] = [];
  const now2 = new Date();
  for (let i = 1; i <= 2; i++) {
    const d = new Date(now2.getFullYear(), now2.getMonth() - i, 1);
    prevMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  
  for (const pm of prevMonths) {
    const staleRecords = db.prepare(`
      SELECT r.id, c.company_name, r.progress
      FROM vat_records r
      JOIN vat_customers c ON r.customer_id = c.id
      WHERE r.year_month = ? AND r.progress != '归档完成' AND c.status = '启用'
    `).all(pm) as any[];
    
    for (const sr of staleRecords) {
      issues.push({ company: sr.company_name, issue: `${pm} 申报仍未完成（进度：${sr.progress}）`, severity: "critical" });
    }
  }

  if (issues.length === 0) {
    return NextResponse.json({ message: "本月所有客户申报正常，无需发送通知", issues: [] });
  }

  // Build notification body
  const warningItems = issues.filter(i => i.severity === "warning");
  const criticalItems = issues.filter(i => i.severity === "critical");

  let notifBody = `VAT月度对账提醒（${month}）\n\n`;
  if (criticalItems.length > 0) {
    notifBody += `⚠️ 需紧急处理（${criticalItems.length}项）：\n`;
    for (const item of criticalItems) {
      notifBody += `  · ${item.company} — ${item.issue}\n`;
    }
    notifBody += "\n";
  }
  if (warningItems.length > 0) {
    notifBody += `📋 需关注（${warningItems.length}项）：\n`;
    for (const item of warningItems) {
      notifBody += `  · ${item.company} — ${item.issue}\n`;
    }
    notifBody += "\n";
  }
  notifBody += `建议：优先处理逾期客户，联系未交资料的客户催促提交，暂停连续不配合的客户。`;

  // Send to admin + Eve + Pop
  const recipients = db.prepare("SELECT name FROM employees WHERE role = 'admin' OR name IN ('Eve', 'Pop')").all() as { name: string }[];

  let sent = 0;
  for (const r of recipients) {
    db.prepare(
      "INSERT INTO notifications (type, title, body, recipient, related_type) VALUES (?, ?, ?, ?, ?)"
    ).run("mention", `📊 VAT月度对账提醒 — ${month}`, notifBody, r.name, "vat_notify");
    sent++;
  }

  return NextResponse.json({
    message: `已向 ${sent} 人发送通知（管理员 + Eve + Pop）`,
    issues,
    sentTo: recipients.map(r => r.name),
  });
}

// GET /api/vat/notify — 查看对账结果（不发送通知）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const db = getDb();

  const enabledCustomers = db.prepare("SELECT id, company_name FROM vat_customers WHERE status = '启用'").all() as { id: number; company_name: string }[];
  const issues: { company: string; issue: string; severity: string }[] = [];

  for (const c of enabledCustomers) {
    const record = db.prepare("SELECT * FROM vat_records WHERE customer_id = ? AND year_month = ?").get(c.id, month) as any;
    if (!record) { issues.push({ company: c.company_name, issue: "本月未生成申报记录", severity: "critical" }); continue; }
    if (record.progress === "收资料") issues.push({ company: c.company_name, issue: "尚未提交申报资料", severity: "warning" });
    const step5 = db.prepare("SELECT payment_status FROM vat_record_steps WHERE record_id = ? AND step_order = 5").get(record.id) as any;
    if (step5?.payment_status === "逾期未付") issues.push({ company: c.company_name, issue: "VAT税款逾期未付", severity: "warning" });
  }

  return NextResponse.json({ month, issues });
}
