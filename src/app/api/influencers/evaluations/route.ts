import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const influencerId = searchParams.get("influencer_id");
  let sql = "SELECT * FROM influencer_evaluations";
  const params: string[] = [];
  if (influencerId) { sql += " WHERE influencer_id = ?"; params.push(influencerId); }
  sql += " ORDER BY created_at DESC";
  const rows = db.prepare(sql).all(...params);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const { influencer_id, gmv, live_stream_ratio, rating, content_quality, brand_fit, notes, evaluated_by } = body;
  if (!influencer_id) return NextResponse.json({ error: "缺少达人ID" }, { status: 400 });
  const result = db.prepare(
    "INSERT INTO influencer_evaluations (influencer_id, gmv, live_stream_ratio, rating, content_quality, brand_fit, notes, evaluated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(influencer_id, gmv || "", live_stream_ratio || "", rating || "", content_quality || "", brand_fit || "", notes || "", evaluated_by || "");
  const row = db.prepare("SELECT * FROM influencer_evaluations WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}
