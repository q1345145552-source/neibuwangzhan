import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isSyncRequest, syncRateLimited, recordSyncAuthFailure } from "@/lib/sync-auth";
import { agentOrdersForSync } from "@/lib/agents";

/** 代理名下的单和返点（2026-11-03）：业务系统的代理端打开时来取，不存副本。没这个代理返回空列表。 */
export async function GET(req: NextRequest) {
  if (syncRateLimited(req)) return NextResponse.json({ error: "尝试过于频繁，请稍后再试" }, { status: 429 });
  if (!isSyncRequest(req)) {
    recordSyncAuthFailure(req);
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const agentId = req.nextUrl.searchParams.get("agent_id") || "";
  if (!agentId || agentId.length > 64) return NextResponse.json({ error: "缺少代理账号" }, { status: 400 });
  return NextResponse.json(agentOrdersForSync(getDb(), agentId));
}
