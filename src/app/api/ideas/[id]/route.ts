import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// PATCH /api/ideas/[id] — 老板处理想法：采纳/拒绝/推进进行中/标已实现（仅老板）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅老板可处理" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const idea = db.prepare("SELECT * FROM ideas WHERE id = ?").get(id) as any;
  if (!idea) return NextResponse.json({ error: "想法不存在" }, { status: 404 });

  const body = await readJson(req);
  const { action } = body;

  const getUpdated = () => db.prepare("SELECT * FROM ideas WHERE id = ?").get(id);

  // 采纳：待评估 → 已采纳，填奖金金额 + 币种
  if (action === "adopt") {
    if (idea.status !== "待评估") return NextResponse.json({ error: "只有待评估的想法能采纳" }, { status: 400 });
    const amt = Number(body.bonus_amount);
    if (!Number.isFinite(amt) || amt < 0) return NextResponse.json({ error: "请填写奖金金额" }, { status: 400 });
    const currency = body.currency === "CNY" ? "CNY" : "THB";
    db.prepare("UPDATE ideas SET status = '已采纳', bonus_amount = ?, currency = ?, updated_at = datetime('now') WHERE id = ?").run(amt, currency, id);
    logOperation(auth.name, "采纳想法", "idea", String(id), `奖金 ${amt}${currency}`);
    return NextResponse.json(getUpdated());
  }

  // 拒绝：待评估 → 已拒绝
  if (action === "reject") {
    if (idea.status !== "待评估") return NextResponse.json({ error: "只有待评估的想法能拒绝" }, { status: 400 });
    db.prepare("UPDATE ideas SET status = '已拒绝', updated_at = datetime('now') WHERE id = ?").run(id);
    logOperation(auth.name, "拒绝想法", "idea", String(id));
    return NextResponse.json(getUpdated());
  }

  // 已采纳 → 进行中
  if (action === "start") {
    if (idea.status !== "已采纳") return NextResponse.json({ error: "只有已采纳的想法能推进进行中" }, { status: 400 });
    db.prepare("UPDATE ideas SET status = '进行中', updated_at = datetime('now') WHERE id = ?").run(id);
    logOperation(auth.name, "想法进行中", "idea", String(id));
    return NextResponse.json(getUpdated());
  }

  // 进行中 → 已实现，填关联功能
  if (action === "complete") {
    if (idea.status !== "进行中") return NextResponse.json({ error: "只有进行中的想法能标已实现" }, { status: 400 });
    const rf = String(body.related_feature || "").trim();
    if (!rf) return NextResponse.json({ error: "请填写关联功能" }, { status: 400 });
    db.prepare("UPDATE ideas SET status = '已实现', related_feature = ?, updated_at = datetime('now') WHERE id = ?").run(rf, id);
    logOperation(auth.name, "想法已实现", "idea", String(id), rf);
    return NextResponse.json(getUpdated());
  }

  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
