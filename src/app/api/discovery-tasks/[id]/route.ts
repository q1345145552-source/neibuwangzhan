import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/discovery-tasks/:id
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const task = db.prepare(
    "SELECT dt.*, (SELECT COUNT(*) FROM influencers WHERE discovery_task_id = dt.id) as inf_count FROM discovery_tasks dt WHERE dt.id = ?"
  ).get(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const res = NextResponse.json(task);
  res.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return res;
}
