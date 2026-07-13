import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

const STAFF = ["Ploy", "元丽", "Prae", "Namcha"];

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const employee = searchParams.get("employee") || "";

  // Build WHERE clause parts for date range
  const dateWhere = (col: string) => {
    const parts: string[] = [];
    if (from) parts.push(`${col} >= ?`);
    if (to) parts.push(`${col} <= ?`);
    return parts.length > 0 ? ` AND ${parts.join(" AND ")}` : "";
  };
  const dateParams = (): any[] => {
    const p: any[] = [];
    if (from) p.push(from);
    if (to) p.push(to + " 23:59:59");
    return p;
  };

  // Pipeline counts (always total, not filtered)
  const pipelineCounts = { discovery: 0, completed_discovery: 0, contract: 0, incubation: 0, completed_incubation: 0 };
  for (const phase of Object.keys(pipelineCounts)) {
    pipelineCounts[phase as keyof typeof pipelineCounts] =
      (db.prepare("SELECT COUNT(*) as count FROM influencers WHERE phase = ?").get(phase) as { count: number })?.count || 0;
  }

  // ── Period stats (filtered by date + optionally employee) ──
  const whereClause = dateWhere("created_at");
  const params = dateParams();

  const periodTasks = (db.prepare(
    `SELECT COUNT(*) as c FROM discovery_tasks WHERE 1=1${whereClause}${employee ? " AND creator = ?" : ""}`
  ).get(...params, ...(employee ? [employee] : [])) as { c: number })?.c || 0;

  const periodInfluencers = (db.prepare(
    `SELECT COUNT(*) as c FROM influencers WHERE 1=1${whereClause}${employee ? " AND created_by = ?" : ""}`
  ).get(...params, ...(employee ? [employee] : [])) as { c: number })?.c || 0;

  const periodEvaluations = (db.prepare(
    `SELECT COUNT(*) as c FROM influencer_evaluations WHERE 1=1${whereClause}${employee ? " AND evaluated_by = ?" : ""}`
  ).get(...params, ...(employee ? [employee] : [])) as { c: number })?.c || 0;

  const periodContracts = (db.prepare(
    `SELECT COUNT(*) as c FROM contracts WHERE 1=1${dateWhere("created_at")}${employee ? " AND created_by = ?" : ""}`
  ).get(...dateParams(), ...(employee ? [employee] : [])) as { c: number })?.c || 0;

  // ── Per-employee workload breakdown ──
  const staffWorkload: {
    name: string;
    tasks: number;
    influencers: number;
    evaluations: number;
    contracts: number;
  }[] = [];

  for (const name of STAFF) {
    const empParams = dateParams();
    const tasksC = (db.prepare(
      `SELECT COUNT(*) as c FROM discovery_tasks WHERE creator = ?${dateWhere("created_at")}`
    ).get(name, ...empParams) as { c: number })?.c || 0;

    const infParams = dateParams();
    const infsC = (db.prepare(
      `SELECT COUNT(*) as c FROM influencers WHERE created_by = ?${dateWhere("created_at")}`
    ).get(name, ...infParams) as { c: number })?.c || 0;

    const evalParams = dateParams();
    const evalsC = (db.prepare(
      `SELECT COUNT(*) as c FROM influencer_evaluations WHERE evaluated_by = ?${dateWhere("created_at")}`
    ).get(name, ...evalParams) as { c: number })?.c || 0;

    const conParams = dateParams();
    const consC = (db.prepare(
      `SELECT COUNT(*) as c FROM contracts WHERE created_by = ?${dateWhere("created_at")}`
    ).get(name, ...conParams) as { c: number })?.c || 0;

    staffWorkload.push({ name, tasks: tasksC, influencers: infsC, evaluations: evalsC, contracts: consC });
  }

  // ── Overdue contracts (always total, not filtered) ──
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
  const overdueContracts = db.prepare(`
    SELECT c.id, c.created_at, c.payment_status,
           i.id as influencer_id, i.name as influencer_name
    FROM contracts c
    JOIN influencers i ON c.influencer_id = i.id
    WHERE c.payment_status = '未付'
      AND c.created_at < ?
    ORDER BY c.created_at ASC
  `).all(twoDaysAgo) || [];

  // ── Recent evaluations (filtered by date + employee) ──
  let evalSQL = `SELECT ie.id, COALESCE(NULLIF(ie.final_rating,''), ie.rating) as rating, ie.created_at,
    i.id as influencer_id, i.name as influencer_name, i.category
    FROM influencer_evaluations ie JOIN influencers i ON ie.influencer_id = i.id WHERE 1=1`;
  const evalSqlParams: any[] = [];

  if (from) { evalSQL += " AND ie.created_at >= ?"; evalSqlParams.push(from); }
  if (to) { evalSQL += " AND ie.created_at <= ?"; evalSqlParams.push(to + " 23:59:59"); }
  if (employee) { evalSQL += " AND ie.evaluated_by = ?"; evalSqlParams.push(employee); }

  evalSQL += " ORDER BY ie.created_at DESC LIMIT 10";
  const recentEvaluations = db.prepare(evalSQL).all(...evalSqlParams) || [];

  // ── Comparison: previous period ──
  let prevTasks = 0, prevInfluencers = 0, prevEvaluations = 0, prevContracts = 0;
  if (from && to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const rangeDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000));
    const prevFrom = new Date(fromDate.getTime() - rangeDays * 86400000).toISOString().split("T")[0];
    const prevTo = new Date(toDate.getTime() - rangeDays * 86400000).toISOString().split("T")[0] + " 23:59:59";

    prevTasks = (db.prepare(
      `SELECT COUNT(*) as c FROM discovery_tasks WHERE created_at >= ? AND created_at <= ?${employee ? " AND creator = ?" : ""}`
    ).get(prevFrom, prevTo, ...(employee ? [employee] : [])) as { c: number })?.c || 0;

    prevInfluencers = (db.prepare(
      `SELECT COUNT(*) as c FROM influencers WHERE created_at >= ? AND created_at <= ?${employee ? " AND created_by = ?" : ""}`
    ).get(prevFrom, prevTo, ...(employee ? [employee] : [])) as { c: number })?.c || 0;

    prevEvaluations = (db.prepare(
      `SELECT COUNT(*) as c FROM influencer_evaluations WHERE created_at >= ? AND created_at <= ?${employee ? " AND evaluated_by = ?" : ""}`
    ).get(prevFrom, prevTo, ...(employee ? [employee] : [])) as { c: number })?.c || 0;

    prevContracts = (db.prepare(
      `SELECT COUNT(*) as c FROM contracts WHERE created_at >= ? AND created_at <= ?${employee ? " AND created_by = ?" : ""}`
    ).get(prevFrom, prevTo, ...(employee ? [employee] : [])) as { c: number })?.c || 0;
  }

  const comparison = {
    tasks: prevTasks,
    influencers: prevInfluencers,
    evaluations: prevEvaluations,
    contracts: prevContracts,
  };

  return NextResponse.json({
    pipelineCounts,
    periodStats: { tasks: periodTasks, influencers: periodInfluencers, evaluations: periodEvaluations, contracts: periodContracts },
    comparison,
    overdueContracts,
    recentEvaluations,
    staffWorkload,
  });
}
