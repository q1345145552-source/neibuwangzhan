import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";
import { isSyncRequest, syncRateLimited, recordSyncAuthFailure } from "@/lib/sync-auth";
import { recordStepRating, type RatingInput } from "@/lib/step-ratings";

/**
 * 客户站送来客户给每一步打的分（2026-10-20 老板 3A 4A）。一批最多 20 条，按评价编号去重，回执逐条说收下没有。
 * 订单还没接收（客户站先送了评价）回 409，客户站稍后重试。
 */
const ID = /^[A-Za-z0-9-]{8,80}$/;
const TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const posInt = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 1;

function parse(body: Record<string, unknown>): { sourceOrderNo: string; customerName: string; items: RatingInput[] } {
  const sourceOrderNo = typeof body.source_order_no === "string" ? body.source_order_no.trim() : "";
  if (!sourceOrderNo || sourceOrderNo.length > 64) throw new Error("缺少客户站单号");
  const customer = body.customer && typeof body.customer === "object" ? body.customer as { name?: unknown } : {};
  const customerName = typeof customer.name === "string" ? customer.name.slice(0, 100) : "";
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 20) throw new Error("评价条数不对");
  const items = body.items.map((raw): RatingInput => {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (typeof r.id !== "string" || !ID.test(r.id)) throw new Error("评价编号格式错误");
    if (!posInt(r.line_no) || !posInt(r.copy_no) || !posInt(r.step_order)) throw new Error("评价的步骤不对");
    const stars = Number(r.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new Error("星级只能是 1 到 5");
    const comment = typeof r.comment === "string" ? r.comment.trim().slice(0, 300) : "";
    const ratedAt = typeof r.rated_at === "string" && TIME.test(r.rated_at) ? r.rated_at : new Date().toISOString().replace("T", " ").slice(0, 19);
    return { id: r.id, source_order_no: sourceOrderNo, line_no: Number(r.line_no), copy_no: Number(r.copy_no), step_order: Number(r.step_order),
      step_name: typeof r.step_name === "string" ? r.step_name.slice(0, 200) : "", stars, comment, rated_at: ratedAt };
  });
  return { sourceOrderNo, customerName, items };
}

export async function POST(req: NextRequest) {
  if (syncRateLimited(req)) return NextResponse.json({ error: "尝试过于频繁，请稍后再试" }, { status: 429 });
  if (!isSyncRequest(req)) {
    recordSyncAuthFailure(req);
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  let input: ReturnType<typeof parse>;
  try { input = parse(await readJson(req)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "请求格式错误" }, { status: 400 }); }
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM sync_inbox WHERE source_order_no = ? LIMIT 1").get(input.sourceOrderNo)) {
    return NextResponse.json({ error: "订单尚未接收，稍后重试" }, { status: 409 });
  }
  // 内部订单上的客户名（客户管理里那个）；没有就用客户站带来的
  const customerName = (db.prepare(`SELECT o.customer_name FROM orders o JOIN sync_inbox i ON i.internal_order_id = o.id
    WHERE i.source_order_no = ? ORDER BY i.line_no, i.copy_no LIMIT 1`).get(input.sourceOrderNo) as { customer_name?: string } | undefined)?.customer_name || input.customerName;
  try {
    const results = input.items.map(item => recordStepRating(db, item, customerName));
    return NextResponse.json({ received: true, source_order_no: input.sourceOrderNo, results });
  } catch (error) {
    console.error("[sync/step-ratings] 评价落库失败:", error);
    return NextResponse.json({ error: "评价保存失败，请重试" }, { status: 500 });
  }
}
