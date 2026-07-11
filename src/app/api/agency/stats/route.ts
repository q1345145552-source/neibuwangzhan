import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(_req: NextRequest) {
  const db = getDb();

  // Total influencers
  const total = (db.prepare("SELECT COUNT(*) as c FROM influencers").get() as any).c;

  // A-rated (via evaluations with rating 'A')
  const aRated = (db.prepare(
    "SELECT COUNT(DISTINCT ie.influencer_id) as c FROM influencer_evaluations ie WHERE ie.rating = 'A'"
  ).get() as any).c;

  // Category distribution
  const categories = db.prepare(
    "SELECT category, COUNT(*) as c FROM influencers WHERE category != '' GROUP BY category ORDER BY c DESC LIMIT 8"
  ).all() as { category: string; c: number }[];

  // Contracting count (status = 签约中)
  const contracting = (db.prepare("SELECT COUNT(*) as c FROM influencers WHERE status = '签约中'").get() as any).c;

  // New this month
  const newThisMonth = (db.prepare(
    "SELECT COUNT(*) as c FROM influencers WHERE created_at >= date('now', 'start of month')"
  ).get() as any).c;

  // Overdue contracts: contracts created >2 days ago, not paid
  const overdue2d = (db.prepare(
    "SELECT COUNT(*) as c FROM contracts WHERE payment_status != '已付' AND created_at <= datetime('now', '-2 days') AND created_at > datetime('now', '-5 days')"
  ).get() as any).c;

  const overdue5d = (db.prepare(
    "SELECT COUNT(*) as c FROM contracts WHERE payment_status != '已付' AND created_at <= datetime('now', '-5 days')"
  ).get() as any).c;

  // Signed count
  const signed = (db.prepare("SELECT COUNT(*) as c FROM influencers WHERE status = '已签约'").get() as any).c;

  const res = NextResponse.json({
    total,
    aRated,
    contracting,
    signed,
    newThisMonth,
    overdue2d,
    overdue5d,
    categories,
  });
  res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res;
}
