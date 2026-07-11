import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(_req: NextRequest) {
  const db = getDb();

  // Per-creator stats
  const byCreator = db.prepare(`
    SELECT creator, COUNT(*) as total_tasks,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_tasks,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
      (SELECT COUNT(*) FROM influencers WHERE discovery_task_id IN (SELECT id FROM discovery_tasks WHERE creator = dt.creator)) as total_infs
    FROM discovery_tasks dt
    WHERE creator != ''
    GROUP BY creator
    ORDER BY total_tasks DESC
  `).all();

  const res = NextResponse.json({ byCreator });
  res.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return res;
}
