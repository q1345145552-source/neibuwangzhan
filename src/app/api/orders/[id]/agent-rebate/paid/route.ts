import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";
import { agentErrorResponse, orderRebateView, requireAdmin, setRebatePaid } from "@/lib/agents";

// POST {paid: boolean}：点已付、撤销已付
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const body = await readJson(req);
  const db = getDb();
  try {
    setRebatePaid(db, id, body.paid, auth.name || "");
  } catch (error) {
    return agentErrorResponse(error);
  }
  return NextResponse.json({ rebate: orderRebateView(db, id) });
}
