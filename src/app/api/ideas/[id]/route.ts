import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { IDEA_REVIEW_TITLES } from "@/lib/notification-types";

// 与列表相同：员工可看所有员工点子，不可看老板记录的想法。
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return NextResponse.json({ error: "想法编号无效" }, { status: 400 });
  const db = getDb();
  const idea = (auth.role === "admin"
    ? db.prepare("SELECT * FROM ideas WHERE id = ?").get(id)
    : db.prepare("SELECT * FROM ideas WHERE id = ? AND is_boss = 0").get(id));
  if (!idea) return NextResponse.json({ error: "想法不存在或你无权查看" }, { status: 404 });
  return NextResponse.json(idea, { headers: { "Cache-Control": "private, no-store" } });
}

// PATCH /api/ideas/[id] — 老板处理想法：采纳/拒绝/重新打开/推进进行中/标已实现/补实现奖（仅老板）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅老板可处理" }, { status: 403 });

  const { id } = await params;
  const body = await readJson(req);
  const { action } = body;
  const db = getDb();
  const getUpdated = () => db.prepare("SELECT * FROM ideas WHERE id = ?").get(id);

  // 只给采纳/拒绝补提醒：锁内查当前状态，保存和提醒一起成功或回滚。
  if (action === "adopt" || action === "reject") return db.transaction(() => {
    const idea = getUpdated() as any;
    if (!idea) return NextResponse.json({ error: "想法不存在" }, { status: 404 });
    if (idea.status !== "待评估") return NextResponse.json({ error: action === "adopt" ? "只有待评估的想法能采纳" : "只有待评估的想法能拒绝" }, { status: 400 });
    if (typeof idea.source !== "string" || !idea.source.trim()) return NextResponse.json({ error: "想法提交人信息无效" }, { status: 409 });
    if (action === "adopt") {
      const rawAmount = body.bonus_amount;
      const amt = Number(rawAmount);
      if ((typeof rawAmount !== "number" && typeof rawAmount !== "string") || (typeof rawAmount === "string" && !rawAmount.trim()) || !Number.isFinite(amt) || amt < 0) return NextResponse.json({ error: "请填写奖金金额" }, { status: 400 });
      if (body.currency !== "CNY" && body.currency !== "THB") return NextResponse.json({ error: "请选择奖金币种（THB/CNY）" }, { status: 400 });
      const currency = body.currency;
      const changed = db.prepare("UPDATE ideas SET status = '已采纳', bonus_amount = ?, currency = ?, updated_at = datetime('now') WHERE id = ? AND status = '待评估'").run(amt, currency, id);
      if (changed.changes !== 1) return NextResponse.json({ error: "想法状态已变化，请刷新后重试" }, { status: 409 });
      const saved = getUpdated() as any;
      if (!saved) throw new Error("想法保存失败，请重试");
      const result = saved.bonus_amount > 0
        ? `采纳奖金：${saved.bonus_amount} ${saved.currency}（仅为获批奖金，付款需另行确认）。`
        : `本次采纳无奖金（${saved.bonus_amount} ${saved.currency}）。`;
      db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)").run(
        "", IDEA_REVIEW_TITLES[0], `${auth.name}采纳了你的想法「${saved.title}」。\n${result}`, saved.source, String(saved.id), "idea_review"
      );
      logOperation(auth.name, "采纳想法", "idea", String(id), `奖金 ${amt}${currency}`);
      return NextResponse.json(saved);
    }

    const reason = typeof body.rejection_reason === "string" ? body.rejection_reason.trim() : "";
    if (!reason) return NextResponse.json({ error: "请填写拒绝原因" }, { status: 400 });
    const changed = db.prepare("UPDATE ideas SET status = '已拒绝', rejection_reason = ?, updated_at = datetime('now') WHERE id = ? AND status = '待评估'").run(reason, id);
    if (changed.changes !== 1) return NextResponse.json({ error: "想法状态已变化，请刷新后重试" }, { status: 409 });
    const saved = getUpdated() as any;
    if (!saved) throw new Error("想法保存失败，请重试");
    db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)").run(
      "", IDEA_REVIEW_TITLES[1], `${auth.name}拒绝了你的想法「${saved.title}」。\n拒绝原因：${saved.rejection_reason}`, saved.source, String(saved.id), "idea_review"
    );
    logOperation(auth.name, "拒绝想法", "idea", String(id));
    return NextResponse.json(saved);
  }).immediate();

  const idea = getUpdated() as any;
  if (!idea) return NextResponse.json({ error: "想法不存在" }, { status: 404 });

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
