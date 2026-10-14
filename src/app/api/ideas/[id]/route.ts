import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// PATCH /api/ideas/[id] — 老板处理想法：采纳/拒绝/重新打开/推进进行中/标已实现/补实现奖（仅老板）
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
    const rawAmount = body.bonus_amount;
    const amt = Number(rawAmount);
    if ((typeof rawAmount !== "number" && typeof rawAmount !== "string") || (typeof rawAmount === "string" && !rawAmount.trim()) || !Number.isFinite(amt) || amt < 0) return NextResponse.json({ error: "请填写奖金金额" }, { status: 400 });
    if (body.currency !== "CNY" && body.currency !== "THB") return NextResponse.json({ error: "请选择奖金币种（THB/CNY）" }, { status: 400 });
    const currency = body.currency;
    db.prepare("UPDATE ideas SET status = '已采纳', bonus_amount = ?, currency = ?, updated_at = datetime('now') WHERE id = ?").run(amt, currency, id);
    logOperation(auth.name, "采纳想法", "idea", String(id), `奖金 ${amt}${currency}`);
    return NextResponse.json(getUpdated());
  }

  // 拒绝：待评估 → 已拒绝
  if (action === "reject") {
    if (idea.status !== "待评估") return NextResponse.json({ error: "只有待评估的想法能拒绝" }, { status: 400 });
    const reason = typeof body.rejection_reason === "string" ? body.rejection_reason.trim() : "";
    if (!reason) return NextResponse.json({ error: "请填写拒绝原因" }, { status: 400 });
    db.prepare("UPDATE ideas SET status = '已拒绝', rejection_reason = ?, updated_at = datetime('now') WHERE id = ?").run(reason, id);
    logOperation(auth.name, "拒绝想法", "idea", String(id));
    return NextResponse.json(getUpdated());
  }

  // 已拒绝 → 待评估，清空此前拒绝原因
  if (action === "reopen") {
    if (idea.status !== "已拒绝") return NextResponse.json({ error: "只有已拒绝的想法能重新打开" }, { status: 400 });
    db.prepare("UPDATE ideas SET status = '待评估', rejection_reason = '', updated_at = datetime('now') WHERE id = ?").run(id);
    logOperation(auth.name, "重新打开想法", "idea", String(id));
    return NextResponse.json(getUpdated());
  }

  // 已采纳 → 进行中
  if (action === "start") {
    if (idea.status !== "已采纳") return NextResponse.json({ error: "只有已采纳的想法能推进进行中" }, { status: 400 });
    db.prepare("UPDATE ideas SET status = '进行中', updated_at = datetime('now') WHERE id = ?").run(id);
    logOperation(auth.name, "想法进行中", "idea", String(id));
    return NextResponse.json(getUpdated());
  }

  // 实现奖可随完成填写，也可在已实现后补填；填写时金额和币种须成对提供。
  if (action === "complete" || action === "set_implementation_bonus") {
    const completing = action === "complete";
    if (idea.status !== (completing ? "进行中" : "已实现")) {
      return NextResponse.json({ error: completing ? "只有进行中的想法能标已实现" : "只有已实现的想法能补实现奖" }, { status: 400 });
    }
    const rf = typeof body.related_feature === "string" ? body.related_feature.trim() : "";
    if (completing && !rf) return NextResponse.json({ error: "请填写关联功能" }, { status: 400 });

    const rawAmount = body.implementation_bonus_amount;
    const rawCurrency = body.implementation_bonus_currency;
    const isEmpty = (value: unknown) => value == null || (typeof value === "string" && !value.trim());
    const hasBonus = !isEmpty(rawAmount) || !isEmpty(rawCurrency);
    let amount: number | null = null;
    let currency: string | null = null;
    if (hasBonus || !completing) {
      amount = Number(rawAmount);
      if (isEmpty(rawAmount) || (typeof rawAmount !== "number" && typeof rawAmount !== "string") || !Number.isFinite(amount) || amount < 0) {
        return NextResponse.json({ error: "请填写有效的实现奖金额（不小于零）" }, { status: 400 });
      }
      if (rawCurrency !== "THB" && rawCurrency !== "CNY") {
        return NextResponse.json({ error: "请选择实现奖币种（THB/CNY）" }, { status: 400 });
      }
      currency = rawCurrency;
    }

    if (completing) {
      db.prepare("UPDATE ideas SET status = '已实现', related_feature = ?, implementation_bonus_amount = ?, implementation_bonus_currency = ?, updated_at = datetime('now') WHERE id = ?").run(rf, amount, currency, id);
      logOperation(auth.name, "想法已实现", "idea", String(id), rf);
    } else {
      db.prepare("UPDATE ideas SET implementation_bonus_amount = ?, implementation_bonus_currency = ?, updated_at = datetime('now') WHERE id = ?").run(amount, currency, id);
      logOperation(auth.name, "补实现奖", "idea", String(id), `实现奖 ${amount}${currency}`);
    }
    return NextResponse.json(getUpdated());
  }

  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
