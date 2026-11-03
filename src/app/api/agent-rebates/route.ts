import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { agentRebateRows, requireAdmin } from "@/lib/agents";

// GET /api/agent-rebates?agent_id=：这个代理名下每张单
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const agentId = req.nextUrl.searchParams.get("agent_id") || "";
  if (!agentId || agentId.length > 64) return NextResponse.json({ error: "缺少代理账号" }, { status: 400 });
  return NextResponse.json({ rows: agentRebateRows(getDb(), agentId) });
}
