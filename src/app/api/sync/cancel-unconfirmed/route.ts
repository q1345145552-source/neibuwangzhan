import { NextRequest, NextResponse } from "next/server";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";
import { isSyncRequest, syncRateLimited, recordSyncAuthFailure } from "@/lib/sync-auth";
import { CancelRequestError, cancelUnconfirmedOrder } from "@/lib/cancel-sync";

/** 还没确认的单客户直接取消（2026-10-30）：客户站用服务密钥当场来问，能取消就一起取消并带回最新进度。 */
export async function POST(req: NextRequest) {
  if (syncRateLimited(req)) return NextResponse.json({ error: "尝试过于频繁，请稍后再试" }, { status: 429 });
  if (!isSyncRequest(req)) {
    recordSyncAuthFailure(req);
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try { body = await readJson(req); } catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }
  const customer = (body?.customer && typeof body.customer === "object" ? body.customer : {}) as Record<string, unknown>;
  try {
    const result = cancelUnconfirmedOrder(getDb(), body, typeof customer.name === "string" ? customer.name.slice(0, 100) : "");
    // 不马上推进度：客户站拿回执里的进度当场改，推过去的同一份按版本号跳过；马上推反而可能抢在回执前面，
    // 客户多收几条「办理进度更新」。回执丢了也不怕，每 15 秒一轮的补传会推到（申请取消的结果同样跟着这一轮走）。
    logOperation("客户站同步", "客户取消未确认订单", "order", result.source_order_no, JSON.stringify({ order_ids: result.order_ids, already: result.already }));
    return NextResponse.json({ ok: true, source_order_no: result.source_order_no, already: result.already, events: result.events });
  } catch (error) {
    if (error instanceof CancelRequestError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("[POST /api/sync/cancel-unconfirmed] 取消未确认订单失败:", error);
    return NextResponse.json({ error: "取消失败，稍后重试" }, { status: 500 });
  }
}
