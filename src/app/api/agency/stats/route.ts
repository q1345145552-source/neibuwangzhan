import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(_req: NextRequest) {
  const db = getDb();

  const total = (db.prepare("SELECT COUNT(*) as c FROM influencers").get() as any).c;
  const aRated = (db.prepare(
    "SELECT COUNT(DISTINCT ie.influencer_id) as c FROM influencer_evaluations ie WHERE ie.rating = 'A'"
  ).get() as any).c;

  const categories = db.prepare(
    "SELECT category, COUNT(*) as c FROM influencers WHERE category != '' GROUP BY category ORDER BY c DESC LIMIT 8"
  ).all() as { category: string; c: number }[];

  const newThisMonth = (db.prepare(
    "SELECT COUNT(*) as c FROM influencers WHERE created_at >= date('now', 'start of month')"
  ).get() as any).c;

  // Phase-based counts
  const discoveryCount = (db.prepare("SELECT COUNT(*) as c FROM influencers WHERE phase = 'discovery'").get() as any).c;
  const poolCount = (db.prepare("SELECT COUNT(*) as c FROM influencers WHERE phase IN ('completed_discovery','completed_contract')").get() as any).c;
  const contractingCount = (db.prepare("SELECT COUNT(*) as c FROM influencers WHERE phase = 'contract'").get() as any).c;
  const incubatingCount = (db.prepare("SELECT COUNT(*) as c FROM influencers WHERE phase = 'incubation'").get() as any).c;
  const completedCount = (db.prepare("SELECT COUNT(*) as c FROM influencers WHERE phase IN ('completed_incubation')").get() as any).c;

  // Overdue contracts
  const overdue2d = (db.prepare(
    "SELECT COUNT(*) as c FROM contracts WHERE payment_status != '已付' AND created_at <= datetime('now', '-2 days') AND created_at > datetime('now', '-5 days')"
  ).get() as any).c;
  const overdue5d = (db.prepare(
    "SELECT COUNT(*) as c FROM contracts WHERE payment_status != '已付' AND created_at <= datetime('now', '-5 days')"
  ).get() as any).c;

  // Phase breakdown for chart
  const phaseStats = db.prepare(
    "SELECT phase, COUNT(*) as c FROM influencers GROUP BY phase ORDER BY phase"
  ).all() as { phase: string; c: number }[];

  const res = NextResponse.json({
    total, aRated, newThisMonth,
    discoveryCount, poolCount, contractingCount, incubatingCount, completedCount,
    overdue2d, overdue5d,
    categories, phaseStats,
  });
  res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res;
}
