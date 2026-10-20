import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isSyncRequest, syncRateLimited, recordSyncAuthFailure } from "@/lib/sync-auth";
import { kitForSourceOrder } from "@/lib/order-kit";

/** 订单资料包清单（2026-10-20 老板 2A）：客户站打开订单时来取这张单的说明书、资料收集表；只给名字和类型，不给内部路径。 */
export async function GET(req: NextRequest) {
  if (syncRateLimited(req)) return NextResponse.json({ error: "尝试过于频繁，请稍后再试" }, { status: 429 });
  if (!isSyncRequest(req)) {
    recordSyncAuthFailure(req);
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const sourceOrderNo = req.nextUrl.searchParams.get("source_order_no") || "";
  if (!sourceOrderNo || sourceOrderNo.length > 64) return NextResponse.json({ error: "缺少客户站单号" }, { status: 400 });
  const files = kitForSourceOrder(getDb(), sourceOrderNo).map(({ id, kind, name, ext }) => ({ id, kind, name, ext }));
  return NextResponse.json({ source_order_no: sourceOrderNo, files });
}
