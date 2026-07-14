import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/discovery-tasks/:id
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(_req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

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
