import { NextRequest, NextResponse } from "next/server";
import { getDb, seedInfluencerSteps } from "@/lib/db";

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  let sql = "SELECT * FROM influencers";
  const params: string[] = [];
  if (status) { sql += " WHERE status = ?"; params.push(status); }
  sql += " ORDER BY created_at DESC";
  const rows = db.prepare(sql).all(...params);
  const res = NextResponse.json(rows);
  res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res;
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const { name, tiktok_link, category, contact, contact_phone, line_id, monthly_gmv, live_stream_ratio, contact_time, reply_status, followers, avg_views, gmv_range, notes, status } = body;
  if (!name) return NextResponse.json({ error: "请填写达人名称" }, { status: 400 });
  const result = db.prepare(
    "INSERT INTO influencers (name, tiktok_link, category, contact, contact_phone, line_id, monthly_gmv, live_stream_ratio, contact_time, reply_status, followers, avg_views, gmv_range, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(name, tiktok_link || "", category || "", contact || "", contact_phone || "", line_id || "", monthly_gmv || "", live_stream_ratio || "", contact_time || "", reply_status || "待联系", followers || "", avg_views || "", gmv_range || "", notes || "", status || "待评估");
  // Auto-generate 19-step workflow
  seedInfluencerSteps(db, Number(result.lastInsertRowid));
  const row = db.prepare("SELECT * FROM influencers WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  const sets: string[] = []; const vals: any[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`); vals.push(v);
  }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE influencers SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  const row = db.prepare("SELECT * FROM influencers WHERE id = ?").get(id);
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  db.prepare("DELETE FROM influencer_factories WHERE influencer_id = ?").run(id);
  db.prepare("DELETE FROM influencer_evaluations WHERE influencer_id = ?").run(id);
  db.prepare("DELETE FROM contracts WHERE influencer_id = ?").run(id);
  db.prepare("DELETE FROM influencers WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
