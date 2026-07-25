import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { INFLUENCER_STEP_STATUSES, isValidStepStatus } from "@/lib/enums";
import { getDb } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(_req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  // 每个阶段的 step_order 都从 1 开始，只按 step_order 排会把不同阶段的步骤交错在一起
  // （实测：discovery-1、contract-1、discovery-2、contract-2…）。先按阶段再按序号。
  const rows = db.prepare(`
    SELECT * FROM influencer_steps WHERE influencer_id = ?
    ORDER BY CASE phase WHEN 'discovery' THEN 1 WHEN 'contract' THEN 2 WHEN 'incubation' THEN 3 ELSE 4 END,
             step_order
  `).all(id);
  return NextResponse.json(rows);
}

// 阶段完成后达人应该处于什么状态。
// 原实现三个阶段一律写「已入池」——签约走完却标成"回池子里了"，业务含义正好相反。
const PHASE_DONE: Record<string, { phase: string; status: string }> = {
  discovery: { phase: "completed_discovery", status: "已入池" },
  contract: { phase: "completed_contract", status: "已签约" },
  incubation: { phase: "completed_incubation", status: "已完成" },
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id: influencerId } = await params;
  const db = getDb();
  const body = await readJson(req);
  const { step_id, status, notes, assignee, stop_reason } = body;
  if (!step_id) return NextResponse.json({ error: "缺少步骤ID" }, { status: 400 });

  // 状态白名单：该列在数据库里没有 CHECK 约束，不校验的话任何字符串都会被写进去，
  // 之后进度统计和阶段流转（依赖精确匹配"已完成"）就全乱了
  if (status !== undefined && !isValidStepStatus(status)) {
    return NextResponse.json(
      { error: `无效的步骤状态，可选：${INFLUENCER_STEP_STATUSES.join(" / ")}` },
      { status: 400 }
    );
  }

  // 归属校验：原实现根本没接 params，URL 里的达人 ID 完全没用上，
  // 任何登录用户带上别人的 step_id 就能改别人达人的步骤、触发阶段流转
  const step = db.prepare(
    "SELECT * FROM influencer_steps WHERE id = ? AND influencer_id = ?"
  ).get(step_id, influencerId) as { id: number; phase: string } | undefined;
  if (!step) return NextResponse.json({ error: "步骤不存在或不属于该达人" }, { status: 404 });

  const sets: string[] = []; const vals: unknown[] = [];
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
  vals.push(step_id, influencerId);

  // 步骤更新 + 阶段流转放在一个事务里，避免"步骤改了但达人状态没跟上"
  db.transaction(() => {
    db.prepare(
      `UPDATE influencer_steps SET ${sets.join(", ")} WHERE id = ? AND influencer_id = ?`
    ).run(...vals);

    // 本阶段全部完成 → 推进阶段，并置为该阶段对应的结果状态
    if (status === "已完成") {
      const agg = db.prepare(
        "SELECT COUNT(*) as total, SUM(CASE WHEN status = '已完成' THEN 1 ELSE 0 END) as done FROM influencer_steps WHERE influencer_id = ? AND phase = ?"
      ).get(influencerId, step.phase) as { total: number; done: number };
      const done = PHASE_DONE[step.phase];
      if (done && agg.total > 0 && agg.total === agg.done) {
        db.prepare(
          "UPDATE influencers SET phase = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(done.phase, done.status, influencerId);
      }
    }

    // 终止整个合作
    if (status === "已停止") {
      db.prepare(
        "UPDATE influencers SET status = '已停止', updated_at = datetime('now') WHERE id = ?"
      ).run(influencerId);
    }
  })();

  const updated = db.prepare("SELECT * FROM influencer_steps WHERE id = ?").get(step_id);
  const inf = db.prepare("SELECT id, status, phase FROM influencers WHERE id = ?").get(influencerId);
  // 带上达人最新状态，前端不用再多发一次请求就能刷新头部
  return NextResponse.json({ ...(updated as object), influencer: inf });
}
