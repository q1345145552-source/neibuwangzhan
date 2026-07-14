import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb, INFLUENCER_UPDATABLE_FIELDS } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(_req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const influencer = db.prepare("SELECT * FROM influencers WHERE id = ?").get(id);
  if (!influencer) return NextResponse.json({ error: "达人不存在" }, { status: 404 });
  const steps = db.prepare("SELECT * FROM influencer_steps WHERE influencer_id = ? ORDER BY step_order").all(id);
  const evaluations = db.prepare("SELECT * FROM influencer_evaluations WHERE influencer_id = ? ORDER BY created_at DESC").all(id);
  const contracts = db.prepare("SELECT c.*, i.name AS influencer_name FROM contracts c LEFT JOIN influencers i ON c.influencer_id = i.id WHERE c.influencer_id = ?").all(id);
  return NextResponse.json({ ...influencer, steps, evaluations, contracts });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { ...fields } = body;
  const sets: string[] = []; const vals: any[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === "id" || !INFLUENCER_UPDATABLE_FIELDS.has(k)) continue;
    sets.push(`${k} = ?`); vals.push(v);
  }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE influencers SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  const influencer = db.prepare("SELECT * FROM influencers WHERE id = ?").get(id);
  return NextResponse.json(influencer);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM influencer_step_notes WHERE influencer_id = ?").run(id);
  db.prepare("DELETE FROM influencer_steps WHERE influencer_id = ?").run(id);
  db.prepare("DELETE FROM influencer_evaluations WHERE influencer_id = ?").run(id);
  db.prepare("DELETE FROM contracts WHERE influencer_id = ?").run(id);
  db.prepare("DELETE FROM influencer_factories WHERE influencer_id = ?").run(id);
  db.prepare("DELETE FROM influencers WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
