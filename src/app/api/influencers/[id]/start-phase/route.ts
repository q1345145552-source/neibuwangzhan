import { NextRequest, NextResponse } from "next/server";
import { getDb, seedInfluencerSteps } from "@/lib/db";

// POST /api/influencers/:id/start-phase
// Body: { phase: "contract" | "incubation" }
// Generates phase-specific steps and updates the influencer's phase
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { phase } = body;

  if (!phase || !["contract", "incubation"].includes(phase)) {
    return NextResponse.json({ error: "无效阶段，可选 contract 或 incubation" }, { status: 400 });
  }

  const inf = db.prepare("SELECT * FROM influencers WHERE id = ?").get(id) as any;
  if (!inf) return NextResponse.json({ error: "达人不存在" }, { status: 404 });

  // Don't allow starting a phase that's already in progress
  if (inf.phase === phase) {
    return NextResponse.json({ error: "该阶段已在进行中" }, { status: 400 });
  }

  // Delete existing steps for this phase (in case of restart)
  db.prepare("DELETE FROM influencer_step_notes WHERE step_id IN (SELECT id FROM influencer_steps WHERE influencer_id = ? AND phase = ?)").run(id, phase);
  db.prepare("DELETE FROM influencer_steps WHERE influencer_id = ? AND phase = ?").run(id, phase);

  // Generate steps for the new phase
  seedInfluencerSteps(db, Number(id), phase);

  // Update influencer phase and status
  const newStatus = phase === "contract" ? "签约中" : "品牌孵化中";
  db.prepare("UPDATE influencers SET phase = ?, status = ?, updated_at = datetime('now') WHERE id = ?").run(phase, newStatus, id);

  const updated = db.prepare("SELECT * FROM influencers WHERE id = ?").get(id);
  const steps = db.prepare("SELECT * FROM influencer_steps WHERE influencer_id = ? ORDER BY step_order").all(id);
  const result = updated as Record<string, unknown>;
  return NextResponse.json({ ...result, steps });
}
