import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb, seedInfluencerSteps, INFLUENCER_UPDATABLE_FIELDS } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const phase = searchParams.get("phase");
  let sql = `SELECT i.*, 
    (SELECT ie.final_rating FROM influencer_evaluations ie WHERE ie.influencer_id = i.id ORDER BY ie.created_at DESC LIMIT 1) as latest_rating,
    dt.task_number as task_number, dt.creator as task_creator
    FROM influencers i
    LEFT JOIN discovery_tasks dt ON i.discovery_task_id = dt.id`;
  const conditions: string[] = [];
  const params: string[] = [];
  if (status) { const statuses = status.split(",").map(s => s.trim()); conditions.push("status IN (" + statuses.map(() => "?").join(",") + ")"); params.push(...statuses); }
  if (phase) {
    if (phase === "contract") {
      conditions.push("phase IN ('completed_discovery','contract','completed_contract')");
    } else if (phase === "incubation") {
      conditions.push("phase IN ('completed_discovery','contract','completed_contract','incubation','completed_incubation')");
    } else {
      conditions.push("phase = ?"); params.push(phase);
    }
  }
  if (search) { conditions.push("(name LIKE ? OR category LIKE ? OR contact LIKE ? OR code LIKE ?)"); const q = `%${search}%`; params.push(q, q, q, q); }
  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";
  const rows = db.prepare(sql).all(...params);
  const res = NextResponse.json(rows);
  res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res;
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await req.json();
  const { name, tiktok_link, category, contact, contact_phone, line_id, monthly_gmv, live_stream_ratio, contact_time, reply_status, followers, avg_views, gmv_range, notes, status, code } = body;
  if (!name) return NextResponse.json({ error: "请填写达人名称" }, { status: 400 });
  const result = db.prepare(
    "INSERT INTO influencers (name, tiktok_link, category, contact, contact_phone, line_id, monthly_gmv, live_stream_ratio, contact_time, reply_status, followers, avg_views, gmv_range, notes, status, code, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(name, tiktok_link || "", category || "", contact || "", contact_phone || "", line_id || "", monthly_gmv || "", live_stream_ratio || "", contact_time || "", reply_status || "待联系", followers || "", avg_views || "", gmv_range || "", notes || "", status || "待评估", code || "", auth.name || "");
  // Auto-generate discovery phase steps only (5 steps)
  seedInfluencerSteps(db, Number(result.lastInsertRowid), "discovery");
  const row = db.prepare("SELECT * FROM influencers WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  const sets: string[] = []; const vals: any[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!INFLUENCER_UPDATABLE_FIELDS.has(k)) continue;
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
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

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
