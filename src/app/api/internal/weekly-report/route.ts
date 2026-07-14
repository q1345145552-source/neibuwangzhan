import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const limit = parseInt(searchParams.get("limit") || "20");

  // 1. Order steps completed by assignee
  let orderSql = "SELECT assignee, COUNT(*) as cnt FROM order_steps WHERE status = '已完成'";
  const orderParams: any[] = [];
  if (from) { orderSql += " AND completed_at >= ?"; orderParams.push(from); }
  if (to) { orderSql += " AND completed_at <= ?"; orderParams.push(to + " 23:59:59"); }
  orderSql += " GROUP BY assignee ORDER BY cnt DESC";
  const orderStats: { assignee: string; cnt: number }[] = db.prepare(orderSql).all(...orderParams) as any[];

  // 2. Influencer evaluations by evaluated_by
  let evalSql = "SELECT evaluated_by as assignee, COUNT(*) as cnt FROM influencer_evaluations WHERE 1=1";
  const evalParams: any[] = [];
  if (from) { evalSql += " AND created_at >= ?"; evalParams.push(from); }
  if (to) { evalSql += " AND created_at <= ?"; evalParams.push(to + " 23:59:59"); }
  evalSql += " GROUP BY evaluated_by ORDER BY cnt DESC";
  const evalStats: { assignee: string; cnt: number }[] = db.prepare(evalSql).all(...evalParams) as any[];

  // 3. Contracts created (from influencers.created_by via join)
  let contractSql = "SELECT i.created_by as assignee, COUNT(*) as cnt FROM contracts c JOIN influencers i ON c.influencer_id = i.id WHERE 1=1";
  const contractParams: any[] = [];
  if (from) { contractSql += " AND c.created_at >= ?"; contractParams.push(from); }
  if (to) { contractSql += " AND c.created_at <= ?"; contractParams.push(to + " 23:59:59"); }
  contractSql += " GROUP BY i.created_by ORDER BY cnt DESC";
  const contractStats: { assignee: string; cnt: number }[] = db.prepare(contractSql).all(...contractParams) as any[];

  // 4. Issues resolved by resolved_by
  let issueSql = "SELECT resolved_by as assignee, COUNT(*) as cnt FROM issue_tickets WHERE status = '已解决'";
  const issueParams: any[] = [];
  if (from) { issueSql += " AND resolved_at >= ?"; issueParams.push(from); }
  if (to) { issueSql += " AND resolved_at <= ?"; issueParams.push(to + " 23:59:59"); }
  issueSql += " GROUP BY resolved_by ORDER BY cnt DESC";
  const issueStats: { assignee: string; cnt: number }[] = db.prepare(issueSql).all(...issueParams) as any[];

  // Merge all stats per person
  const people = new Set<string>();
  [...orderStats, ...evalStats, ...contractStats, ...issueStats].forEach(s => {
    if (s.assignee) people.add(s.assignee);
  });

  const map = (arr: { assignee: string; cnt: number }[]) => {
    const m: Record<string, number> = {};
    arr.forEach(s => { if (s.assignee) m[s.assignee] = (m[s.assignee] || 0) + s.cnt; });
    return m;
  };
  const orderMap = map(orderStats);
  const evalMap = map(evalStats);
  const contractMap = map(contractStats);
  const issueMap = map(issueStats);

  const employees = [...people].map(name => ({
    name,
    orderSteps: orderMap[name] || 0,
    evaluations: evalMap[name] || 0,
    contracts: contractMap[name] || 0,
    issuesResolved: issueMap[name] || 0,
  })).sort((a, b) => (b.orderSteps + b.evaluations + b.contracts + b.issuesResolved) - (a.orderSteps + a.evaluations + a.contracts + a.issuesResolved));

  return NextResponse.json({ from, to, employees });
}
