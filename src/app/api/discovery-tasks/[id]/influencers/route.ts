import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/discovery-tasks/:id/influencers - list influencers in this task
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM influencers WHERE discovery_task_id = ? ORDER BY created_at DESC"
  ).all(id);
  return NextResponse.json(rows);
}

// POST /api/discovery-tasks/:id/influencers - add influencer to task
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { name, tiktok_link, category, contact_phone, line_id, followers, avg_views, gmv_range, monthly_gmv, live_stream_ratio, notes } = body;

  if (!name) return NextResponse.json({ error: "请填写达人名称" }, { status: 400 });
  if (!tiktok_link) return NextResponse.json({ error: "请填写TikTok链接" }, { status: 400 });

  // Create influencer WITHOUT discovery steps (steps generated when task is completed)
  // Status starts as 待评估, phase = discovery
  const result = db.prepare(
    "INSERT INTO influencers (name, tiktok_link, category, contact_phone, line_id, followers, avg_views, gmv_range, monthly_gmv, live_stream_ratio, notes, status, phase, discovery_task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '待评估', 'discovery', ?)"
  ).run(name, tiktok_link, category || "", contact_phone || "", line_id || "", followers || "", avg_views || "", gmv_range || "", monthly_gmv || "", live_stream_ratio || "", notes || "", id);

  const inf = db.prepare("SELECT * FROM influencers WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(inf, { status: 201 });
}

// DELETE /api/discovery-tasks/:id/influencers - remove influencer from task
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { influencer_id } = body;
  if (!influencer_id) return NextResponse.json({ error: "缺少达人ID" }, { status: 400 });

  db.prepare("DELETE FROM influencers WHERE id = ? AND discovery_task_id = ?").run(influencer_id, id);
  return NextResponse.json({ success: true });
}
