import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, seedInfluencerSteps, logOperation } from "@/lib/db";

// POST /api/influencers/:id/start-phase
// Body: { phase: "contract" | "incubation", force?: boolean }
//
// 阶段顺序：discovery → contract → incubation
// - 普通员工必须按顺序走：要开签约，发现阶段得先完成
// - 管理员可以带 force: true 强制跳级（特殊情况，会记进审计日志）
// - 倒退回旧阶段时**保留已有步骤和备注**，不重新生成（原实现会 DELETE 掉整个阶段的记录）
const PHASE_ORDER = ["discovery", "contract", "incubation"] as const;
type Phase = (typeof PHASE_ORDER)[number];

/** 该阶段是否已全部完成 */
function isPhaseComplete(db: ReturnType<typeof getDb>, influencerId: string, phase: string): boolean {
  const agg = db.prepare(
    "SELECT COUNT(*) as total, SUM(CASE WHEN status = '已完成' THEN 1 ELSE 0 END) as done FROM influencer_steps WHERE influencer_id = ? AND phase = ?"
  ).get(influencerId, phase) as { total: number; done: number };
  return agg.total > 0 && agg.total === agg.done;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const body = await readJson(req);
  const { phase, force } = body as { phase?: string; force?: boolean };

  if (!phase || !["contract", "incubation"].includes(phase)) {
    return NextResponse.json({ error: "无效阶段，可选 contract 或 incubation" }, { status: 400 });
  }
  const targetPhase = phase as Phase;

  const inf = db.prepare("SELECT * FROM influencers WHERE id = ?").get(id) as
    { id: number; name: string; phase: string; status: string } | undefined;
  if (!inf) return NextResponse.json({ error: "达人不存在" }, { status: 404 });

  if (inf.phase === targetPhase) {
    return NextResponse.json({ error: "该阶段已在进行中" }, { status: 400 });
  }

  // 已终止的达人不能再推进阶段
  if (inf.status === "已停止") {
    return NextResponse.json({ error: "该达人已停止合作，无法开启新阶段" }, { status: 400 });
  }

  // ── 顺序校验 ──
  const currentBase = (inf.phase || "discovery").replace("completed_", "") as Phase;
  const targetIdx = PHASE_ORDER.indexOf(targetPhase);
  const currentIdx = PHASE_ORDER.indexOf(currentBase);
  const prevPhase = PHASE_ORDER[targetIdx - 1];
  const isForward = targetIdx > currentIdx;
  const skipping = isForward && !!prevPhase && !isPhaseComplete(db, id, prevPhase);

  if (skipping && !(auth.role === "admin" && force)) {
    const label = prevPhase === "discovery" ? "达人发现" : "签约跟进";
    return NextResponse.json(
      {
        error: `请先完成「${label}」阶段的全部步骤再开启此阶段`,
        can_force: auth.role === "admin",
        hint: auth.role === "admin" ? "管理员可在请求里带 force: true 强制跳级" : undefined,
      },
      { status: 400 }
    );
  }

  // ── 生成或复用步骤 ──
  const existing = (db.prepare(
    "SELECT COUNT(*) as c FROM influencer_steps WHERE influencer_id = ? AND phase = ?"
  ).get(id, targetPhase) as { c: number }).c;

  const newStatus = targetPhase === "contract" ? "签约中" : "品牌孵化中";

  db.transaction(() => {
    // 已有步骤就沿用（倒退回旧阶段时，之前做过的记录和备注都还在）；
    // 只有从没生成过才 seed。原实现无条件 DELETE，倒退一次历史就没了。
    if (existing === 0) {
      seedInfluencerSteps(db, Number(id), targetPhase);
    }
    db.prepare(
      "UPDATE influencers SET phase = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(targetPhase, newStatus, id);
  })();

  if (skipping) {
    logOperation(
      auth.name, "强制跳阶段", "influencer", String(id),
      `${inf.phase} → ${targetPhase}（未完成前置阶段「${prevPhase}」）`
    );
  }

  const updated = db.prepare("SELECT * FROM influencers WHERE id = ?").get(id);
  const steps = db.prepare(`
    SELECT * FROM influencer_steps WHERE influencer_id = ?
    ORDER BY CASE phase WHEN 'discovery' THEN 1 WHEN 'contract' THEN 2 WHEN 'incubation' THEN 3 ELSE 4 END,
             step_order
  `).all(id);
  return NextResponse.json({
    ...(updated as object),
    steps,
    reused_existing_steps: existing > 0,
  });
}
