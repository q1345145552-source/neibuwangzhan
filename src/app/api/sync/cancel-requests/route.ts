import { NextRequest, NextResponse } from "next/server";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";
import { isSyncRequest, syncRateLimited, recordSyncAuthFailure } from "@/lib/sync-auth";
import { CancelRequestError, receiveCancelRequest } from "@/lib/cancel-sync";

/** 客户站内申请取消（2026-10-03，规则 19/20）：客户站用服务密钥送来，按份对应到办理单，提醒管理员。 */
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
    const result = receiveCancelRequest(getDb(), body, typeof customer.name === "string" ? customer.name.slice(0, 100) : "");
    logOperation("客户站同步", "接收取消申请", "order", String(body.source_order_no), JSON.stringify(result));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CancelRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[POST /api/sync/cancel-requests] 保存取消申请失败:", error);
    return NextResponse.json({ error: "保存取消申请失败，稍后重试" }, { status: 500 });
  }
}
