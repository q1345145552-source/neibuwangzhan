import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// Scoring rules
const GMV_TIER_SCORES: Record<string, number> = { ">30万": 29, "20-30万": 25, "10-20万": 19, "5-10万": 11 };
const DURATION_TIER_SCORES: Record<string, number> = { ">3小时": 14, "2-3小时": 11, "1-2小时": 8, "<1小时": 5 };
const FREQUENCY_TIER_SCORES: Record<string, number> = { ">5次/周": 14, "4-5次/周": 11, "2-3次/周": 8, "<2次/周": 5 };
const PROF_TIER_SCORES: Record<string, number> = { "高": 5, "中": 3, "低": 1 };

function calcFinalRating(totalScore: number, liveRatioPct: number): string {
  let grade: string;
  if (totalScore >= 50) grade = "A";
  else if (totalScore >= 20) grade = "B";
  else grade = "C";
  if (liveRatioPct >= 50) grade += "+";
  return grade;
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const influencerId = searchParams.get("influencer_id");
  let sql = "SELECT * FROM influencer_evaluations";
  const params: any[] = [];
  if (influencerId) { sql += " WHERE influencer_id = ?"; params.push(influencerId); }
  sql += " ORDER BY created_at DESC";
  const rows = db.prepare(sql).all(...params);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await req.json();
  const {
    influencer_id, gmv, gmv_amount,
    live_gmv, gmv_tier, live_duration_tier, live_frequency_tier, professionalism_tier,
    live_stream_ratio, notes, evaluated_by
  } = body;
  if (!influencer_id) return NextResponse.json({ error: "缺少达人ID" }, { status: 400 });

  // Calculate scores
  const gmv_score = GMV_TIER_SCORES[gmv_tier] || 0;
  const duration_score = DURATION_TIER_SCORES[live_duration_tier] || 0;
  const frequency_score = FREQUENCY_TIER_SCORES[live_frequency_tier] || 0;
  const prof_score = PROF_TIER_SCORES[professionalism_tier] || 0;
  const total_score = gmv_score + duration_score + frequency_score + prof_score;

  // Parse live ratio percentage
  let ratioPct = 0;
  if (live_stream_ratio) {
    ratioPct = parseInt(live_stream_ratio.replace(/%/g, "")) || 0;
  }
  const final_rating = calcFinalRating(total_score, ratioPct);

  const result = db.prepare(
    `INSERT INTO influencer_evaluations
      (influencer_id, gmv, gmv_amount, live_gmv, gmv_tier, gmv_score,
       live_duration_tier, live_duration_score,
       live_frequency_tier, live_frequency_score,
       professionalism_tier, professionalism_score,
       live_stream_ratio, total_score, final_rating, notes, evaluated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    influencer_id, gmv || "", gmv_amount || "", live_gmv || "", gmv_tier || "", gmv_score,
    live_duration_tier || "", duration_score,
    live_frequency_tier || "", frequency_score,
    professionalism_tier || "", prof_score,
    live_stream_ratio || "", total_score, final_rating, notes || "", evaluated_by || ""
  );

  const row = db.prepare("SELECT * FROM influencer_evaluations WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}