import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { activeAgents, requireStaff } from "@/lib/agents";

// GET /api/agents/options：能挂新单的代理，只有名字。/api/agents 带登录名和合计，员工不能看
export async function GET(req: NextRequest) {
  const auth = await requireStaff(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ agents: activeAgents(getDb()) });
}
