import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(_req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM influencer_steps WHERE influencer_id = ? ORDER BY step_order"
  ).all(id);
  return NextResponse.json(rows);
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await req.json();
  const { step_id, status, notes, assignee, stop_reason } = body;
  if (!step_id) return NextResponse.json({ error: "缺少步骤ID" }, { status: 400 });

  const sets: string[] = []; const vals: any[] = [];
  if (status) { sets.push("status = ?"); vals.push(status); }
  if (notes !== undefined) { sets.push("notes = ?"); vals.push(notes); }
  if (assignee !== undefined) { sets.push("assignee = ?"); vals.push(assignee); }
  if (stop_reason !== undefined) { sets.push("stop_reason = ?"); vals.push(stop_reason); }
  if (status === "已完成") { sets.push("completed_at = datetime('now')"); }
  if (status === "进行中") {
    sets.push("started_at = COALESCE(started_at, datetime('now'))");
    sets.push("completed_at = NULL");
  }
  if (status === "待处理") { sets.push("completed_at = NULL"); }

  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  vals.push(step_id);

  db.prepare(`UPDATE influencer_steps SET ${sets.join(", ")} WHERE id = ?`).run(...vals);

  const step = db.prepare("SELECT * FROM influencer_steps WHERE id = ?").get(step_id) as any;

  // Phase transition: when all steps in current phase complete, auto-transition
  if (step && status === "已完成") {
    const inf = db.prepare("SELECT * FROM influencers WHERE id = ?").get(step.influencer_id) as any;
    if (inf) {
      const phaseSteps = db.prepare(
        "SELECT COUNT(*) as total, SUM(CASE WHEN status = '已完成' THEN 1 ELSE 0 END) as done FROM influencer_steps WHERE influencer_id = ? AND phase = ?"
      ).get(step.influencer_id, step.phase) as any;
      if (phaseSteps && phaseSteps.total > 0 && phaseSteps.total === phaseSteps.done) {
        const phaseMap: Record<string, string> = {
          discovery: "completed_discovery",
          contract: "completed_contract",
          incubation: "completed_incubation",
        };
        const nextPhase = phaseMap[step.phase];
        if (nextPhase) {
          db.prepare("UPDATE influencers SET phase = ?, status = '已入池', updated_at = datetime('now') WHERE id = ?").run(nextPhase, step.influencer_id);
        }
      }
    }
  }

  // When stopping
  if (step && status === "已停止") {
    db.prepare("UPDATE influencers SET status = '已停止', updated_at = datetime('now') WHERE id = ?").run(step.influencer_id);
  }

  return NextResponse.json(step ? db.prepare("SELECT * FROM influencer_steps WHERE id = ?").get(step_id) : { success: true });
}
