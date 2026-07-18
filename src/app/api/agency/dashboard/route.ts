import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

// 员工标识 → 数据库里可能出现的名字（大小写、中英文别名）
const STAFF_ALIASES: Record<string, string[]> = {
  ploy: ["Ploy", "ploy"],
  yuanli: ["Yuanli"],
  pare: ["Prae", "pare", "Pare"],
  namcha: ["Namcha", "namcha"],
};
const STAFF_IDS = Object.keys(STAFF_ALIASES);

function buildNameWhere(prefix: string, name: string): { clause: string; params: string[] } {
  const aliases = STAFF_ALIASES[name] || [name];
  const clauses = aliases.map((_, i) => `LOWER(${prefix}) = LOWER(?)`);
  const params = aliases.map(a => a);
  return { clause: `(${clauses.join(" OR ")})`, params };
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const employee = searchParams.get("employee") || "";

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

  // ── Period stats ──
  const whereClause = dateWhere("created_at");
  const params = dateParams();

  let periodTasks = 0, periodInfluencers = 0, periodEvaluations = 0, periodContracts = 0;

  if (employee) {
    const { clause: tClause, params: tParams } = buildNameWhere("creator", employee);
    periodTasks = (db.prepare(
      `SELECT COUNT(*) as c FROM discovery_tasks WHERE ${tClause}${whereClause}`
    ).get(...tParams, ...params) as { c: number })?.c || 0;

    const { clause: iClause, params: iParams } = buildNameWhere("created_by", employee);
    periodInfluencers = (db.prepare(
      `SELECT COUNT(*) as c FROM influencers WHERE ${iClause}${whereClause}`
    ).get(...iParams, ...params) as { c: number })?.c || 0;

    const { clause: eClause, params: eParams } = buildNameWhere("evaluated_by", employee);
    periodEvaluations = (db.prepare(
      `SELECT COUNT(*) as c FROM influencer_evaluations WHERE ${eClause}${whereClause}`
    ).get(...eParams, ...params) as { c: number })?.c || 0;

    const { clause: cClause, params: cParams } = buildNameWhere("created_by", employee);
    const cp = dateParams();
    periodContracts = (db.prepare(
      `SELECT COUNT(*) as c FROM contracts WHERE ${cClause}${dateWhere("created_at")}`
    ).get(...cParams, ...cp) as { c: number })?.c || 0;
  } else {
    periodTasks = (db.prepare(
      `SELECT COUNT(*) as c FROM discovery_tasks WHERE 1=1${whereClause}`
    ).get(...params) as { c: number })?.c || 0;
    periodInfluencers = (db.prepare(
      `SELECT COUNT(*) as c FROM influencers WHERE 1=1${whereClause}`
    ).get(...params) as { c: number })?.c || 0;
    periodEvaluations = (db.prepare(
      `SELECT COUNT(*) as c FROM influencer_evaluations WHERE 1=1${whereClause}`
    ).get(...params) as { c: number })?.c || 0;
    periodContracts = (db.prepare(
      `SELECT COUNT(*) as c FROM contracts WHERE 1=1${dateWhere("created_at")}`
    ).get(...dateParams()) as { c: number })?.c || 0;
  }

  // ── Per-employee workload breakdown ──
  const staffWorkload: { name: string; tasks: number; influencers: number; evaluations: number; contracts: number }[] = [];

  for (const name of STAFF_IDS) {
    const empDate = dateParams();

    const { clause: tClause, params: tP } = buildNameWhere("creator", name);
    const tasksC = (db.prepare(
      `SELECT COUNT(*) as c FROM discovery_tasks WHERE ${tClause}${dateWhere("created_at")}`
    ).get(...tP, ...empDate) as { c: number })?.c || 0;

    const { clause: iClause, params: iP } = buildNameWhere("created_by", name);
    const infsC = (db.prepare(
      `SELECT COUNT(*) as c FROM influencers WHERE ${iClause}${dateWhere("created_at")}`
    ).get(...iP, ...empDate) as { c: number })?.c || 0;

    const { clause: eClause, params: eP } = buildNameWhere("evaluated_by", name);
    const evalsC = (db.prepare(
      `SELECT COUNT(*) as c FROM influencer_evaluations WHERE ${eClause}${dateWhere("created_at")}`
    ).get(...eP, ...empDate) as { c: number })?.c || 0;

    const { clause: cClause, params: cP } = buildNameWhere("created_by", name);
    const conDate = dateParams();
    const consC = (db.prepare(
      `SELECT COUNT(*) as c FROM contracts WHERE ${cClause}${dateWhere("created_at")}`
    ).get(...cP, ...conDate) as { c: number })?.c || 0;

    staffWorkload.push({ name, tasks: tasksC, influencers: infsC, evaluations: evalsC, contracts: consC });
  }

  // ── Overdue contracts ──
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

  // ── Recent evaluations ──
  let evalSQL = `SELECT ie.id, COALESCE(NULLIF(ie.final_rating,''), ie.rating) as rating, ie.created_at,
    i.id as influencer_id, i.name as influencer_name, i.category
    FROM influencer_evaluations ie JOIN influencers i ON ie.influencer_id = i.id WHERE 1=1`;
  const evalSqlParams: any[] = [];

  if (from) { evalSQL += " AND ie.created_at >= ?"; evalSqlParams.push(from); }
  if (to) { evalSQL += " AND ie.created_at <= ?"; evalSqlParams.push(to + " 23:59:59"); }
  if (employee) {
    const { clause: eClause, params: eP } = buildNameWhere("ie.evaluated_by", employee);
    evalSQL += ` AND ${eClause}`;
    evalSqlParams.push(...eP);
  }
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

    if (employee) {
      const { clause: tClause, params: tP } = buildNameWhere("creator", employee);
      prevTasks = (db.prepare(
        `SELECT COUNT(*) as c FROM discovery_tasks WHERE ${tClause} AND created_at >= ? AND created_at <= ?`
      ).get(...tP, prevFrom, prevTo) as { c: number })?.c || 0;

      const { clause: iClause, params: iP } = buildNameWhere("created_by", employee);
      prevInfluencers = (db.prepare(
        `SELECT COUNT(*) as c FROM influencers WHERE ${iClause} AND created_at >= ? AND created_at <= ?`
      ).get(...iP, prevFrom, prevTo) as { c: number })?.c || 0;

      const { clause: eClause, params: eP } = buildNameWhere("evaluated_by", employee);
      prevEvaluations = (db.prepare(
        `SELECT COUNT(*) as c FROM influencer_evaluations WHERE ${eClause} AND created_at >= ? AND created_at <= ?`
      ).get(...eP, prevFrom, prevTo) as { c: number })?.c || 0;
    } else {
      prevTasks = (db.prepare(
        "SELECT COUNT(*) as c FROM discovery_tasks WHERE created_at >= ? AND created_at <= ?"
      ).get(prevFrom, prevTo) as { c: number })?.c || 0;
      prevInfluencers = (db.prepare(
        "SELECT COUNT(*) as c FROM influencers WHERE created_at >= ? AND created_at <= ?"
      ).get(prevFrom, prevTo) as { c: number })?.c || 0;
      prevEvaluations = (db.prepare(
        "SELECT COUNT(*) as c FROM influencer_evaluations WHERE created_at >= ? AND created_at <= ?"
      ).get(prevFrom, prevTo) as { c: number })?.c || 0;
    }
    prevContracts = 0; // Simplified
  }

  return NextResponse.json({
    pipelineCounts,
    periodStats: { tasks: periodTasks, influencers: periodInfluencers, evaluations: periodEvaluations, contracts: periodContracts },
    comparison: { tasks: prevTasks, influencers: prevInfluencers, evaluations: prevEvaluations, contracts: prevContracts },
    overdueContracts,
    recentEvaluations,
    staffWorkload,
  });
}