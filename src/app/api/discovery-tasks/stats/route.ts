import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(_req: NextRequest) {
  const auth = await verifyAuth(_req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();

  // Today's stats
  const today = db.prepare(`
    SELECT
      COUNT(*) as today_tasks,
      COUNT(DISTINCT creator) as today_creators,
      (SELECT COUNT(*) FROM influencers WHERE discovery_task_id IN (SELECT id FROM discovery_tasks WHERE date(created_at) = date('now'))) as today_infs
    FROM discovery_tasks
    WHERE date(created_at) = date('now')
  `).get() as any;

  // Per-creator stats (all time)
  const byCreator = db.prepare(`
    SELECT creator,
      COUNT(*) as total_tasks,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_tasks,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
      (SELECT COUNT(*) FROM influencers WHERE discovery_task_id IN (SELECT id FROM discovery_tasks WHERE creator = dt.creator)) as total_infs,
      SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) as today_tasks,
      (SELECT COUNT(*) FROM influencers WHERE discovery_task_id IN (SELECT id FROM discovery_tasks WHERE creator = dt.creator AND date(created_at) = date('now'))) as today_infs
    FROM discovery_tasks dt
    WHERE creator != ''
    GROUP BY creator
    ORDER BY total_tasks DESC
  `).all();

  const res = NextResponse.json({ today, byCreator });
  res.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return res;
}
