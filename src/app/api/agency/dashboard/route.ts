import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();

  const pipelineCounts = {
    discovery: (db.prepare("SELECT COUNT(*) as count FROM influencers WHERE phase = 'discovery'").get() as { count: number })?.count || 0,
    completed_discovery: (db.prepare("SELECT COUNT(*) as count FROM influencers WHERE phase = 'completed_discovery'").get() as { count: number })?.count || 0,
    contract: (db.prepare("SELECT COUNT(*) as count FROM influencers WHERE phase = 'contract'").get() as { count: number })?.count || 0,
    incubation: (db.prepare("SELECT COUNT(*) as count FROM influencers WHERE phase = 'incubation'").get() as { count: number })?.count || 0,
    completed_incubation: (db.prepare("SELECT COUNT(*) as count FROM influencers WHERE phase = 'completed_incubation'").get() as { count: number })?.count || 0,
  };

  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  const todayTasks = (db.prepare("SELECT COUNT(*) as count FROM discovery_tasks WHERE date(created_at) = ?").get(today) as { count: number })?.count || 0;
  const yesterdayTasks = (db.prepare("SELECT COUNT(*) as count FROM discovery_tasks WHERE date(created_at) = ?").get(yesterday) as { count: number })?.count || 0;
  const todayInfluencers = (db.prepare("SELECT COUNT(*) as count FROM influencers WHERE date(created_at) = ?").get(today) as { count: number })?.count || 0;
  const yesterdayInfluencers = (db.prepare("SELECT COUNT(*) as count FROM influencers WHERE date(created_at) = ?").get(yesterday) as { count: number })?.count || 0;
  const todayEvaluations = (db.prepare("SELECT COUNT(*) as count FROM influencer_evaluations WHERE date(created_at) = ?").get(today) as { count: number })?.count || 0;
  const yesterdayEvaluations = (db.prepare("SELECT COUNT(*) as count FROM influencer_evaluations WHERE date(created_at) = ?").get(yesterday) as { count: number })?.count || 0;
  const todayContracts = (db.prepare("SELECT COUNT(*) as count FROM contracts WHERE date(created_at) = ?").get(today) as { count: number })?.count || 0;
  const yesterdayContracts = (db.prepare("SELECT COUNT(*) as count FROM contracts WHERE date(created_at) = ?").get(yesterday) as { count: number })?.count || 0;

  // Overdue: contracts created > 2 days ago with payment not yet made
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

  const recentEvaluations = db.prepare(`
    SELECT ie.id, COALESCE(NULLIF(ie.final_rating,''), ie.rating) as rating, ie.created_at,
           i.id as influencer_id, i.name as influencer_name, i.category
    FROM influencer_evaluations ie
    JOIN influencers i ON ie.influencer_id = i.id
    ORDER BY ie.created_at DESC
    LIMIT 10
  `).all() || [];

  return NextResponse.json({
    pipelineCounts,
    todayStats: { tasks: todayTasks, influencers: todayInfluencers, evaluations: todayEvaluations, contracts: todayContracts },
    yesterdayStats: { tasks: yesterdayTasks, influencers: yesterdayInfluencers, evaluations: yesterdayEvaluations, contracts: yesterdayContracts },
    overdueContracts,
    recentEvaluations,
  });
}
